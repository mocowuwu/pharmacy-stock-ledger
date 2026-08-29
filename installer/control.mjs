import { readFile, readdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { exists, has, lanAddress, layout, run, ui } from "./lib.mjs";
import {
  binDirectory,
  connectionUrl,
  isAccepting,
  startServer,
  stopServer,
  waitUntilReady,
} from "./postgres.mjs";
import { removeService } from "./service.mjs";

/**
 * `pharmacy <command>` — what the owner needs after the install.
 *
 * Deliberately short: start, stop, status, backup, logs, uninstall. Anything
 * more is a thing to remember, and this is used perhaps once a month by
 * somebody whose job is dispensing medicine.
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

const SERVICE = {
  darwin: {
    start: ["launchctl", ["kickstart", `gui/${process.getuid?.() ?? 501}/id.apotek.pharmacy`]],
    stop: ["launchctl", ["kill", "SIGTERM", `gui/${process.getuid?.() ?? 501}/id.apotek.pharmacy`]],
  },
  linux: {
    start: ["systemctl", ["--user", "start", "pharmacy.service"]],
    stop: ["systemctl", ["--user", "stop", "pharmacy.service"]],
  },
};

const commands = {
  async start() {
    const service = SERVICE[process.platform];
    if (service) {
      await run(...service.start);
      ui.ok("started");
    } else {
      ui.fail("no service integration on this platform; run installer/run.mjs yourself");
    }
    await commands.status();
  },

  async stop() {
    const service = SERVICE[process.platform];
    if (service) await run(...service.stop).catch(() => {});
    await stopServer(paths).catch(() => {});
    ui.ok("stopped");
  },

  async restart() {
    await commands.stop();
    await commands.start();
  },

  async status() {
    const { pgPort, appPort } = await config();

    const db = await isAccepting(paths, pgPort);
    ui.info(`database   ${db ? "running" : "not running"}  (127.0.0.1:${pgPort})`);

    let app = false;
    try {
      const response = await fetch(`http://127.0.0.1:${appPort}/login`, {
        signal: AbortSignal.timeout(3_000),
      });
      app = response.ok;
    } catch {
      app = false;
    }
    ui.info(`pharmacy   ${app ? "running" : "not running"}  (port ${appPort})`);

    if (app) {
      ui.blank();
      ui.info(`Open from the till:  http://${lanAddress()}:${appPort}`);
    } else {
      ui.blank();
      ui.info("Not answering. Look at the log:  pharmacy logs");
    }
  },

  /**
   * A backup, now.
   *
   * Starts the database if it is not up, because the most likely moment
   * somebody runs this by hand is when something is wrong.
   */
  async backup() {
    const { pgPort, dbPassword } = await config();

    if (!(await isAccepting(paths, pgPort))) {
      ui.info("database was not running; starting it for the backup");
      await startServer(paths, pgPort);
      await waitUntilReady(paths, pgPort);
    }

    await run("npm", ["run", "backup", "--", "--out", paths.backups], {
      cwd: paths.app,
      env: {
        DATABASE_URL: connectionUrl(pgPort, dbPassword),
        // The bundled pg_dump, not whatever may be on PATH: a version mismatch
        // between dump and server is a restore that fails when it is needed.
        // The bundled bin first, then the directory holding the Node that is
        // running this -- npm lives beside it, and cron has no useful PATH.
        PATH: `${binDirectory(paths)}:${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
      },
      inherit: true,
    });
  },

  async logs() {
    const file = join(paths.logs, "pharmacy.log");
    if (!(await exists(file))) {
      ui.info("no log yet — the pharmacy has not started since it was installed");
      return;
    }
    if (await has("tail")) {
      await run("tail", ["-n", "60", file], { inherit: true });
    } else {
      console.log((await readFile(file, "utf8")).split("\n").slice(-60).join("\n"));
    }
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
    ui.info("logs       the last 60 lines");
    ui.info("uninstall  remove the software, keeping the records");
    ui.blank();
    process.exit(command === "help" || command === "--help" ? 0 : 1);
  }

  await action();
}

main().catch((error) => ui.fail(error.message ?? String(error)));
