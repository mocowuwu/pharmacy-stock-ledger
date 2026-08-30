import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { exists, isWindows, lanAddress, npm, pathWith, run } from "./lib.mjs";
import {
  binDirectory,
  connectionUrl,
  isAccepting,
  startServer,
  stopServer,
  waitUntilReady,
} from "./postgres.mjs";
import { startWindowsService, stopWindowsService } from "./windows.mjs";

/**
 * What the owner can do to a running pharmacy, as data rather than as printing.
 *
 * The same split the rest of the project uses: `src/lib/stock/*` holds the
 * rules and takes an executor, `src/lib/dal/*` wraps permissions and audit
 * around it. Here the rules take `(paths, config)` and return a result;
 * `control.mjs` prints it to a terminal and `panel.mjs` serialises it to a
 * browser. Neither has its own idea of what "stopped" means.
 *
 * Every function returns a plain object and throws only for genuinely
 * exceptional failures. "The pharmacy is down" is a value, not an exception --
 * it is the normal thing the owner opened this to find out.
 */

/** How the platform is asked to start and stop the supervisor. */
const SERVICE = {
  darwin: {
    start: ["launchctl", ["kickstart", `gui/${process.getuid?.() ?? 501}/id.apotek.pharmacy`]],
    stop: ["launchctl", ["kill", "SIGTERM", `gui/${process.getuid?.() ?? 501}/id.apotek.pharmacy`]],
  },
  linux: {
    start: ["systemctl", ["--user", "start", "pharmacy.service"]],
    stop: ["systemctl", ["--user", "stop", "pharmacy.service"]],
  },
  // Windows is deliberately absent. Both halves of it need to elevate -- the
  // task runs as SYSTEM, so `schtasks /Run` and `/End` are alike refused for
  // the operator -- and that does not fit a pair of argument arrays. It is
  // handled by startWindowsService and stopWindowsService before this map is
  // ever consulted.
};

/* ------------------------------------------------------------------ status */

/**
 * Whether each half is up, and where to open the pharmacy from the till.
 *
 * The app is asked over HTTP rather than by looking for a process: a Node that
 * is running but wedged is down as far as the till is concerned, and that is
 * the question being asked.
 */
export async function status(paths, config) {
  const database = await isAccepting(paths, config.pgPort);

  let app = false;
  try {
    const response = await fetch(`http://127.0.0.1:${config.appPort}/login`, {
      signal: AbortSignal.timeout(3_000),
    });
    app = response.ok;
  } catch {
    app = false;
  }

  const lan = `http://${lanAddress()}:${config.appPort}`;

  return {
    database,
    app,
    pgPort: config.pgPort,
    appPort: config.appPort,
    // `address` is whatever the till should actually type. On a remote install
    // that is the tailnet URL and the LAN address is not reachable at all --
    // the app is bound to loopback -- so printing the LAN one there would be
    // worse than printing nothing.
    address: config.remote && config.remoteAddress ? config.remoteAddress : lan,
    remote: Boolean(config.remote),
    lanAddress: lan,
  };
}

/* --------------------------------------------------------- start and stop */

/**
 * Waits for the app itself, not merely for the database under it.
 *
 * `waitUntilReady` answers for PostgreSQL, and Next needs several more seconds
 * after that. Returning at the database's readiness made `start` report success
 * while the panel beside it still said the pharmacy was not running -- true,
 * briefly, and exactly the kind of contradiction that makes somebody press the
 * button again.
 */
async function waitForApp(paths, config, seconds = 90) {
  for (let attempt = 0; attempt < seconds; attempt += 1) {
    const state = await status(paths, config);
    if (state.app) return state;
    await new Promise((done) => setTimeout(done, 1_000));
  }
  return status(paths, config);
}

export async function start(paths, config) {
  if (isWindows) {
    // Elevates if it has to -- `schtasks /Run` on a SYSTEM task is refused for
    // the operator exactly as `/End` is. See startWindowsService.
    const started = await startWindowsService(paths);
    if (!started.ok) {
      return {
        ok: false,
        reason: `${started.reason}\n\n${started.remedy}`,
        status: await status(paths, config),
      };
    }
    await waitUntilReady(paths, config.pgPort, 60).catch(() => false);
    return { ok: true, status: await waitForApp(paths, config) };
  }

  const service = SERVICE[process.platform];
  if (!service) {
    return { ok: false, reason: `no service integration for ${process.platform}` };
  }

  await run(...service.start);
  // Asking the service to run is not the same as the pharmacy being up; the
  // supervisor still has to bring PostgreSQL round. Report what is true when
  // the waiting is over, not what was true a millisecond after asking.
  await waitUntilReady(paths, config.pgPort, 60).catch(() => false);
  return { ok: true, status: await status(paths, config) };
}

/**
 * Stops both halves.
 *
 * On Windows this is the operation that cannot be done unaided once the machine
 * has booted: the boot task runs the pharmacy as SYSTEM, and `schtasks /End`
 * and `pg_ctl stop` are both refused for the operator. `stopWindowsService`
 * elevates for exactly that and fails loudly rather than silently, so callers
 * get a truthful answer instead of a stop that did not happen.
 */
export async function stop(paths, config) {
  if (isWindows) {
    const stopped = await stopWindowsService(paths, config);
    return {
      ok: stopped.ok,
      // The remedy is the useful half -- the two commands to run as an
      // administrator -- so it travels with the refusal rather than being
      // printed somewhere the operator is not looking.
      reason: stopped.ok ? undefined : `${stopped.reason}\n\n${stopped.remedy}`,
      status: await status(paths, config),
    };
  }

  const service = SERVICE[process.platform];
  if (service) await run(...service.stop).catch(() => {});
  await stopServer(paths).catch(() => {});
  return { ok: true, status: await status(paths, config) };
}

export async function restart(paths, config) {
  await stop(paths, config);
  return start(paths, config);
}

/** Whether stopping will raise a UAC prompt, so the page can say so first. */
export function stoppingNeedsAdministrator() {
  return isWindows;
}

/* -------------------------------------------------------------- the jobs */

/**
 * The environment the pharmacy's own scripts need.
 *
 * Shared by the backup and the daily jobs, because getting the PATH wrong here
 * is not a missing command -- it is `pg_dump` from somewhere else on the
 * machine, at a version that does not match the server, producing a dump that
 * fails at the only moment anybody will ever need it.
 */
function jobEnv(paths, config) {
  return {
    DATABASE_URL: connectionUrl(config.pgPort, config.dbPassword),
    // The bundled bin first, then the directory holding the Node that is
    // running this -- npm lives beside it, and a service has no useful PATH.
    PATH: pathWith(binDirectory(paths), dirname(process.execPath)),
  };
}

/**
 * The daily three, in the order they have to happen.
 *
 * Alerts first, then the backup, then the digest: the digest reports on the
 * alert list the first job has just reconciled, so running them the other way
 * round emails yesterday's problems.
 */
export const DAILY_JOBS = ["alerts", "backup", "digest"];

/** Runs one of the pharmacy's scripts by name. */
export async function job(paths, config, name) {
  // Backup goes through `backup()` rather than being run directly, so the
  // scheduled run and the button on the panel are one code path -- including
  // starting the database first if it is somehow down.
  if (name === "backup") return backup(paths, config);

  const output = await npm(["run", name], { cwd: paths.app, env: jobEnv(paths, config) });
  return { ok: true, output: output ?? "" };
}

/* ------------------------------------------------------------------ backup */

/**
 * A backup, now.
 *
 * Starts the database if it is not up, because the most likely moment somebody
 * runs this by hand is when something is wrong.
 */
export async function backup(paths, config, { inherit = false } = {}) {
  const started = !(await isAccepting(paths, config.pgPort));
  if (started) {
    await startServer(paths, config.pgPort);
    await waitUntilReady(paths, config.pgPort);
  }

  const output = await npm(["run", "backup", "--", "--out", paths.backups], {
    cwd: paths.app,
    env: jobEnv(paths, config),
    inherit,
  });

  // The script prints the path it wrote. Reporting the file by name is the
  // difference between "a backup happened somewhere" and one the owner can
  // carry off the machine, which is the only kind that counts.
  const file = /Dumping to\s+(.+\.dump)/u.exec(output ?? "")?.[1]?.trim() ?? null;
  return { ok: true, startedDatabase: started, file, output: output ?? "" };
}

/**
 * When each daily job last ran, from the state `jobs.mjs` keeps.
 *
 * The owner's real question about backups is never "is there a backup feature",
 * it is "is it actually happening" — and until this, nothing answered that.
 * A job that failed reports its failure rather than its time: a date shown for
 * a backup that did not happen is worse than no date at all.
 */
export async function jobHistory(paths) {
  try {
    return JSON.parse(await readFile(join(paths.root, "jobs.json"), "utf8"));
  } catch {
    return {};
  }
}

/* -------------------------------------------------------------------- logs */

export async function logs(paths, lines = 60) {
  const file = join(paths.logs, "pharmacy.log");
  if (!(await exists(file))) return { file, lines: [], missing: true };

  const text = await readFile(file, "utf8");
  return {
    file,
    missing: false,
    lines: text.split(/\r?\n/u).filter(Boolean).slice(-lines),
  };
}

/* ----------------------------------------------------------------- folders */

/**
 * The places the owner is otherwise told to find by reading a document.
 *
 * `data` is the one that matters and the one nobody can name: the pharmacy's
 * records live there and nowhere else, and a backup that has not been copied
 * off this machine is not a backup.
 */
export function folders(paths) {
  return [
    { key: "data", path: paths.data },
    { key: "backups", path: paths.backups },
    { key: "logs", path: paths.logs },
    { key: "root", path: paths.root },
  ];
}

const REVEAL = {
  win32: "explorer.exe",
  darwin: "open",
  linux: "xdg-open",
};

/** Opens one of those folders in the platform's file manager. */
export async function reveal(paths, key) {
  const folder = folders(paths).find((entry) => entry.key === key);
  if (!folder) return { ok: false, reason: `unknown folder: ${key}` };

  const command = REVEAL[process.platform];
  if (!command) return { ok: false, reason: `no file manager for ${process.platform}` };

  // Checked here rather than inferred from the exit code, because on Windows
  // the exit code cannot carry it -- see below. A folder that is not there is
  // the only way this realistically fails, and it is worth saying out loud:
  // `logs` does not exist until the pharmacy has run once.
  if (!(await exists(folder.path))) {
    return { ok: false, reason: `not there (yet): ${folder.path}` };
  }

  try {
    await run(command, [folder.path]);
  } catch (error) {
    // `explorer.exe` exits 1 on success -- verified, not assumed. It is
    // documented nowhere and has been that way for decades, so treating its
    // exit code as meaningful would report every window that plainly opened as
    // a failure. The existence check above is what makes ignoring it safe.
    if (!isWindows) return { ok: false, reason: error.message };
  }
  return { ok: true, path: folder.path };
}
