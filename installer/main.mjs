import { randomBytes } from "node:crypto";
import { copyFile, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  exists,
  freeSpaceGb,
  has,
  isWindows,
  lanAddress,
  launcher,
  layout,
  npm,
  run,
  sourceFilter,
  targetTriple,
  ui,
  updateEnv,
} from "./lib.mjs";
import {
  connectionUrl,
  createDatabase,
  DEFAULT_PORT,
  fetchPostgres,
  initCluster,
  portInUse,
  startServer,
  stopServer,
  waitUntilReady,
} from "./postgres.mjs";
import { backup } from "./operations.mjs";
import { ensureRclone, RCLONE_VERSION } from "./cloud.mjs";
import { installPanelShortcut as installMacPanelShortcut } from "./macos.mjs";
import { installService } from "./service.mjs";
import {
  ensureVisualCppRuntime,
  installPanelShortcut as installWindowsPanelShortcut,
  stopWindowsService,
} from "./windows.mjs";

/**
 * The installer.
 *
 * From a machine with nothing on it to a pharmacy the tills can open, in one
 * command. It does the nine things DEPLOY.md used to ask a person to do, in the
 * order they have to happen, and stops with a sentence if any of them cannot.
 *
 * Two traps it handles rather than documents, because both waste an afternoon
 * and neither announces itself:
 *
 *   - `COOKIE_SECURE` must be false over plain HTTP or sign-in fails silently.
 *   - The address to open is the machine's LAN address, never localhost, since
 *     it is opened from a different machine.
 */

const APP_PORT = Number(process.env.PHARMACY_APP_PORT ?? 3000);

function argument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function defaultRoot() {
  // Under the operator's home directory, so nothing needs administrator rights
  // and uninstalling is deleting a folder they own.
  return join(homedir(), "pharmacy");
}

/**
 * Brings a running installation down before its files are replaced.
 *
 * Rebuilding underneath a running Next server is how an upgrade produces a
 * half-served application: the service is stopped, then restarted at the end by
 * registering it again.
 */
async function stopRunningInstance(paths, ports) {
  if (process.platform === "darwin") {
    await run("launchctl", [
      "bootout",
      `gui/${process.getuid?.() ?? 501}`,
      `${homedir()}/Library/LaunchAgents/id.apotek.pharmacy.plist`,
    ]).catch(() => {});
    await stopServer(paths).catch(() => {});
  } else if (process.platform === "linux") {
    await run("systemctl", ["--user", "stop", "pharmacy.service"]).catch(() => {});
    await stopServer(paths).catch(() => {});
  } else if (isWindows) {
    // Windows needs its own routine: after the machine has booted once, this
    // pharmacy belongs to SYSTEM and the operator cannot stop it unaided.
    // Swallowing that failure here is what produced a "Permission denied" on a
    // log file three steps later. See stopWindowsService.
    //
    // It reports rather than exits, because the control panel calls it too and
    // must not be killed by a declined prompt. For the installer, though, a
    // pharmacy that will not stop is the end of the road: the next step
    // overwrites the files it is running from.
    const stopped = await stopWindowsService(paths, ports);
    if (!stopped.ok) ui.fail(stopped.reason, stopped.remedy);
  }
  ui.detail("stopped the running pharmacy");
}

/**
 * Puts the previous version back when an upgrade fails partway, or null when
 * there is nothing to put back -- a first install, or an upgrade whose old
 * folder could not be set aside. See step 4.
 */
let restorePrevious = null;

export async function install() {
  const root = resolve(argument("dir", defaultRoot()));
  const paths = layout(root);
  const pgPort = Number(argument("db-port", DEFAULT_PORT));
  const appPort = Number(argument("port", APP_PORT));
  const source = resolve(argument("source", process.cwd()));

  ui.title("Pharmacy Stock Ledger — install");
  ui.info(`Installing into ${root}`);
  ui.detail(
    isWindows
      ? "Nothing outside this folder is modified, except the Microsoft Visual\n" +
          "   C++ runtime, which PostgreSQL needs and Windows does not ship."
      : "Nothing outside this folder is modified.",
  );

  /* --------------------------------------------------------- 1. preflight */

  ui.step("Checking the machine");

  if (!targetTriple()) {
    ui.fail(
      `unsupported platform: ${process.platform}/${process.arch}.`,
      "See DEPLOY.md for the manual path.",
    );
  }
  ui.ok(`${process.platform}/${process.arch}`);

  const [major] = process.versions.node.split(".").map(Number);
  if (major < 20) {
    ui.fail(
      `Node ${process.versions.node} is too old; 20 or newer is needed.`,
      "The launcher normally handles this. Install Node 22 and run it again.",
    );
  }
  ui.ok(`Node ${process.versions.node}`);

  // PostgreSQL, the dependencies and the build come to roughly 1.5 GB, and the
  // database grows from there. Refusing now is far kinder than a build that
  // fails halfway with an error about a truncated file.
  await mkdir(root, { recursive: true });
  const free = await freeSpaceGb(root);
  if (free !== null && free < 3) {
    ui.fail(
      `only ${free.toFixed(1)} GB free where this is being installed.`,
      "The install needs about 1.5 GB, and the pharmacy's records grow from\n" +
        "there. Free some space, or install onto another disk:\n" +
        "  PHARMACY_DIR=/path/with/room sh install-macos.command",
    );
  }
  if (free !== null) ui.ok(`${free.toFixed(1)} GB free`);

  if (!(await has("tar"))) {
    ui.fail("tar was not found, and it is needed to unpack PostgreSQL.");
  }

  // Before anything is downloaded or created, because the alternative is
  // finding out at initdb -- six steps in, with a data directory already on
  // disk and an exit code that names nothing.
  if (isWindows) await ensureVisualCppRuntime(paths);

  if (!(await exists(join(source, "package.json")))) {
    ui.fail(
      `no application found at ${source}.`,
      "Run the installer from inside the pharmacy folder, or pass --source <path>.",
    );
  }
  ui.ok("application source found");

  const alreadyInstalled = await exists(paths.config);

  if (alreadyInstalled) {
    // An upgrade, not a first install. The ports are almost certainly held by
    // the pharmacy itself, so stop it rather than refusing to proceed.
    ui.warn("an installation is already here; updating it");
    ui.detail("the database and its records are left exactly as they are");

    // Backed up and stopped in step 3, after the downloads -- see there.
  } else {
    // A first install refuses a port somebody else holds, rather than
    // discovering it later as a confusing failure against a foreign database.
    if (await portInUse(pgPort)) {
      ui.fail(
        `something is already listening on 127.0.0.1:${pgPort}.`,
        "That is probably another PostgreSQL. Pick a free port:\n" +
          `  ${launcher()} --db-port ${pgPort + 1}`,
      );
    }
    if (await portInUse(appPort)) {
      ui.fail(
        `something is already listening on port ${appPort}.`,
        `Pick a different one:\n  ${launcher()} --port ${appPort + 1}`,
      );
    }
    ui.ok(`ports ${pgPort} and ${appPort} are free`);
  }

  await mkdir(paths.backups, { recursive: true });
  await mkdir(paths.logs, { recursive: true });

  /* -------------------------------------------------------- 2. postgresql */

  ui.step("Fetching PostgreSQL");
  await fetchPostgres(paths);

  /* ------------------------------------------------- 2b. cloud backup tool */

  // Fetched now so that "Hubungkan Google Drive" in the control panel is one
  // click and a Google sign-in, not a download on the clinic's connection at
  // the moment the owner is waiting. Optional in the plainest sense: a
  // pharmacy that cannot fetch it today installs anyway, and the panel fetches
  // it later with the same function.
  ui.step("Fetching the cloud backup tool");
  const rclone = await ensureRclone(paths);
  if (rclone.ok) {
    ui.ok(rclone.fresh ? `rclone ${RCLONE_VERSION} downloaded` : `rclone ${RCLONE_VERSION} already here`);
  } else {
    ui.warn(`could not fetch rclone: ${rclone.reason}`);
    ui.detail("cloud backup can still be switched on later from the control panel");
  }

  /* -------------------------------------------------- 3. cluster and role */

  ui.step("Setting up the database");

  // An upgrade backs up and stops here, not back in step 1: nothing the
  // downloads above touch is in use by a running pharmacy, and on a clinic
  // connection rclone alone took ten minutes in testing -- ten minutes of a till
  // that could have been selling, and of sales a step-1 backup would miss.
  if (alreadyInstalled) {
    // Before anything is stopped or replaced, and while the database is still
    // up. An upgrade runs migrations against the pharmacy's live records; going
    // into that without a backup taken minutes ago is the one part of this
    // program that could lose a year of the ledger.
    //
    // A failure here warns rather than refuses, deliberately. The likeliest
    // reason a backup cannot be taken is a half-finished previous upgrade --
    // exactly the state whose fix is to run this again. Refusing would make a
    // broken install unrepairable by the only tool that repairs it.
    try {
      const existing = JSON.parse(await readFile(paths.config, "utf8"));
      const taken = await backup(paths, existing, { upload: false });
      ui.ok(`backed up first: ${taken.file ?? paths.backups}`);
    } catch (error) {
      ui.warn(`could not take a backup before upgrading: ${error.message}`);
      ui.detail("continuing, but there is no fresh backup of what is about to change");
    }

    await stopRunningInstance(paths, { pgPort, appPort });
  }

  // Generated, never typed, never shown. It only ever travels from this file to
  // the app's own config, both of which sit in the install directory.
  const config = alreadyInstalled
    ? JSON.parse(await readFile(paths.config, "utf8"))
    : { dbPassword: randomBytes(24).toString("base64url"), pgPort, appPort };

  const created = await initCluster(paths, config.dbPassword);

  // The moment the cluster exists, this password is the only one that will ever
  // open it -- it is baked into the role initdb created. Persist it here rather
  // than in step 5, because everything between the two is allowed to fail.
  //
  // It used to be written in step 5, and a first install that died anywhere in
  // between could not be resumed or repaired: `alreadyInstalled` keys off this
  // file, so the next run generated a fresh password, while initCluster quite
  // correctly refused to touch the cluster already on disk. Authentication then
  // failed forever, and the only way out was deleting a data directory -- which
  // for a real install is the one thing this program must never do.
  if (created) {
    await writeFile(paths.config, JSON.stringify(config, null, 2), { mode: 0o600 });
  } else if (!alreadyInstalled) {
    // A cluster on disk with no configuration beside it: the state an install
    // interrupted before the fix above used to leave. The password that opens
    // this cluster is gone, so nothing here can authenticate, and saying so
    // plainly beats the "password authentication failed" this became.
    //
    // Deliberately not offering to delete it. If that cluster holds a
    // pharmacy's records, deleting it is unrecoverable, and this program is in
    // no position to tell the difference.
    ui.fail(
      `there is a database at ${paths.data}, but no ${paths.config} to open it with.`,
      "The password was generated during an install that did not finish, and it\n" +
        "cannot be recovered.\n\n" +
        "If this machine has never held real pharmacy records, that database is\n" +
        "empty and safe to remove -- delete the folder above and run this again.\n\n" +
        "If it might hold records, do not delete it. Restore from a backup, or\n" +
        "see DEPLOY.md for opening the cluster by hand.",
    );
  }

  await startServer(paths, config.pgPort);
  if (!(await waitUntilReady(paths, config.pgPort))) {
    ui.fail(
      "the database did not start.",
      `Look at ${join(paths.logs, "postgres.log")} for the reason.`,
    );
  }
  ui.ok(`database listening on 127.0.0.1:${config.pgPort}`);
  await createDatabase(paths, config.pgPort, config.dbPassword);

  /* -------------------------------------------------------- 4. the app */

  ui.step("Installing the application");

  // An upgrade builds the new version into a fresh folder and keeps the old
  // one beside it until the new one is built and migrated. Copying over the
  // old folder in place meant a failed `npm ci` or build -- a dropped
  // connection is enough -- left no version at all: the build step had
  // already cleared `.next`, so the pharmacy would not even start again, and
  // the till stayed dark until somebody repaired it by hand.
  //
  // It also means a file the new version deleted is actually gone, rather
  // than left behind to be built into it.
  const previous = `${paths.app}-previous`;
  if (alreadyInstalled && resolve(paths.app) !== source && (await exists(paths.app))) {
    await rm(previous, { recursive: true, force: true });
    try {
      await rename(paths.app, previous);
      restorePrevious = async () => {
        await stopServer(paths).catch(() => {});
        await rm(paths.app, { recursive: true, force: true });
        await rename(previous, paths.app);
        const service = await installService(paths, config.appPort);
        return service.installed;
      };
    } catch (error) {
      // Windows refuses to rename a folder anything has open -- an Explorer
      // window, an antivirus scan. Upgrading in place still works; it only
      // loses the way back, and says so.
      ui.warn(`could not set the current version aside: ${error.message}`);
      ui.detail("updating in place; if this fails, run the update again");
    }
  }

  if (resolve(paths.app) !== source) {
    await cp(source, paths.app, {
      recursive: true,
      filter: sourceFilter(source),
    });
    ui.ok("files copied");
  }

  // The one file in the old folder that is the pharmacy's rather than the
  // release's. Step 5 then updates it exactly as it would have in place.
  if (restorePrevious && (await exists(join(previous, ".env.local")))) {
    await copyFile(join(previous, ".env.local"), join(paths.app, ".env.local"));
  }

  ui.info("installing dependencies — this takes a few minutes");
  await npm(["ci", "--no-audit", "--no-fund"], { cwd: paths.app });
  ui.ok("dependencies installed");

  /* ---------------------------------------------------------- 5. config */

  ui.step("Writing the configuration");

  const env = [
    "# Written by the installer. Edit it and restart with: pharmacy restart",
    `DATABASE_URL=${connectionUrl(config.pgPort, config.dbPassword)}`,
    "",
    "# A `secure` cookie is only sent over HTTPS, so this must match how the",
    "# pharmacy is actually reached. Served over plain HTTP on the clinic",
    "# network it has to be false -- with it on, sign-in fails silently and",
    "# nothing explains why. `pharmacy remote on` puts real HTTPS in front via",
    "# Tailscale and sets this to true; do not change it by hand.",
    "COOKIE_SECURE=false",
    "",
    "SESSION_TTL_HOURS=12",
    "PHARMACY_TIMEZONE=Asia/Jakarta",
    `PORT=${config.appPort}`,
    "",
  ].join("\n");

  const envFile = join(paths.app, ".env.local");

  if (alreadyInstalled) {
    // An upgrade updates only what the installer owns, and leaves the rest of
    // the file alone. Writing the template again would reset three settings the
    // operator is invited to change on the line above -- and `COOKIE_SECURE`
    // back to false, which silently breaks `pharmacy remote` sign-in on every
    // upgrade in a way that looks like the password being wrong.
    //
    // Keys the file lacks altogether are a different matter: they get the
    // template's value. A first install that stopped before this step wrote no
    // file, and its re-run lands here as an "upgrade" -- which used to leave
    // COOKIE_SECURE unset, so production defaulted it to true and nobody could
    // sign in from a till over plain HTTP. Present keys are never touched.
    const present = new Set(
      (await readFile(envFile, "utf8").catch(() => ""))
        .split("\n")
        .map((line) => /^\s*([A-Z0-9_]+)\s*=/u.exec(line)?.[1])
        .filter(Boolean),
    );
    const missing = Object.fromEntries(
      env
        .split("\n")
        .map((line) => /^([A-Z0-9_]+)=(.*)$/u.exec(line))
        .filter((match) => match && !present.has(match[1]))
        .map((match) => [match[1], match[2]]),
    );
    await updateEnv(envFile, {
      ...missing,
      DATABASE_URL: connectionUrl(config.pgPort, config.dbPassword),
      PORT: config.appPort,
    });
    const added = Object.keys(missing).filter((key) => key !== "DATABASE_URL" && key !== "PORT");
    if (added.length > 0) ui.detail(`added missing settings: ${added.join(", ")}`);
    ui.ok("configuration updated");
    ui.detail("your settings in .env.local were left as they are");
  } else {
    await writeFile(envFile, env, "utf8");
    ui.ok("configuration written");
    ui.detail("timezone is Asia/Jakarta; change it in Settings once you sign in");
  }

  // Running the installer is the one thing that turns `pharmacy disable` back
  // off. `installService` a few steps down re-registers the boot service
  // regardless of whether it was ever removed; clearing the flag here is what
  // lets the control panel and `pharmacy start` work again once it has.
  delete config.disabled;
  await writeFile(paths.config, JSON.stringify(config, null, 2), { mode: 0o600 });

  /* ----------------------------------------------------------- 6. build */

  ui.step("Building");
  ui.info("this is the slow step — a few minutes on a small machine");
  await npm(["run", "build"], { cwd: paths.app });
  ui.ok("built");

  /* ------------------------------------------------------- 7. migrations */

  ui.step("Preparing the database");
  await npm(["run", "db:migrate"], { cwd: paths.app });
  ui.ok("schema up to date");

  // Built and migrated: the new version stands on its own, and the old one is
  // only disk space now.
  if (restorePrevious) {
    restorePrevious = null;
    await rm(previous, { recursive: true, force: true }).catch(() => {});
  }

  /* ----------------------------------------------------- 8. owner account */

  // Always run, and let the database decide. `db:seed` is idempotent: it leaves
  // an existing owner alone and prints no password for one it did not create.
  //
  // This used to be gated on `alreadyInstalled`, which is a guess about the
  // database made from a file beside it. The guess broke as soon as the config
  // began being written early: an install that failed after the cluster existed
  // then looked like an upgrade on the next run, so seeding was skipped and the
  // pharmacy came up with no owner and no way to sign in -- reporting success
  // the whole way.
  ui.step("Creating the owner account");
  const seeded = await npm(["run", "db:seed"], { cwd: paths.app });
  const ownerPassword = /Temporary password\s*:\s*(\S+)/u.exec(seeded)?.[1] ?? null;
  ui.ok(ownerPassword ? "owner account created" : "owner account already exists");

  // A new pharmacy opens on a sample one, so the owner can learn the till and
  // follow the tutorial on something that looks real before entering their
  // own stock. Only when this run created the owner -- a brand-new database --
  // and the script checks again for itself: an update must never bring the
  // samples back after the owner cleared them, or mix them into real data.
  let demoLoaded = false;
  if (ownerPassword) {
    ui.step("Loading the sample pharmacy");
    try {
      const demo = await npm(["run", "db:demo"], { cwd: paths.app });
      demoLoaded = /Rang up \d+ sample sales/u.test(demo);
      ui.ok(demoLoaded ? "sample medicines, stock and sales loaded" : "skipped");
    } catch {
      // Samples are a courtesy. A pharmacy that starts empty still works.
      ui.warn("the sample data could not be loaded; the pharmacy starts empty");
    }
  }

  /* -------------------------------------------------- 9. control command */

  ui.step("Adding the pharmacy command");

  // A tiny wrapper so the owner types `pharmacy status`, not a node invocation
  // with two paths in it. It pins the install root, so it works from anywhere.
  const controlModule = join(paths.app, "installer", "control.mjs");
  const controlPath = join(root, isWindows ? "pharmacy.cmd" : "pharmacy");

  if (isWindows) {
    // `%*` forwards the arguments; `set` rather than an inline assignment,
    // which cmd does not have. Double-clickable as well as typeable.
    await writeFile(
      controlPath,
      [
        "@echo off",
        "REM Control the pharmacy. Written by the installer.",
        `set "PHARMACY_ROOT=${root}"`,
        `"${process.execPath}" "${controlModule}" %*`,
        "",
      ].join("\r\n"),
      "utf8",
    );
  } else {
    await writeFile(
      controlPath,
      [
        "#!/bin/sh",
        "# Control the pharmacy. Written by the installer.",
        `PHARMACY_ROOT=${JSON.stringify(root)} exec ${JSON.stringify(process.execPath)} \\`,
        `  ${JSON.stringify(controlModule)} "$@"`,
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
  }
  ui.ok(`${controlPath} created`);

  // The same thing with a face on it, for the owner who is not going to type
  // any of the above. It only ever reads and drives what the command does.
  const panelModule = join(paths.app, "installer", "panel.mjs");
  const panelPath = join(root, isWindows ? "pharmacy-panel.cmd" : "pharmacy-panel");

  if (isWindows) {
    await writeFile(
      panelPath,
      [
        "@echo off",
        "REM Opens the pharmacy control panel. Written by the installer.",
        `set "PHARMACY_ROOT=${root}"`,
        `"${process.execPath}" "${panelModule}"`,
        "",
      ].join("\r\n"),
      "utf8",
    );
    await installWindowsPanelShortcut(paths, panelPath);
  } else {
    await writeFile(
      panelPath,
      [
        "#!/bin/sh",
        "# Opens the pharmacy control panel. Written by the installer.",
        `PHARMACY_ROOT=${JSON.stringify(root)} exec ${JSON.stringify(process.execPath)} \\`,
        `  ${JSON.stringify(panelModule)}`,
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    if (process.platform === "darwin") {
      await installMacPanelShortcut(paths, panelPath);
    }
  }
  ui.ok(`${panelPath} created`);

  /* -------------------------------------------------------- 10. service */

  ui.step("Making it start by itself");
  const service = await installService(paths, config.appPort);
  if (service.installed) {
    ui.ok(`${service.kind} registered — it will start after a power cut`);
  } else {
    ui.warn(service.reason);
    ui.detail(`Start it by hand with: ${controlPath} start`);
  }
  if (service.firewall) {
    ui.ok(`the firewall now allows the till to reach port ${config.appPort}`);
  }
  if (service.warning) {
    ui.blank();
    ui.warn("Not finished:");
    for (const line of service.warning.split("\n")) ui.info(line);
  }

  /* ------------------------------------------------------------- done */

  await stopServer(paths).catch(() => {});

  const address = `http://${lanAddress()}:${config.appPort}`;
  ui.title("Installed");

  if (ownerPassword) {
    ui.info("Sign in as the owner with this password. It is shown once:");
    ui.box([`username:  pemilik`, `password:  ${ownerPassword}`]);
    ui.info("Write it down now. You will be asked to replace it immediately.");
    ui.blank();
  }

  if (demoLoaded) {
    ui.info("It opens with sample medicines, stock and sales to practise on.");
    ui.detail("Clear them before entering your own medicines, because clearing");
    ui.detail("empties the whole catalogue: Pengaturan > Data demo, type HAPUS DEMO.");
    ui.blank();
  }

  ui.info(`Open this from the till:  ${address}`);
  ui.blank();

  // Named before the commands, because for the person who owns this pharmacy
  // it replaces all three of them. An icon nobody is told about is an icon
  // nobody clicks.
  ui.info("On this machine, to check on it:");
  if (isWindows) {
    ui.detail("Panel Kontrol Apotek, on the Desktop and in the Start Menu");
  } else if (process.platform === "darwin") {
    ui.detail("Panel Kontrol Apotek, on the Desktop and in ~/Applications");
  } else {
    ui.detail(`${panelPath}`);
  }
  ui.blank();
  ui.info("Or from a terminal:");
  ui.detail(`${controlPath} status     is it running?`);
  ui.detail(`${controlPath} backup     take a backup now`);
  ui.detail(`${controlPath} logs       what it has been doing`);
  ui.blank();
  ui.info("Next: read GO-LIVE.md. Rehearse a restore before real data goes in.");
  ui.blank();
}

/**
 * A failed install must not leave a database running.
 *
 * It did once, during development: the installer stopped halfway, its
 * PostgreSQL kept listening, the next attempt deleted the data directory
 * underneath it, and the still-running server then failed with a message about
 * a missing internal file that explained nothing. Stopping on the way out is
 * what makes "run it again" the right advice.
 */
install().catch(async (error) => {
  const root = resolve(argument("dir", defaultRoot()));
  const restored = restorePrevious
    ? await restorePrevious().catch((restoreError) => {
        ui.warn(`could not put the previous version back: ${restoreError.message}`);
        return false;
      })
    : false;
  if (!restored) await stopServer(layout(root)).catch(() => {});
  ui.fail(
    error.message ?? String(error),
    restored
      ? "Nothing was changed: the previous version was put back and started\n" +
          "again, so the pharmacy is running as it was before. Run the update\n" +
          "again once the problem above is sorted out."
      : undefined,
  );
});
