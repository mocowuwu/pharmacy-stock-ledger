import { readFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { exists, launcher, layout, ui } from "./lib.mjs";
import * as operations from "./operations.mjs";
import * as remote from "./remote.mjs";
import { removeService } from "./service.mjs";

/**
 * `pharmacy <command>` — what the owner needs after the install.
 *
 * Deliberately short: start, stop, status, backup, logs, uninstall. Anything
 * more is a thing to remember, and this is used perhaps once a month by
 * somebody whose job is dispensing medicine.
 *
 * The work itself is in `operations.mjs`; this file only prints. The control
 * panel drives the same operations and renders them as a page, and neither is
 * allowed its own opinion about what "running" means.
 */

const root = resolve(process.env.PHARMACY_ROOT ?? process.cwd());
const paths = layout(root);

async function config() {
  if (!(await exists(paths.config))) {
    ui.fail(
      `no installation found at ${root}.`,
      "Run this from inside the pharmacy folder.",
    );
  }
  return JSON.parse(await readFile(paths.config, "utf8"));
}

/** Prints a status result. Shared by `status`, `start` and `restart`. */
function report(state) {
  ui.info(`database   ${state.database ? "running" : "not running"}  (127.0.0.1:${state.pgPort})`);
  ui.info(`pharmacy   ${state.app ? "running" : "not running"}  (port ${state.appPort})`);
  ui.blank();
  if (state.app) ui.info(`Open from the till:  ${state.address}`);
  else ui.info("Not answering. Look at the log:  pharmacy logs");
}

/**
 * Refuses the commands that would bring a disabled pharmacy back, with the
 * one sentence that matters: what actually undoes it.
 */
function refuseIfDisabled(current) {
  if (!current.disabled) return;
  ui.fail(
    "the pharmacy is disabled.",
    `Run the installer again to turn it back on:  ${launcher()}`,
  );
}

const commands = {
  async start() {
    const current = await config();
    refuseIfDisabled(current);
    const result = await operations.start(paths, current);
    if (!result.ok) {
      ui.fail(`${result.reason}; run installer/run.mjs yourself`);
    }
    ui.ok("started");
    report(result.status);
  },

  async stop() {
    if (operations.stoppingNeedsAdministrator()) {
      ui.detail("this may ask for administrator rights");
    }
    const result = await operations.stop(paths, await config());
    if (!result.ok) ui.fail(result.reason);
    ui.ok("stopped");
  },

  async restart() {
    const current = await config();
    refuseIfDisabled(current);
    const result = await operations.restart(paths, current);
    ui.ok("restarted");
    report(result.status);
  },

  async status() {
    const current = await config();
    report(await operations.status(paths, current));
    if (current.disabled) {
      ui.blank();
      ui.warn("disabled -- it will not start on its own, and the control panel will not open");
      ui.info(`To turn it back on:  ${launcher()}`);
    }
  },

  /**
   * The hard off switch: stops the pharmacy, unregisters it from starting on
   * its own, and shuts the control panel's own door on the way out too --
   * see disable() in operations.mjs for why that is one operation and not
   * three.
   *
   * There is deliberately no `pharmacy enable`. The only way back is running
   * the installer again, which is also what a machine that has actually
   * changed -- a new disk, a moved install -- needs anyway, and it re-checks
   * everything a silent flag flip would not.
   */
  async disable() {
    if (operations.stoppingNeedsAdministrator()) {
      ui.detail("this may ask for administrator rights");
    }
    const result = await operations.disable(paths, await config());
    if (!result.ok) ui.fail(result.reason);
    ui.ok("disabled");
    ui.blank();
    ui.info("It will not start on its own, and the control panel will not open.");
    ui.info(`To turn it back on:  ${launcher()}`);
  },

  /**
   * Puts the pharmacy on the tailnet, or takes it off again.
   *
   * The command list is deliberately short and this earns a place: where the
   * counter is in a different building from the machine, it is the difference
   * between a working till and a support call, and there is no other way to
   * do it.
   */
  async remote() {
    const wanted = process.argv[3];
    if (wanted !== "on" && wanted !== "off") {
      ui.fail("say which: pharmacy remote on   or   pharmacy remote off");
    }

    const current = await config();
    const result =
      wanted === "on"
        ? await remote.enableRemote(paths, current)
        : await remote.disableRemote(paths, current);

    if (!result.ok) ui.fail(result.reason, result.remedy);

    // Restarted rather than left to be restarted: the bind address and the
    // cookie flag are both read at startup, so until this happens the pharmacy
    // is still answering the old way and the address just printed is a lie.
    ui.info("restarting the pharmacy so the change takes effect");
    await operations.restart(paths, result.config);

    if (wanted === "off") {
      ui.ok("remote access off");
      return report(await operations.status(paths, result.config));
    }

    ui.ok("remote access on");
    if (result.note) {
      ui.blank();
      ui.warn(result.note);
    }
    ui.blank();
    ui.info(`Open this from the till:  ${result.address}`);
    ui.detail("every till needs Tailscale installed and signed in");
  },

  /**
   * A backup, now.
   *
   * Starts the database if it is not up, because the most likely moment
   * somebody runs this by hand is when something is wrong.
   */
  async backup() {
    // `inherit` so the backup script's own instructions -- copy it off the
    // machine, rehearse the restore -- reach the operator unchanged.
    const result = await operations.backup(paths, await config(), { inherit: true });
    if (result.startedDatabase) ui.detail("the database was not running; it was started for this");
  },

  /** Checks GitHub Releases for a newer version, without installing it. */
  async "check-update"() {
    const result = await operations.checkUpdate(paths);
    if (!result.ok) ui.fail(result.reason);
    if (!result.updateAvailable) {
      ui.ok(`up to date (${result.current})`);
      return;
    }
    ui.info(`update available: ${result.current} → ${result.latest}`);
    if (result.notes) {
      ui.blank();
      ui.info(result.notes);
    }
    ui.blank();
    ui.info("To install it:  pharmacy update");
  },

  /**
   * Downloads the latest release and installs it in place, the same way
   * running the installer again by hand would -- see update.mjs.
   */
  async update() {
    const current = await config();
    refuseIfDisabled(current);
    ui.info("this backs up the database first, then stops the pharmacy while it upgrades");
    const result = await operations.update(paths, current);
    if (!result.ok) ui.fail(result.reason);
    ui.ok(`updated to ${result.version}`);
    report(result.status);
  },

  async logs() {
    const { lines, missing } = await operations.logs(paths);
    if (missing) {
      ui.info("no log yet — the pharmacy has not started since it was installed");
      return;
    }
    console.log(lines.join("\n"));
  },

  /**
   * Removes the service and the software, and by default keeps the data.
   *
   * The records outlive the software: pharmacy records carry multi-year
   * retention, and somebody uninstalling to reinstall should not lose a year of
   * the ledger to a habit of typing yes.
   */
  async uninstall() {
    const keepData = !process.argv.includes("--delete-everything");

    ui.info("stopping…");
    await commands.stop().catch(() => {});
    await removeService().catch(() => {});

    if (keepData) {
      ui.info("taking a backup before removing anything");
      await commands.backup().catch(() => ui.warn("backup failed; stopping here"));

      await rm(paths.app, { recursive: true, force: true });
      await rm(paths.postgres, { recursive: true, force: true });

      ui.ok("software removed");
      ui.blank();
      ui.info("Kept, deliberately:");
      ui.detail(`${paths.data}     the database`);
      ui.detail(`${paths.backups}  backups`);
      ui.blank();
      ui.info("To remove those too:  pharmacy uninstall --delete-everything");
      return;
    }

    const backups = (await readdir(paths.backups).catch(() => [])).length;
    ui.warn(`This deletes the pharmacy's records and ${backups} backup(s). It cannot be undone.`);
    ui.info("Waiting 10 seconds. Press Ctrl+C to stop.");
    await new Promise((done) => setTimeout(done, 10_000));

    await rm(root, { recursive: true, force: true });
    ui.ok("everything removed");
  },
};

async function main() {
  const command = process.argv[2] ?? "status";
  const action = commands[command];

  if (!action) {
    ui.title("pharmacy");
    ui.info("start      start the pharmacy");
    ui.info("stop       stop it");
    ui.info("restart    stop then start");
    ui.info("status     is it running, and where to open it");
    ui.info("backup     take a backup now");
    ui.info("check-update   is a newer version published?");
    ui.info("update     download and install the latest version");
    ui.info("logs       the last 60 lines");
    ui.info("remote     on | off -- reach it from another building, via Tailscale");
    ui.info("disable    stop it and turn off autostart and the control panel");
    ui.info("uninstall  remove the software, keeping the records");
    ui.blank();
    process.exit(command === "help" || command === "--help" ? 0 : 1);
  }

  await action();
}

main().catch((error) => ui.fail(error.message ?? String(error)));
