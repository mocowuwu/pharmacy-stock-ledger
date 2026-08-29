import { randomBytes } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  exists,
  freeSpaceGb,
  has,
  lanAddress,
  layout,
  run,
  targetTriple,
  ui,
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
import { installService } from "./service.mjs";

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
async function stopRunningInstance(paths) {
  if (process.platform === "darwin") {
    await run("launchctl", [
      "bootout",
      `gui/${process.getuid?.() ?? 501}`,
      `${homedir()}/Library/LaunchAgents/id.apotek.pharmacy.plist`,
    ]).catch(() => {});
  } else if (process.platform === "linux") {
    await run("systemctl", ["--user", "stop", "pharmacy.service"]).catch(() => {});
  }
  await stopServer(paths).catch(() => {});
  ui.detail("stopped the running pharmacy");
}

export async function install() {
  const root = resolve(argument("dir", defaultRoot()));
  const paths = layout(root);
  const pgPort = Number(argument("db-port", DEFAULT_PORT));
  const appPort = Number(argument("port", APP_PORT));
  const source = resolve(argument("source", process.cwd()));

  ui.title("Pharmacy Stock Ledger — install");
  ui.info(`Installing into ${root}`);
  ui.detail("Nothing outside this folder is modified.");

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
    await stopRunningInstance(paths);
  } else {
    // A first install refuses a port somebody else holds, rather than
    // discovering it later as a confusing failure against a foreign database.
    if (await portInUse(pgPort)) {
      ui.fail(
        `something is already listening on 127.0.0.1:${pgPort}.`,
        "That is probably another PostgreSQL. Pick a free port:\n" +
          `  sh install-macos.command --db-port ${pgPort + 1}`,
      );
    }
    if (await portInUse(appPort)) {
      ui.fail(
        `something is already listening on port ${appPort}.`,
        `Pick a different one:\n  sh install-macos.command --port ${appPort + 1}`,
      );
    }
    ui.ok(`ports ${pgPort} and ${appPort} are free`);
  }

  await mkdir(paths.backups, { recursive: true });
  await mkdir(paths.logs, { recursive: true });

  /* -------------------------------------------------------- 2. postgresql */

  ui.step("Fetching PostgreSQL");
  await fetchPostgres(paths);

  /* -------------------------------------------------- 3. cluster and role */

  ui.step("Setting up the database");

  // Generated, never typed, never shown. It only ever travels from this file to
  // the app's own config, both of which sit in the install directory.
  const config = alreadyInstalled
    ? JSON.parse(await readFile(paths.config, "utf8"))
    : { dbPassword: randomBytes(24).toString("base64url"), pgPort, appPort };

  await initCluster(paths, config.dbPassword);
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

  if (resolve(paths.app) !== source) {
    await cp(source, paths.app, {
      recursive: true,
      filter: (path) =>
        !/(^|[\\/])(node_modules|\.next|\.git|\.data|backups|downloads)([\\/]|$)/u.test(path),
    });
    ui.ok("files copied");
  }

  ui.info("installing dependencies — this takes a few minutes");
  await run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: paths.app });
  ui.ok("dependencies installed");

  /* ---------------------------------------------------------- 5. config */

  ui.step("Writing the configuration");

  const env = [
    "# Written by the installer. Edit it and restart with: pharmacy restart",
    `DATABASE_URL=${connectionUrl(config.pgPort, config.dbPassword)}`,
    "",
    "# The pharmacy is served over plain HTTP on the clinic network, so the",
    "# session cookie cannot be marked HTTPS-only -- with it on, sign-in fails",
    "# silently and nothing explains why. Put a certificate in front and set",
    "# this back to true when you have a quiet afternoon; see DEPLOY.md.",
    "COOKIE_SECURE=false",
    "",
    "SESSION_TTL_HOURS=12",
    "PHARMACY_TIMEZONE=Asia/Jakarta",
    `PORT=${config.appPort}`,
    "",
  ].join("\n");

  await writeFile(join(paths.app, ".env.local"), env, "utf8");
  await writeFile(paths.config, JSON.stringify(config, null, 2), { mode: 0o600 });
  ui.ok("configuration written");
  ui.detail("timezone is Asia/Jakarta; change it in Settings once you sign in");

  /* ----------------------------------------------------------- 6. build */

  ui.step("Building");
  ui.info("this is the slow step — a few minutes on a small machine");
  await run("npm", ["run", "build"], { cwd: paths.app });
  ui.ok("built");

  /* ------------------------------------------------------- 7. migrations */

  ui.step("Preparing the database");
  await run("npm", ["run", "db:migrate"], { cwd: paths.app });
  ui.ok("schema up to date");

  /* ----------------------------------------------------- 8. owner account */

  let ownerPassword = null;
  if (!alreadyInstalled) {
    ui.step("Creating the owner account");
    const output = await run("npm", ["run", "db:seed"], { cwd: paths.app });
    ownerPassword = /Temporary password\s*:\s*(\S+)/u.exec(output)?.[1] ?? null;
    ui.ok("owner account created");
  }

  /* -------------------------------------------------- 9. control command */

  ui.step("Adding the pharmacy command");

  // A tiny wrapper so the owner types `pharmacy status`, not a node invocation
  // with two paths in it. It pins the install root, so it works from anywhere.
  const controlPath = join(root, "pharmacy");
  await writeFile(
    controlPath,
    [
      "#!/bin/sh",
      "# Control the pharmacy. Written by the installer.",
      `PHARMACY_ROOT=${JSON.stringify(root)} exec ${JSON.stringify(process.execPath)} \\`,
      `  ${JSON.stringify(join(paths.app, "installer", "control.mjs"))} "$@"`,
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  ui.ok(`${controlPath} created`);

  /* -------------------------------------------------------- 10. service */

  ui.step("Making it start by itself");
  const service = await installService(paths);
  if (service.installed) {
    ui.ok(`${service.kind} service registered — it will start after a power cut`);
  } else {
    ui.warn(service.reason);
    ui.detail(`Start it by hand with: ${join(root, "pharmacy")} start`);
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

  ui.info(`Open this from the till:  ${address}`);
  ui.blank();
  ui.info("Useful afterwards:");
  ui.detail(`${join(root, "pharmacy")} status     is it running?`);
  ui.detail(`${join(root, "pharmacy")} backup     take a backup now`);
  ui.detail(`${join(root, "pharmacy")} logs       what it has been doing`);
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
  await stopServer(layout(root)).catch(() => {});
  ui.fail(error.message ?? String(error));
});
