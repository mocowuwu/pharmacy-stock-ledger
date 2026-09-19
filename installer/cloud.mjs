import { spawn } from "node:child_process";
import { chmod, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { download, exists, isWindows, moveContents, run, updateEnv } from "./lib.mjs";

/**
 * Backups that leave the building by themselves.
 *
 * `scripts/backup.ts` has pushed each dump off the machine with `rclone copy`
 * since BACKUP_RCLONE_REMOTE existed. What it never had was a way for the
 * owner to switch it on: install rclone by hand, run `rclone config` in a
 * terminal, answer eleven questions, then edit `.env.local`. Nobody running a
 * pharmacy was ever going to do that, so in practice every backup stayed on
 * the one disk that a dead machine takes with it.
 *
 * This does all of it from one button:
 *
 *   1. rclone is downloaded into the install folder -- pinned and
 *      checksum-verified, exactly like PostgreSQL, and nothing outside the
 *      folder is touched;
 *   2. a Google Drive remote is created with rclone's own browser sign-in, the
 *      owner approves it once in their own Google account;
 *   3. BACKUP_RCLONE_REMOTE is written into `.env.local`.
 *
 * From then on the daily backup the supervisor already runs is also the daily
 * upload -- there is no second schedule to go wrong.
 *
 * **The rclone config lives in the install folder, not the user's profile.**
 * On Windows the daily job runs as SYSTEM, whose profile is not the owner's;
 * a remote created in the owner's `%APPDATA%` would work from the panel's
 * button and silently never from the job that actually matters. RCLONE_CONFIG
 * points both at the same file.
 *
 * The scope is `drive.file`: rclone can see only the files it created itself,
 * not the rest of the owner's Drive. Google's token is rclone's to keep and
 * refresh; nothing Google-shaped enters the database or the audit log.
 */

/** Pinned. An installer that silently follows "latest" is not reproducible. */
export const RCLONE_VERSION = "1.75.1";

/**
 * From https://downloads.rclone.org/v1.75.1/SHA256SUMS, copied rather than
 * fetched beside the download -- a checksum that travels with the file it
 * checks only proves the two came from the same place.
 */
const CHECKSUMS = {
  "linux-amd64": "982b5aa772841168f8e380f139e9e787b2a105403e32b94da8676a0e1c0a13ab",
  "linux-arm64": "03f2504174034b6d004152ed7369251c9a9ec1f7e0836eda420f5c7a5ec0dff9",
  "osx-amd64": "29253d0288b8fbbac46baad6e5f6add6cb01d462c79f10805bbd4631c4cdf82c",
  "osx-arm64": "c61d7a371c62bcbbe882c3423aa4b8bf63485c248dd0f692997b8f0c3f6d0c6f",
  "windows-amd64": "200eb602c126d82aa38b51e0f6b9ae837473ff99b51278d3f6f837574c494d6e",
  "windows-arm64": "c3c6cd0424dd49076ad179c30c3f9e5cde2c004ec07ea9fe6911f23e32eafe0f",
};

/** The remote this creates. A name nobody else's rclone setup will have used. */
export const REMOTE_NAME = "apotek-gdrive";

/** The folder in the owner's Drive. Named in Indonesian: they will go looking for it. */
export const REMOTE_FOLDER = "Apotek-Cadangan";

/** How long the owner has to finish Google's sign-in before it is abandoned. */
const SIGN_IN_MS = 10 * 60 * 1000;

function platformKey() {
  const os = { win32: "windows", darwin: "osx", linux: "linux" }[process.platform];
  const arch = { x64: "amd64", arm64: "arm64" }[process.arch];
  return os && arch ? `${os}-${arch}` : null;
}

export function rcloneLayout(paths) {
  const directory = join(paths.root, "rclone");
  return {
    directory,
    binary: join(directory, isWindows ? "rclone.exe" : "rclone"),
    config: join(paths.root, "rclone.conf"),
  };
}

/**
 * What the backup script needs to find our config.
 *
 * Only when the backup is actually going to our remote. An install set up by
 * hand the old way, from the README, keeps its remote in rclone's default
 * config; pointing RCLONE_CONFIG at ours -- which a cancelled sign-in leaves
 * behind empty -- would disconnect it without a word.
 */
export async function rcloneEnv(paths) {
  const destination = await configuredRemote(paths);
  return destination?.startsWith(`${REMOTE_NAME}:`)
    ? { RCLONE_CONFIG: rcloneLayout(paths).config }
    : {};
}

/* -------------------------------------------------------------- obtaining */

/**
 * Downloads rclone into the install folder unless it is already there.
 *
 * Returns rather than throws for the ordinary failures -- no internet, an
 * unsupported machine -- because the installer treats this as optional: a
 * pharmacy that cannot fetch its cloud tool today must still install, and the
 * panel can fetch it later from the same function.
 */
export async function ensureRclone(paths, { onBytes } = {}) {
  const layout = rcloneLayout(paths);
  if (await exists(layout.binary)) return { ok: true, binary: layout.binary, fresh: false };

  const key = platformKey();
  if (!key || !CHECKSUMS[key]) {
    return {
      ok: false,
      code: "rclone-unsupported",
      reason: `no rclone build for ${process.platform}/${process.arch}`,
    };
  }

  const name = `rclone-v${RCLONE_VERSION}-${key}`;
  const url = `https://downloads.rclone.org/v${RCLONE_VERSION}/${name}.zip`;
  const archive = join(paths.root, "downloads", `${name}.zip`);
  const staging = join(paths.root, "downloads", "rclone");

  try {
    await download(url, archive, { sha256: CHECKSUMS[key], onBytes });

    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    await unzip(archive, staging);

    // One top-level directory named after the version, as with PostgreSQL.
    const [top] = await readdir(staging);
    await rm(layout.directory, { recursive: true, force: true });
    await moveContents(join(staging, top), layout.directory);
    if (!isWindows) await chmod(layout.binary, 0o755);

    await rm(staging, { recursive: true, force: true });
    await rm(archive, { force: true });
  } catch (error) {
    return {
      ok: false,
      code: "rclone-download-failed",
      reason: error.message ?? String(error),
    };
  }

  if (!(await exists(layout.binary))) {
    return { ok: false, code: "rclone-download-failed", reason: "the archive held no rclone" };
  }
  return { ok: true, binary: layout.binary, fresh: true };
}

/**
 * The rclone release is a zip. Windows 10 and later and macOS ship a bsdtar
 * that reads zip as happily as tar; GNU tar on Linux does not, and there
 * `unzip` is the tool that is almost always present instead.
 *
 * On Windows it is Windows' own tar.exe by full path, not whichever `tar` is
 * first on PATH -- Git for Windows puts a GNU tar there on some machines, and
 * that one cannot open a zip. PowerShell's Expand-Archive is the fallback for
 * a Windows old enough to have no tar at all.
 */
async function unzip(archive, into) {
  if (isWindows) {
    const systemTar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    if (await exists(systemTar)) {
      await run(systemTar, ["-xf", archive, "-C", into]);
      return;
    }
    await run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Expand-Archive -LiteralPath $env:PHARMACY_ZIP -DestinationPath $env:PHARMACY_ZIP_TO -Force",
    ], { env: { PHARMACY_ZIP: archive, PHARMACY_ZIP_TO: into } });
    return;
  }
  if (process.platform === "linux") {
    try {
      await run("unzip", ["-q", "-o", archive, "-d", into]);
      return;
    } catch (error) {
      if (!/could not run unzip/u.test(error.message)) throw error;
      throw new Error("unzip is not installed; install it (sudo apt install unzip) and try again");
    }
  }
  await run("tar", ["-xf", archive, "-C", into]);
}

/* ------------------------------------------------------------------ state */

/** The value of BACKUP_RCLONE_REMOTE in `.env.local`, or null. */
async function configuredRemote(paths) {
  try {
    const text = await readFile(join(paths.app, ".env.local"), "utf8");
    const value = /^\s*BACKUP_RCLONE_REMOTE\s*=\s*(.*)$/mu.exec(text)?.[1]?.trim();
    return value ? value.replace(/^["']|["']$/gu, "") : null;
  } catch {
    return null;
  }
}

/** Whether our config holds a signed-in Google remote -- a token, not just a name. */
async function hasToken(paths) {
  try {
    const text = await readFile(rcloneLayout(paths).config, "utf8");
    const section = text.split(/^\[/mu).find((part) => part.startsWith(`${REMOTE_NAME}]`));
    return Boolean(section && /^\s*token\s*=\s*\S/mu.test(section));
  } catch {
    return false;
  }
}

/**
 * The in-flight sign-in, if any. In memory, like the update: it describes
 * this process's attempt, and it is over when the process is.
 */
let connecting = { active: false, phase: null, authUrl: null, error: null, code: null };

/** The rclone waiting on Google, so a cancel has something to stop. */
let signInChild = null;

/** Set by a cancel that lands before rclone has even been started. */
let cancelRequested = false;

/**
 * Everything the panel shows about cloud backup.
 *
 * `destination` is whatever the backup will upload to -- ours, or a remote
 * somebody configured by hand from the README, which this reports honestly
 * rather than pretending it is not there.
 */
export async function cloudStatus(paths) {
  const destination = await configuredRemote(paths);
  const ours = destination?.startsWith(`${REMOTE_NAME}:`) ?? false;
  return {
    installed: await exists(rcloneLayout(paths).binary),
    version: RCLONE_VERSION,
    destination,
    ours,
    // A remote set up by hand is taken on trust -- its config is not ours to
    // read. The daily job's success or failure is what says whether it works.
    connected: destination ? (ours ? await hasToken(paths) : true) : false,
    folder: REMOTE_FOLDER,
    connecting: { ...connecting },
  };
}

export function isConnecting() {
  return connecting.active;
}

/* ---------------------------------------------------------------- connect */

/**
 * Starts the Google Drive sign-in and returns at once; the panel polls
 * `cloudStatus` for how it is going. The same shape as `startUpdate`, for the
 * same reason: the owner is off in a browser tab signing in to Google for as
 * long as it takes them, and no request should be held open for that.
 */
export function startConnect(paths) {
  if (connecting.active) return { ok: true, alreadyRunning: true };
  connecting = { active: true, phase: "download", authUrl: null, error: null, code: null };
  cancelRequested = false;

  connect(paths).then(
    () => {
      connecting = { ...connecting, active: false, phase: "done" };
    },
    (error) => {
      connecting = {
        ...connecting,
        active: false,
        authUrl: null,
        phase: error.code === "cloud-cancelled" ? "cancelled" : "failed",
        code: error.code ?? "cloud-failed",
        error: error.message ?? String(error),
      };
    },
  );
  return { ok: true, started: true };
}

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function connect(paths) {
  const fetched = await ensureRclone(paths);
  if (!fetched.ok) throw failure(fetched.code, fetched.reason);

  const layout = rcloneLayout(paths);
  const config = ["--config", layout.config];

  // A sign-in abandoned halfway leaves the remote's section in the file with
  // no token -- rclone writes it before it asks. Starting clean is what makes
  // "try again" actually try again.
  await run(layout.binary, ["config", "delete", REMOTE_NAME, ...config]).catch(() => {});

  if (cancelRequested) throw failure("cloud-cancelled", "cancelled");
  connecting = { ...connecting, phase: "sign-in" };
  await signIn(layout.binary, config);

  if (!(await hasToken(paths))) {
    throw failure("cloud-no-token", "Google sign-in finished without granting access");
  }

  // Proves the token works and makes the folder the owner will go looking
  // for, before anything is declared connected.
  connecting = { ...connecting, phase: "verify", authUrl: null };
  const destination = `${REMOTE_NAME}:${REMOTE_FOLDER}`;
  try {
    await run(layout.binary, ["mkdir", destination, ...config], { timeoutMs: 60_000 });
  } catch (error) {
    throw failure("cloud-verify-failed", error.message ?? String(error));
  }

  await updateEnv(join(paths.app, ".env.local"), { BACKUP_RCLONE_REMOTE: destination });
}

/**
 * rclone's own OAuth flow: it listens on 127.0.0.1:53682, opens the browser
 * at Google's consent screen, and exits once Google redirects back. The link
 * it prints is kept so the panel can offer it as a button too -- the browser
 * it opens may be behind this one, or not open at all.
 */
function signIn(binary, config) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      binary,
      ["config", "create", REMOTE_NAME, "drive", "scope=drive.file", ...config],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
    signInChild = child;

    let output = "";
    const listen = (chunk) => {
      output += chunk;
      const url = /(http:\/\/127\.0\.0\.1:\d+\/auth\?state=[\w-]+)/u.exec(output)?.[1];
      if (url && !connecting.authUrl) connecting = { ...connecting, authUrl: url };
    };
    child.stdout.on("data", listen);
    child.stderr.on("data", listen);

    const timer = setTimeout(() => {
      child.kill();
      reject(failure("cloud-timeout", "Google sign-in was not completed in time"));
    }, SIGN_IN_MS);

    child.on("error", (error) => {
      clearTimeout(timer);
      signInChild = null;
      reject(failure("cloud-failed", error.message));
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      signInChild = null;
      if (child.cancelled) return reject(failure("cloud-cancelled", "cancelled"));
      if (code === 0) return resolve();
      const tail = output.trim().split("\n").slice(-5).join("\n");
      reject(failure("cloud-failed", `rclone exited with ${code}\n${tail}`));
    });
  });
}

/**
 * Abandons a sign-in in progress. Without it, an owner who closed Google's tab
 * would watch "waiting for you to sign in" for ten minutes with the button
 * disabled, and rclone would hold its port for all of them.
 */
export async function cancelConnect(paths) {
  cancelRequested = true;
  if (signInChild) {
    signInChild.cancelled = true;
    signInChild.kill();
  }
  // Whatever half-written section rclone left behind goes with it.
  const layout = rcloneLayout(paths);
  if (await exists(layout.binary)) {
    await run(layout.binary, ["config", "delete", REMOTE_NAME, "--config", layout.config]).catch(
      () => {},
    );
  }
  return { ok: true };
}

/* ------------------------------------------------------------- disconnect */

/**
 * Stops uploading. The files already in Drive stay there -- they are the
 * owner's backups, and nothing in this project deletes a backup.
 */
export async function disconnect(paths) {
  const layout = rcloneLayout(paths);
  if (await exists(layout.binary)) {
    await run(layout.binary, ["config", "delete", REMOTE_NAME, "--config", layout.config]).catch(
      () => {},
    );
  }
  await updateEnv(join(paths.app, ".env.local"), { BACKUP_RCLONE_REMOTE: "" });
  return { ok: true };
}
