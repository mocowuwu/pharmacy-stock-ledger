import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { download, run, ui } from "./lib.mjs";
import { portInUse } from "./postgres.mjs";

/**
 * The Microsoft Visual C++ runtime, which PostgreSQL will not start without.
 *
 * The PostgreSQL binaries this installer fetches are built with MSVC, and every
 * one of them imports `vcruntime140.dll`. Windows does not ship it -- the
 * Universal CRT is in the box, this is not -- so on a clean machine `initdb`
 * dies with 0xC0000135, STATUS_DLL_NOT_FOUND, which surfaces as the bare number
 * 3221225781 and names nothing.
 *
 * This is the one thing the installer puts outside its own folder, and it is
 * deliberate: the runtime is shared, versioned by Microsoft, and already
 * present on most machines that have ever run a desktop application. Uninstall
 * therefore stops being purely "delete the folder" -- see DEPLOY.md.
 *
 * It is checked in the machine-check step rather than at first use, so a
 * machine that needs it is told during the part of the install where nothing
 * has happened yet.
 */
const VC_REDIST_URL = "https://aka.ms/vs/17/release/vc_redist.x64.exe";

/** Microsoft's own record of it, and what the redistributable itself writes. */
const VC_RUNTIME_KEY =
  "HKLM\\SOFTWARE\\Microsoft\\VisualStudio\\14.0\\VC\\Runtimes\\x64";

async function hasVisualCppRuntime() {
  try {
    const output = await run("reg", ["query", VC_RUNTIME_KEY, "/v", "Installed"]);
    return /\bInstalled\b\s+REG_DWORD\s+0x1/iu.test(output);
  } catch {
    return false;
  }
}

export async function ensureVisualCppRuntime(paths) {
  if (await hasVisualCppRuntime()) {
    ui.ok("Microsoft Visual C++ runtime");
    return;
  }

  ui.info("installing the Microsoft Visual C++ runtime, which PostgreSQL needs");
  const installer = join(paths.root, "downloads", "vc_redist.x64.exe");

  try {
    await download(VC_REDIST_URL, installer);
  } catch (error) {
    ui.fail(
      `could not download the Microsoft Visual C++ runtime: ${error.message}`,
      `Install it by hand from ${VC_REDIST_URL} and run this again.`,
    );
  }

  // Through `elevate`, not `run`. The redistributable's manifest requests
  // administrator rights, and `run` spawns with shell:false -- CreateProcess,
  // which refuses such a binary with error 740 instead of prompting. Only a
  // shell execute (`Start-Process -Verb RunAs`) raises the UAC dialog.
  //
  // So this is a second prompt, separate from the one the firewall and boot
  // task share later. Worth saying out loud rather than surprising the
  // operator, who has been told to expect exactly one.
  ui.info("Windows will ask for permission. Click Yes.");
  try {
    // `elevate` appends `exit /b 0`, so a script that just runs the installer
    // reports success whatever happened. Propagate the real code instead --
    // 1638 and 3010 below depend on seeing it.
    await elevate(paths, [
      `"${installer}" /install /quiet /norestart`,
      "exit /b %ERRORLEVEL%",
    ]);
  } catch (error) {
    // 1638 is "a newer version is already installed" and 3010 is "installed,
    // wants a restart". Both mean the runtime is there; neither is a failure.
    if (![1638, 3010].includes(error.exitCode)) {
      ui.fail(
        `the Microsoft Visual C++ runtime did not install (exit ${error.exitCode}).`,
        "If the permission prompt was declined, run this again and click Yes.\n" +
          `Otherwise install it by hand from ${VC_REDIST_URL}.`,
      );
    }
  }

  if (!(await hasVisualCppRuntime())) {
    ui.fail(
      "the Microsoft Visual C++ runtime still is not registered.",
      `Install it by hand from ${VC_REDIST_URL}, restart, and run this again.`,
    );
  }
  ui.ok("Microsoft Visual C++ runtime installed");
}

/**
 * The Windows half of "it comes back by itself, and the till can reach it".
 *
 * Two things Windows needs that the other platforms do not, and both of them
 * are why a clinic install fails in a way nobody can diagnose:
 *
 *   - **A boot task.** There is no launchd and no systemd --user. Scheduled
 *     Tasks is the mechanism every Windows has, and `schtasks` drives it from
 *     a script.
 *   - **A firewall rule.** This is the one that wastes the afternoon. The app
 *     listens on every interface already, so it works perfectly in a browser
 *     on the machine itself -- and is invisible from the till, because Windows
 *     Defender Firewall drops the inbound connection silently. There is no
 *     error anywhere. The till just spins.
 *
 * Both want administrator rights, and the installer is otherwise designed to
 * need none. So they are done together, in one elevated step, behind one UAC
 * prompt -- and if the operator clicks No, the install still finishes and says
 * exactly what did not happen and the one command that fixes it.
 */

const TASK_NAME = "PharmacyStockLedger";
export const FIREWALL_RULE = "Pharmacy Stock Ledger";

/**
 * The script the scheduled task runs.
 *
 * A wrapper file rather than the command inline, because `schtasks /TR` takes
 * one string that it re-parses, and a Node path, a script path and an install
 * path with a space in any of them -- `C:\Users\Apotek Sehat\pharmacy` -- is
 * three chances to build a command line Windows quotes wrongly. One path in
 * `/TR` cannot be got wrong.
 *
 * The loop is `Restart=always`. A scheduled task runs its program once and is
 * finished; without this, the pharmacy stays down until somebody notices.
 */
async function writeRunner(paths, nodePath, runner) {
  const script = join(paths.root, "pharmacy-service.cmd");
  const log = join(paths.logs, "pharmacy.log");

  await writeFile(
    script,
    [
      "@echo off",
      "REM Written by the installer. Runs the pharmacy and restarts it if it stops.",
      `cd /d "${paths.app}"`,
      ":loop",
      `"${nodePath}" "${runner}" "${paths.root}" >> "${log}" 2>&1`,
      `echo %DATE% %TIME%  pharmacy stopped; restarting in 5s >> "${log}"`,
      // `ping`, not `timeout`. A scheduled task runs with no console, and
      // `timeout` refuses to run without one -- "input redirection is not
      // supported" -- returning instantly. The five-second pause would become
      // a hot loop restarting the pharmacy as fast as the machine can spawn
      // it, which is worse than being down.
      "ping -n 6 127.0.0.1 > nul",
      "goto loop",
      "",
    ].join("\r\n"),
    "utf8",
  );

  return script;
}

/**
 * Registers the boot task and opens the port, in one elevated batch.
 *
 * Elevation is requested by re-launching a script through PowerShell's
 * `-Verb RunAs`, which is what produces the UAC dialog. `-Wait` matters:
 * without it this returns before the elevated work has happened and the
 * installer reports success it has not yet earned.
 */
async function elevate(paths, lines) {
  const script = join(paths.root, "downloads", "elevate.cmd");
  // An upgrade skips the PostgreSQL download, so `downloads` may not exist.
  await mkdir(join(paths.root, "downloads"), { recursive: true });
  await writeFile(script, ["@echo off", ...lines, "exit /b 0", ""].join("\r\n"), "utf8");

  await run("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-Command",
    `$p = Start-Process -FilePath cmd.exe -ArgumentList '/c','"${script}"' ` +
      `-Verb RunAs -Wait -PassThru; exit $p.ExitCode`,
  ]);
}

export async function installWindowsService(paths, nodePath, runner, appPort) {
  const script = await writeRunner(paths, nodePath, runner);

  // ONSTART as SYSTEM is the one that matches what this is for: the machine
  // comes back after a power cut with nobody in the building to log in.
  const systemTask = [
    `schtasks /Create /TN "${TASK_NAME}" /SC ONSTART /RU SYSTEM /RL HIGHEST /F /TR "\\"${script}\\""`,
    `if errorlevel 1 exit /b 1`,
    `netsh advfirewall firewall delete rule name="${FIREWALL_RULE}" > nul 2>&1`,
    `netsh advfirewall firewall add rule name="${FIREWALL_RULE}" dir=in action=allow ` +
      `protocol=TCP localport=${appPort} profile=private,domain`,
    `if errorlevel 1 exit /b 1`,
    `schtasks /Run /TN "${TASK_NAME}"`,
  ];

  try {
    await elevate(paths, systemTask);
    return {
      installed: true,
      kind: "scheduled task",
      unit: TASK_NAME,
      firewall: true,
      script,
    };
  } catch {
    ui.warn("administrator rights were declined, or the elevated step failed");
  }

  /* ------------------------------------------------------- the fallback */

  // Without elevation the task can still be registered for this user, at
  // logon. That is a genuinely weaker promise and is reported as one: the
  // pharmacy comes back when somebody logs in, not when the machine boots.
  try {
    await run("schtasks", [
      "/Create",
      "/TN", TASK_NAME,
      "/SC", "ONLOGON",
      "/F",
      "/TR", `"${script}"`,
    ]);
    await run("schtasks", ["/Run", "/TN", TASK_NAME]).catch(() => {});

    return {
      installed: true,
      kind: "scheduled task (this user, at logon)",
      unit: TASK_NAME,
      firewall: false,
      script,
      warning:
        "Two things still need an administrator, once. Right-click Command\n" +
        "Prompt, choose \"Run as administrator\", and paste these:\n\n" +
        `  netsh advfirewall firewall add rule name="${FIREWALL_RULE}" dir=in ` +
        `action=allow protocol=TCP localport=${appPort} profile=private,domain\n` +
        `  schtasks /Create /TN "${TASK_NAME}" /SC ONSTART /RU SYSTEM /RL HIGHEST /F /TR "\\"${script}\\""\n\n` +
        "The first lets the till reach the pharmacy at all. The second makes it\n" +
        "come back after a power cut without anyone logging in.",
    };
  } catch (error) {
    return { installed: false, reason: `could not register a scheduled task: ${error.message}` };
  }
}

/**
 * A double-clickable icon for the control panel, on the Desktop and in the
 * Start Menu.
 *
 * A `.lnk` rather than putting the `.cmd` on the Desktop, for two reasons: a
 * shortcut can be told to start minimised, so a console window does not flash
 * up and sit there behind the browser, and it can carry a name with a space in
 * it. `WScript.Shell` is the only way to write one without a compiler, and it
 * has been present on every Windows for twenty years.
 *
 * Failing to create it is not failing to install. The panel is still there as
 * `pharmacy-panel.cmd`; the shortcut is a convenience and is reported as one.
 */
/**
 * A string PowerShell will read back exactly as given.
 *
 * Single-quoted, because PowerShell does not interpret anything inside those
 * -- no `$`, no backtick, and above all no backslash escapes. `JSON.stringify`
 * looks like it would do for this and does not: it is JavaScript escaping, so
 * `C:\Users\...` goes out as `C:\\Users\\...` and comes back as a path with
 * every separator eaten. The only character that needs care here is `'`, which
 * is escaped by doubling it.
 */
function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export async function installPanelShortcut(paths, target) {
  // Plain ASCII deliberately. This name is handed to PowerShell through a
  // command line, and a non-ASCII character there depends on the console code
  // page -- which is how you get a shortcut called "Apotek ΓÇô Panel".
  const shortcut = "Panel Kontrol Apotek.lnk";

  // 7 is minimised. The wrapper has nothing to show; the browser is the UI.
  const script = [
    "$shell = New-Object -ComObject WScript.Shell",
    "foreach ($dir in @([Environment]::GetFolderPath('Desktop'), " +
      "[Environment]::GetFolderPath('StartMenu'))) {",
    `  if (-not $dir) { continue }`,
    `  $link = $shell.CreateShortcut((Join-Path $dir ${quote(shortcut)}))`,
    `  $link.TargetPath = ${quote(target)}`,
    `  $link.WorkingDirectory = ${quote(paths.root)}`,
    "  $link.WindowStyle = 7",
    "  $link.Description = 'Panel kontrol Apotek'",
    "  $link.Save()",
    "}",
  ].join("\n");

  try {
    await run("powershell", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-Command", script,
    ]);
    ui.detail("a shortcut was added to the Desktop and Start Menu");
    return true;
  } catch {
    ui.warn("could not create the Desktop shortcut; open pharmacy-panel.cmd instead");
    return false;
  }
}

/**
 * Starts the boot task, elevating if the operator is not allowed to.
 *
 * The exact mirror of stopping, and for the same reason: the task runs as
 * SYSTEM with `/RL HIGHEST`, so `schtasks /Run` is refused with "Access is
 * denied" for anyone who is not an administrator. The installer never noticed
 * because its `/Run` happens inside the elevated batch that registers the task
 * in the first place -- so this only bites afterwards, from the control panel
 * or `pharmacy start`, which is exactly when the pharmacy is already down.
 *
 * Tried unelevated first: a task registered by the fallback path runs as the
 * operator, and that one needs no prompt at all.
 */
export async function startWindowsService(paths) {
  try {
    await run("schtasks", ["/Run", "/TN", TASK_NAME]);
    return { ok: true };
  } catch {
    ui.detail("starting the pharmacy needs administrator rights");
  }

  try {
    await elevate(paths, [`schtasks /Run /TN "${TASK_NAME}"`, "exit /b %ERRORLEVEL%"]);
  } catch {
    return {
      ok: false,
      reason: "the pharmacy could not be started.",
      remedy:
        "It runs as SYSTEM, so only an administrator can start it. Right-click\n" +
        "Command Prompt, choose \"Run as administrator\", and run:\n\n" +
        `  schtasks /Run /TN "${TASK_NAME}"`,
    };
  }
  return { ok: true };
}

/**
 * Stops a pharmacy that the boot task started, which the operator cannot.
 *
 * Once the ONSTART task has run, the pharmacy and its PostgreSQL belong to
 * SYSTEM. The installer runs as the operator, and an upgrade then cannot stop
 * either of them: `schtasks /End` on a SYSTEM task and `pg_ctl stop` against a
 * SYSTEM-owned server are both refused. Those refusals used to be swallowed, so
 * the install carried on and died several steps later with
 *
 *   pg_ctl: could not open log file "...\logs\postgres.log": Permission denied
 *
 * which is the running server still holding that file, and says so nowhere.
 * Every upgrade after the machine's first reboot hit this.
 *
 * So: try it unelevated first -- on a machine that has not rebooted yet the
 * pharmacy is the operator's own and no prompt is needed -- and only ask for
 * administrator rights if something is still holding the port.
 */
export async function stopWindowsService(paths, pgPort) {
  const pgCtl = join(paths.postgres, "bin", "pg_ctl.exe");

  await run("schtasks", ["/End", "/TN", TASK_NAME]).catch(() => {});
  await run(pgCtl, ["--pgdata", paths.data, "--mode", "fast", "stop"]).catch(() => {});

  if (!(await portInUse(pgPort))) return { ok: true };

  ui.detail("the pharmacy is running as SYSTEM; stopping it needs administrator rights");
  try {
    await elevate(paths, [
      `schtasks /End /TN "${TASK_NAME}"`,
      `"${pgCtl}" --pgdata "${paths.data}" --mode fast stop`,
      "exit /b 0",
    ]);
  } catch {
    ui.warn("could not stop the running pharmacy");
  }

  // Stopping is asynchronous enough that the port outlives the command.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!(await portInUse(pgPort))) return { ok: true };
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // Returned, not `ui.fail`ed. `ui.fail` exits the process, which is right for
  // an installer and fatal for the control panel: a declined UAC prompt would
  // kill the server mid-request and the operator would get a dead connection
  // instead of the sentence below. The caller decides how to say it.
  return {
    ok: false,
    reason: "the pharmacy is still running, and its files cannot be replaced while it is.",
    remedy:
      "It was started by the boot task, so it belongs to SYSTEM and only an\n" +
      "administrator can stop it. Right-click Command Prompt, choose \"Run as\n" +
      "administrator\", and run:\n\n" +
      `  schtasks /End /TN "${TASK_NAME}"\n` +
      `  "${pgCtl}" --pgdata "${paths.data}" --mode fast stop\n\n` +
      "Then try again.",
  };
}

export async function removeWindowsService() {
  await run("schtasks", ["/End", "/TN", TASK_NAME]).catch(() => {});
  await run("schtasks", ["/Delete", "/TN", TASK_NAME, "/F"]).catch(() => {});
  // The firewall rule needs administrator rights to remove, and leaving it
  // behind opens nothing: with no listener, the port refuses connections.
  return true;
}
