import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { download, exists, extractTarGz, fetchChecksum, run, targetTriple, ui } from "./lib.mjs";

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
  await mkdir(paths.postgres, { recursive: true });
  await run("sh", ["-c", `mv ${JSON.stringify(join(staging, top))}/* ${JSON.stringify(paths.postgres)}/`]);
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

  try {
    await run(binary(paths, "initdb"), [
      "--pgdata", paths.data,
      "--username", DB_USER,
      "--pwfile", passwordFile,
      "--encoding", "UTF8",
      // Sorting that puts Indonesian item names in the order a person expects.
      "--locale-provider", "icu",
      "--icu-locale", "id-ID",
      "--auth-local", "trust",
      "--auth-host", "scram-sha-256",
    ]).catch(async (error) => {
      // Not every build ships ICU. Falling back keeps the install working; the
      // only loss is collation nicety, so it is a note rather than a failure.
      if (!/icu|locale/iu.test(error.message)) throw error;
      ui.warn("ICU collation unavailable; using the default");
      await rm(paths.data, { recursive: true, force: true });
      await mkdir(paths.data, { recursive: true });
      await run(binary(paths, "initdb"), [
        "--pgdata", paths.data,
        "--username", DB_USER,
        "--pwfile", passwordFile,
        "--encoding", "UTF8",
        "--auth-local", "trust",
        "--auth-host", "scram-sha-256",
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
  if (await isRunning(paths)) return false;

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
export async function isRunning(paths) {
  try {
    await run(binary(paths, "pg_ctl"), ["--pgdata", paths.data, "status"]);
    return true;
  } catch {
    return false;
  }
}

/** Whether our server is not just up but answering queries. */
export async function isAccepting(paths, port) {
  if (!(await isRunning(paths))) return false;
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
