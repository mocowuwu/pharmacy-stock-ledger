import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  download,
  exists,
  extractTarGz,
  fetchChecksum,
  isWindows,
  moveContents,
  run,
  targetTriple,
  ui,
} from "./lib.mjs";

/**
 * A PostgreSQL that belongs to the pharmacy and to nothing else.
 *
 * Downloaded into the install directory, initialised with its own data
 * directory, listening on its own port, started and stopped with the app. No
 * system service, no administrator password, no argument with whatever else
 * the machine has installed, and uninstalling is deleting a folder.
 *
 * This is a real PostgreSQL, not an embedded substitute. That matters here more
 * than it usually would: the development database serves a single connection,
 * and the sale-numbering bug found in this project was invisible until two
 * transactions genuinely overlapped.
 */

/** Pinned. An installer that silently follows "latest" is not reproducible. */
export const POSTGRES_VERSION = "18.6.0";

const RELEASE = (asset) =>
  `https://github.com/theseus-rs/postgresql-binaries/releases/download/${POSTGRES_VERSION}/${asset}`;

/** Away from 5432 so the pharmacy never argues with a PostgreSQL already there. */
export const DEFAULT_PORT = 55432;

export const DB_NAME = "pharmacy";
export const DB_USER = "pharmacy";

function binary(paths, name) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  return join(paths.postgres, "bin", `${name}${suffix}`);
}

/* -------------------------------------------------------------- obtaining */

export async function fetchPostgres(paths) {
  if (await exists(binary(paths, "postgres"))) {
    ui.ok(`PostgreSQL ${POSTGRES_VERSION} already downloaded`);
    return;
  }

  const triple = targetTriple();
  if (!triple) {
    ui.fail(
      `no PostgreSQL build for ${process.platform}/${process.arch}.`,
      "Supported: macOS and Linux on Intel or ARM, and Windows on Intel.\n" +
        "Install PostgreSQL 18 yourself and follow the manual path in DEPLOY.md.",
    );
  }

  const asset = `postgresql-${POSTGRES_VERSION}-${triple}.tar.gz`;
  const archive = join(paths.root, "downloads", asset);

  ui.info(`PostgreSQL ${POSTGRES_VERSION} for ${triple}`);
  const expected = await fetchChecksum(`${RELEASE(asset)}.sha256`);
  if (!expected) ui.warn("no published checksum; the download cannot be verified");

  await download(RELEASE(asset), archive, { sha256: expected ?? undefined });
  if (expected) ui.detail("checksum verified");

  const staging = join(paths.root, "downloads", "pg");
  await rm(staging, { recursive: true, force: true });
  await extractTarGz(archive, staging);

  // The archive holds a single top-level directory whose name carries the
  // version; move its contents up so the rest of the installer has one path.
  const [top] = await readdir(staging);
  await rm(paths.postgres, { recursive: true, force: true });
  await moveContents(join(staging, top), paths.postgres);
  await rm(staging, { recursive: true, force: true });
  await rm(archive, { force: true });

  ui.ok(`PostgreSQL ${POSTGRES_VERSION} unpacked`);
}

/* ----------------------------------------------------------------- server */

/**
 * Creates the cluster, once.
 *
 * **Never touches an existing data directory.** A reinstall over live pharmacy
 * records would be the worst thing this program could do, so the presence of
 * the directory ends the matter.
 */
export async function initCluster(paths, password) {
  if (await exists(join(paths.data, "PG_VERSION"))) {
    ui.ok("database already initialised, leaving it alone");
    return false;
  }

  await mkdir(paths.data, { recursive: true });
  const passwordFile = join(paths.root, "downloads", "initpw");
  await writeFile(passwordFile, password, { mode: 0o600 });

  // Windows has no unix-domain sockets, so there is no "local" connection type
  // to authenticate and initdb rejects the option outright. Host connections
  // are scram-sha-256 on every platform, which is the one the app uses.
  const authArgs = isWindows
    ? ["--auth-host", "scram-sha-256"]
    : ["--auth-local", "trust", "--auth-host", "scram-sha-256"];

  try {
    await run(binary(paths, "initdb"), [
      "--pgdata", paths.data,
      "--username", DB_USER,
      "--pwfile", passwordFile,
      "--encoding", "UTF8",
      // Sorting that puts Indonesian item names in the order a person expects.
      "--locale-provider", "icu",
      "--icu-locale", "id-ID",
      ...authArgs,
    ]).catch(async (error) => {
      // Not every build ships ICU. Falling back keeps the install working; the
      // only loss is collation nicety, so it is a note rather than a failure.
      //
      // Match on what initdb *printed*, never on error.message: that message
      // embeds the command line, and this command line contains both
      // `--locale-provider` and `--icu-locale`. Testing it made this branch
      // unconditionally true, so a Windows initdb that died on a missing DLL
      // was reported as an ICU problem, retried, and died the same way -- with
      // the real cause named nowhere.
      if (!/icu|locale/iu.test(error.output ?? "")) throw error;
      ui.warn("ICU collation unavailable; using the default");
      await rm(paths.data, { recursive: true, force: true });
      await mkdir(paths.data, { recursive: true });
      await run(binary(paths, "initdb"), [
        "--pgdata", paths.data,
        "--username", DB_USER,
        "--pwfile", passwordFile,
        "--encoding", "UTF8",
        ...authArgs,
      ]);
    });
  } finally {
    await rm(passwordFile, { force: true });
  }

  ui.ok("database cluster created");
  return true;
}

/**
 * Starts the server bound to loopback only.
 *
 * The app talks to it from the same machine; nothing else has any business
 * reaching it. Binding to loopback means the port cannot be reached across the
 * clinic network even if the firewall is open.
 */
export async function startServer(paths, port) {
  // With the port, so a server this account cannot inspect still counts as
  // running. Without it, an upgrade or `backup` on Windows would try to start
  // a second postmaster on top of the live one.
  if (await isRunning(paths, port)) return false;

  await mkdir(paths.logs, { recursive: true });
  await run(binary(paths, "pg_ctl"), [
    "--pgdata", paths.data,
    "--log", join(paths.logs, "postgres.log"),
    "--options", `-p ${port} -c listen_addresses=127.0.0.1`,
    "--wait",
    "start",
  ]);
  return true;
}

export async function stopServer(paths) {
  if (!(await exists(join(paths.data, "postmaster.pid")))) return false;
  await run(binary(paths, "pg_ctl"), ["--pgdata", paths.data, "--mode", "fast", "--wait", "stop"]);
  return true;
}

/**
 * Whether *our* server is running.
 *
 * Asked of the data directory, not of the port. `pg_isready` on a port answers
 * "something is listening", which is a different question and a dangerous one:
 * a stale postmaster from a failed install, or an unrelated PostgreSQL, both
 * answer yes. Trusting that once meant connecting to a server whose data
 * directory had since been deleted.
 */
export async function isRunning(paths, port) {
  try {
    await run(binary(paths, "pg_ctl"), ["--pgdata", paths.data, "status"]);
    return true;
  } catch {
    // Not necessarily "no server". See below.
  }
  return startedByAnotherAccount(paths, port);
}

/**
 * Whether the server in our data directory is running under an account this
 * one cannot inspect.
 *
 * On Windows the boot task runs the pharmacy as SYSTEM. `pg_ctl status` then
 * cannot open that process to check on it and reports "no server running" --
 * to the operator, about their own database, while it is serving. `status`
 * said the database was down while `pg_isready` said it was up, and `backup`
 * believed `status` and tried to start a second postmaster over a live one.
 *
 * The postmaster's own PID file settles it without weakening the rule above:
 * it records the data directory and port of the server that wrote it, so a
 * stale file, an unrelated PostgreSQL, or a server for some other data
 * directory are all still correctly rejected.
 */
async function startedByAnotherAccount(paths, port) {
  const sameFile = (a, b) =>
    a.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase() ===
    b.replaceAll("\\", "/").replace(/\/+$/u, "").toLowerCase();

  let lines;
  try {
    lines = (await readFile(join(paths.data, "postmaster.pid"), "utf8")).split("\n");
  } catch {
    return false;
  }

  // Line 2 is the data directory, line 4 the port. Anything else is not a
  // PID file we understand, and guessing is exactly what this must not do.
  const [, dataDirectory, , pidPort] = lines.map((line) => line.trim());
  if (!dataDirectory || !sameFile(dataDirectory, paths.data)) return false;
  if (port !== undefined && pidPort !== String(port)) return false;

  try {
    await run(binary(paths, "pg_isready"), [
      "-h", "127.0.0.1",
      "-p", String(port ?? pidPort),
      "-q",
    ]);
    return true;
  } catch {
    return false;
  }
}

/** Whether our server is not just up but answering queries. */
export async function isAccepting(paths, port) {
  if (!(await isRunning(paths, port))) return false;
  try {
    await run(binary(paths, "pg_isready"), ["-h", "127.0.0.1", "-p", String(port), "-q"]);
    return true;
  } catch {
    return false;
  }
}

/** Waits for the server to answer, rather than assuming it did. */
export async function waitUntilReady(paths, port, seconds = 30) {
  for (let i = 0; i < seconds * 2; i++) {
    if (await isAccepting(paths, port)) return true;
    await sleep(500);
  }
  return false;
}

/**
 * Whether anything at all holds the port.
 *
 * Used before the cluster exists, to refuse rather than to collide. A second
 * PostgreSQL on the same port would be found later and much more confusingly.
 */
export async function portInUse(port) {
  const { createConnection } = await import("node:net");
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port, timeout: 1_000 });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

export async function createDatabase(paths, port, password) {
  // Over TCP the cluster asks for a password, since host connections are
  // scram-sha-256 -- the same authentication the app will use. Supplying it
  // through the environment keeps it out of the process list.
  const env = { PGPASSWORD: password };

  const list = await run(binary(paths, "psql"), [
    "-h", "127.0.0.1", "-p", String(port), "-U", DB_USER, "-d", "postgres",
    "-tAc", `select 1 from pg_database where datname = '${DB_NAME}'`,
  ], { env });

  if (list.trim() === "1") {
    ui.ok(`database "${DB_NAME}" already exists`);
    return false;
  }

  await run(binary(paths, "createdb"), [
    "-h", "127.0.0.1", "-p", String(port), "-U", DB_USER, "-O", DB_USER, DB_NAME,
  ], { env });
  ui.ok(`database "${DB_NAME}" created`);
  return true;
}

export function connectionUrl(port, password) {
  return `postgres://${DB_USER}:${encodeURIComponent(password)}@127.0.0.1:${port}/${DB_NAME}`;
}

/** Where the bundled `pg_dump` and `pg_restore` live, for the backup scripts. */
export function binDirectory(paths) {
  return join(paths.postgres, "bin");
}
