import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { exists, run } from "./lib.mjs";

/**
 * Making the pharmacy come back on its own.
 *
 * A clinic loses power. Nobody should have to know a command to reopen the
 * till, so the supervisor is registered with whatever the platform uses to
 * start things.
 *
 * Both paths register **for the logged-in user, not the system**, so no
 * administrator password is needed. The trade is real and worth naming: a
 * user-level service starts when that user's session does. On Linux that needs
 * lingering enabled, which the installer turns on if it can and reports if it
 * cannot.
 */

const LABEL = "id.apotek.pharmacy";

export async function installService(paths) {
  const nodePath = process.execPath;
  // The installer copies itself into the application folder, so the runner
  // lives beside the code it starts rather than at the install root.
  const runner = join(paths.app, "installer", "run.mjs");

  if (process.platform === "darwin") {
    return installLaunchd(paths, nodePath, runner);
  }
  if (process.platform === "linux") {
    return installSystemd(paths, nodePath, runner);
  }
  return {
    installed: false,
    reason: `no service integration for ${process.platform} yet`,
  };
}

/* ------------------------------------------------------------------ macOS */

async function installLaunchd(paths, nodePath, runner) {
  const directory = join(homedir(), "Library", "LaunchAgents");
  const plist = join(directory, `${LABEL}.plist`);

  await mkdir(directory, { recursive: true });
  await writeFile(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${runner}</string>
    <string>${paths.root}</string>
  </array>
  <key>WorkingDirectory</key><string>${paths.root}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${join(paths.logs, "pharmacy.log")}</string>
  <key>StandardErrorPath</key><string>${join(paths.logs, "pharmacy.log")}</string>
</dict>
</plist>
`,
    "utf8",
  );

  // bootout first so a reinstall replaces rather than stacks.
  const target = `gui/${process.getuid?.() ?? 501}`;
  await run("launchctl", ["bootout", target, plist]).catch(() => {});
  await run("launchctl", ["bootstrap", target, plist]);

  return { installed: true, kind: "launchd", unit: plist };
}

/* ------------------------------------------------------------------ Linux */

async function installSystemd(paths, nodePath, runner) {
  if (!(await exists("/run/systemd/system"))) {
    return { installed: false, reason: "systemd is not running on this machine" };
  }

  const directory = join(homedir(), ".config", "systemd", "user");
  const unit = join(directory, "pharmacy.service");

  await mkdir(directory, { recursive: true });
  await writeFile(
    unit,
    `[Unit]
Description=Pharmacy Stock Ledger
After=network.target

[Service]
Type=simple
WorkingDirectory=${paths.root}
ExecStart=${nodePath} ${runner} ${paths.root}
Restart=always
RestartSec=5
# The supervisor stops PostgreSQL itself on the way down; give it room.
TimeoutStopSec=30

[Install]
WantedBy=default.target
`,
    "utf8",
  );

  await run("systemctl", ["--user", "daemon-reload"]);
  await run("systemctl", ["--user", "enable", "--now", "pharmacy.service"]);

  // Without lingering, a user service stops when the operator logs out and does
  // not come back after a reboot -- which is exactly the case this exists for.
  // It needs root, so it is attempted and reported rather than assumed.
  const user = process.env.USER ?? process.env.LOGNAME;
  const lingered = await run("loginctl", ["enable-linger", user])
    .then(() => true)
    .catch(() => false);

  return {
    installed: true,
    kind: "systemd",
    unit,
    warning: lingered
      ? null
      : `Run this once as an administrator, or the pharmacy will not start after a reboot:\n  sudo loginctl enable-linger ${user}`,
  };
}

/* --------------------------------------------------------------- removal */

export async function removeService() {
  if (process.platform === "darwin") {
    const plist = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
    const target = `gui/${process.getuid?.() ?? 501}`;
    await run("launchctl", ["bootout", target, plist]).catch(() => {});
    return true;
  }
  if (process.platform === "linux") {
    await run("systemctl", ["--user", "disable", "--now", "pharmacy.service"]).catch(
      () => {},
    );
    return true;
  }
  return false;
}
