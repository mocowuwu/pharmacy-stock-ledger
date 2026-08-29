import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { layout } from "./lib.mjs";
import { startServer, stopServer, waitUntilReady } from "./postgres.mjs";

/**
 * The thing the service actually runs.
 *
 * One process that owns both halves: it starts PostgreSQL, waits until the
 * database is genuinely answering, then starts the pharmacy — and on the way
 * down stops them in the opposite order.
 *
 * One supervisor rather than two service units, because the ordering is the
 * whole problem. Two units need a dependency the init system understands, and
 * "started" for a database means "accepting connections", which a process
 * manager cannot see. Here it is a loop that asks.
 */

const root = resolve(process.argv[2] ?? process.env.PHARMACY_ROOT ?? process.cwd());
const paths = layout(root);

const log = (message) =>
  console.log(`${new Date().toISOString()}  ${message}`);

let app = null;
let shuttingDown = false;

async function main() {
  const config = JSON.parse(await readFile(paths.config, "utf8"));

  log(`starting database on port ${config.pgPort}`);
  await startServer(paths, config.pgPort);

  if (!(await waitUntilReady(paths, config.pgPort, 60))) {
    log("database did not become ready within 60s; giving up");
    process.exit(1);
  }
  log("database ready");

  // Next is started directly rather than through `npm run start`.
  //
  // A service runs with a minimal environment: launchd and systemd both hand
  // over a PATH that does not include npm, so shelling out to it fails with
  // ENOENT at boot and nowhere else. Calling the binary with the Node that is
  // already running removes the assumption entirely.
  const next = join(paths.app, "node_modules", "next", "dist", "bin", "next");

  app = spawn(process.execPath, [next, "start", "-p", String(config.appPort)], {
    cwd: paths.app,
    env: {
      ...process.env,
      PORT: String(config.appPort),
      NODE_ENV: "production",
      // So anything the app itself shells out to can find node and npm.
      PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    },
    stdio: ["ignore", "inherit", "inherit"],
  });

  log(`pharmacy starting on port ${config.appPort}`);

  app.on("exit", async (code) => {
    if (shuttingDown) return;
    // If the app dies the database should not be left running: the service
    // manager will restart this supervisor, and it starts from a clean pair.
    log(`pharmacy exited with ${code}; stopping the database`);
    await stopServer(paths).catch(() => {});
    process.exit(code ?? 1);
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received; shutting down`);

  if (app) {
    app.kill("SIGTERM");
    // Give the app a moment to finish whatever request it is serving. A sale
    // half-written is not possible -- it is one transaction -- but a receipt
    // rendering when the power switch goes is worth the two seconds.
    await new Promise((done) => setTimeout(done, 2_000));
  }

  await stopServer(paths).catch(() => {});
  log("stopped");
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => void shutdown(signal));
}

main().catch(async (error) => {
  log(`failed to start: ${error.message}`);
  await stopServer(paths).catch(() => {});
  process.exit(1);
});
