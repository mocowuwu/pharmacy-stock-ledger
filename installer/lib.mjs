import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, cp, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { networkInterfaces } from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { delimiter, dirname, join } from "node:path";

/**
 * Shared parts of the installer.
 *
 * Written for somebody standing at a clinic mini PC who did not ask to become a
 * system administrator. Two consequences run through all of it:
 *
 * 1. **Say what is happening and why.** Every step prints before it runs, so a
 *    failure names the thing that failed rather than ending a silent minute.
 * 2. **Refuse rather than half-do.** An installer that stops with a clear
 *    sentence is recoverable. One that leaves a broken half-install is a
 *    machine somebody has to wipe.
 */

/* ------------------------------------------------------------------ output */

const BOLD = "[1m";
const DIM = "[2m";
const RED = "[31m";
const GREEN = "[32m";
const YELLOW = "[33m";
const PURPLE = "[35m";
const OFF = "[0m";

// Windows terminals before 10 do not understand these, and a machine piping the
// output to a file does not want them either.
const colour = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const paint = (code, text) => (colour ? `${code}${text}${OFF}` : text);

let stepNumber = 0;

export const ui = {
  title(text) {
    console.log("");
    console.log(paint(BOLD + PURPLE, text));
    console.log(paint(DIM, "─".repeat(Math.min(text.length, 60))));
  },
  step(text) {
    stepNumber += 1;
    console.log("");
    console.log(paint(BOLD, `${stepNumber}. ${text}`));
  },
  info: (text) => console.log(`   ${text}`),
  detail: (text) => console.log(paint(DIM, `   ${text}`)),
  ok: (text) => console.log(`   ${paint(GREEN, "✓")} ${text}`),
  warn: (text) => console.log(`   ${paint(YELLOW, "!")} ${text}`),
  blank: () => console.log(""),

  /**
   * Ends the install with an explanation and, where possible, the way out.
   * Never a stack trace: a trace tells the reader nothing they can act on.
   */
  fail(text, remedy) {
    console.log("");
    console.log(`${paint(RED + BOLD, "Stopped.")} ${text}`);
    if (remedy) {
      console.log("");
      console.log(remedy);
    }
    console.log("");
    process.exit(1);
  },

  /** A box for the one thing that must not be missed: the owner's password. */
  box(lines) {
    const width = Math.max(...lines.map((l) => l.length)) + 4;
    console.log("");
    console.log(paint(PURPLE, "┌" + "─".repeat(width) + "┐"));
    for (const line of lines) {
      const pad = " ".repeat(width - line.length - 4);
      console.log(paint(PURPLE, "│") + `  ${line}${pad}  ` + paint(PURPLE, "│"));
    }
    console.log(paint(PURPLE, "└" + "─".repeat(width) + "┘"));
    console.log("");
  },
};

/* ----------------------------------------------------------------- running */

/**
 * Runs a command, streaming its output only when it fails.
 *
 * `npm ci` prints hundreds of lines nobody reads while it works, and the three
 * that matter when it breaks. Capturing and replaying on failure gives a quiet
 * install and a legible error.
 */
export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let output = "";
    if (!options.inherit) {
      child.stdout?.on("data", (d) => (output += d));
      child.stderr?.on("data", (d) => (output += d));
    }

    child.on("error", (error) =>
      reject(new Error(`could not run ${command}: ${error.message}`)),
    );
    child.on("exit", (code) => {
      if (code === 0) return resolve(output);
      const error = new Error(
        `${command} ${args.join(" ")} exited with ${code}` +
          (output ? `\n\n${output.trim().split("\n").slice(-25).join("\n")}` : ""),
      );
      // The message embeds the command line, so anything matching against it
      // is also matching the arguments -- which is how a failed initdb came to
      // be reported as an ICU problem, `--icu-locale` being right there in the
      // text. Callers that need to know what the program *said* read these.
      error.output = output;
      error.exitCode = code;
      reject(error);
    });
  });
}

/** Whether a command exists, used for preflight rather than for control flow. */
export async function has(command) {
  try {
    await run(process.platform === "win32" ? "where" : "which", [command]);
    return true;
  } catch {
    return false;
  }
}

export async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------- platform */

/**
 * The Rust target triple, which is how the PostgreSQL binaries are named.
 *
 * Only the combinations a clinic will plausibly use. Anything else stops with a
 * message naming what was detected, rather than downloading something that
 * cannot run.
 */
export function targetTriple() {
  const key = `${process.platform}-${process.arch}`;
  const triples = {
    "darwin-arm64": "aarch64-apple-darwin",
    "darwin-x64": "x86_64-apple-darwin",
    "linux-x64": "x86_64-unknown-linux-gnu",
    "linux-arm64": "aarch64-unknown-linux-gnu",
    "win32-x64": "x86_64-pc-windows-msvc",
  };
  return triples[key] ?? null;
}

/** Windows differs in enough small ways that naming it once is worth it. */
export const isWindows = process.platform === "win32";

/**
 * npm, run in a way Windows will actually start.
 *
 * On Windows npm is `npm.cmd`, a batch file, and `spawn` runs with
 * `shell: false` -- deliberately, so no argument is ever re-parsed. That
 * combination has failed two different ways:
 *
 *   - Spawning the bare name `npm` fails ENOENT, which reads as "npm is not
 *     installed" on a machine where npm is plainly installed.
 *   - Spawning `npm.cmd` fixed that, and now fails EINVAL. Since the fix for
 *     CVE-2024-27980 (Node 18.20.2 / 20.12.2 and up) `spawn` refuses to
 *     execute a `.bat` or `.cmd` at all without `shell: true`.
 *
 * `shell: true` would clear both and is the wrong trade: it hands the whole
 * command line back to cmd.exe to re-parse, and the install path is routinely
 * `C:\Users\Apotek Sehat\pharmacy`. So run npm the way npm.cmd itself does --
 * as a script, under the Node already running this installer. No shell, no
 * quoting, no PATH lookup, and the same npm on every platform.
 */
function npmCli() {
  const here = dirname(process.execPath);
  return [
    // The Windows zip and the macOS/Linux tarballs put it in different places.
    join(here, "node_modules", "npm", "bin", "npm-cli.js"),
    join(here, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
}

let npmScript;

export async function npm(args, options = {}) {
  if (npmScript === undefined) {
    npmScript = null;
    for (const candidate of npmCli()) {
      if (await exists(candidate)) {
        npmScript = candidate;
        break;
      }
    }
  }

  // A Node installed some other way may not have npm beside it. On macOS and
  // Linux the plain name still works, so fall back rather than refuse.
  if (!npmScript) {
    if (isWindows) {
      throw new Error(
        `npm was not found next to ${process.execPath}.\n` +
          "Install Node 22 from https://nodejs.org, which includes npm, and run this again.",
      );
    }
    return run("npm", args, options);
  }

  return run(process.execPath, [npmScript, ...args], options);
}

/**
 * A PATH with our own directories in front, joined the way this platform joins.
 *
 * `:` on Windows produces a PATH the shell reads as a drive letter and silently
 * ignores, so the bundled `pg_dump` is not found and the backup runs against
 * whatever PostgreSQL happens to be installed -- or none.
 */
export function pathWith(...directories) {
  return [...directories, process.env.PATH ?? ""].filter(Boolean).join(delimiter);
}

/** The command that starts the installer here, for use in error messages. */
export function launcher() {
  if (isWindows) return "install-windows.bat";
  return process.platform === "darwin" ? "sh install-macos.command" : "sh install-linux.sh";
}

/**
 * Moves the contents of a directory up into a destination.
 *
 * This was `sh -c "mv src/* dest/"`, which is three assumptions Windows does
 * not meet: a POSIX shell, an `mv`, and glob expansion. Done in JavaScript it
 * is the same operation everywhere, and it falls back to copy-then-delete for
 * the case that actually happens -- a temp directory and an install directory
 * on different volumes, where rename fails with EXDEV.
 */
export async function moveContents(from, into) {
  await mkdir(into, { recursive: true });
  for (const entry of await readdir(from)) {
    const source = join(from, entry);
    const destination = join(into, entry);
    try {
      await rename(source, destination);
    } catch (error) {
      if (error.code !== "EXDEV") throw error;
      await cp(source, destination, { recursive: true });
      await rm(source, { recursive: true, force: true });
    }
  }
}

/**
 * The address a till should be pointed at.
 *
 * "Open localhost:3000" is useless from another machine, which is where this
 * will actually be opened from. Prefers a private LAN address.
 */
export function lanAddress() {
  const candidates = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      const isPrivate =
        entry.address.startsWith("192.168.") ||
        entry.address.startsWith("10.") ||
        /^172\.(1[6-9]|2\d|3[01])\./u.test(entry.address);
      candidates.push({ address: entry.address, isPrivate });
    }
  }
  return (
    candidates.find((c) => c.isPrivate)?.address ??
    candidates[0]?.address ??
    "127.0.0.1"
  );
}

/* -------------------------------------------------------------- downloads */

/**
 * Downloads to a file, checking the SHA-256 the publisher put beside it.
 *
 * The checksum is not ceremony. This fetches a database engine over the public
 * internet onto the machine that will hold the pharmacy's records; a truncated
 * download that silently half-extracts is the good outcome without it.
 */
export async function download(url, destination, options = {}) {
  await mkdir(dirname(destination), { recursive: true });

  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`download failed (${response.status}) for ${url}`);
  }

  const total = Number(response.headers.get("content-length") ?? 0);
  let received = 0;
  let lastPrinted = 0;

  const hash = createHash("sha256");
  const source = Readable.fromWeb(response.body);
  source.on("data", (chunk) => {
    hash.update(chunk);
    received += chunk.length;
    if (!total || !process.stdout.isTTY) return;
    const percent = Math.floor((received / total) * 100);
    if (percent >= lastPrinted + 10) {
      lastPrinted = percent;
      process.stdout.write(`\r   ${paint(DIM, `downloading… ${percent}%`)}`);
    }
  });

  await pipeline(source, createWriteStream(destination));
  if (process.stdout.isTTY && total) process.stdout.write("\r[2K");

  const digest = hash.digest("hex");
  if (options.sha256 && digest !== options.sha256) {
    await rm(destination, { force: true });
    throw new Error(
      `checksum mismatch for ${url}\n  expected ${options.sha256}\n  got      ${digest}`,
    );
  }
  return digest;
}

/** The publisher's `.sha256` file, which is `<hex>  <filename>`. */
export async function fetchChecksum(url) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) return null;
  const text = await response.text();
  // Not anchored to the start. The Unix assets are `<hash>  <filename>`, but
  // the Windows ones are generated with `certutil -hashfile`, which writes a
  // header line first and puts the hash on line two:
  //
  //   SHA256 hash of postgresql-...-windows-msvc.tar.gz:
  //   7da44c2dbcda3b49...
  //   CertUtil: -hashfile command completed successfully.
  //
  // Anchoring found nothing there and returned null, and null is "no published
  // checksum" -- so every Windows install downloaded PostgreSQL unverified and
  // said so in a warning that read like the project's fault rather than a bug.
  const match = /\b([0-9a-f]{64})\b/iu.exec(text);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Extracts a .tar.gz using the system tar.
 *
 * Every target has one -- macOS and Linux forever, Windows since 10 -- and a
 * pure-JavaScript tar would be another dependency to be wrong about symlinks
 * and permissions, which matter for a PostgreSQL tree.
 */
export async function extractTarGz(archive, into) {
  await mkdir(into, { recursive: true });
  await run("tar", ["-xzf", archive, "-C", into]);
}

/* ------------------------------------------------------------------ files */

export async function writeIfAbsent(path, contents) {
  if (await exists(path)) return false;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents, "utf8");
  return true;
}

/**
 * Free space where the install is going, in gigabytes.
 *
 * Worth checking before rather than discovering three minutes into `npm ci`.
 * A full disk does not announce itself: PostgreSQL and the build both fail in
 * ways that read as corruption rather than as "no room".
 */
export async function freeSpaceGb(path) {
  const { statfs } = await import("node:fs/promises");
  try {
    const stats = await statfs(path);
    return (stats.bavail * stats.bsize) / 1024 ** 3;
  } catch {
    return null;
  }
}

/** Layout of an installation. One place, so nothing has to guess. */
/**
 * Changes named keys in a `.env` file and touches nothing else.
 *
 * Deliberately not a rewrite. That file says "Edit it and restart" at the top
 * and means it -- the timezone and the session length are the owner's to
 * change. Regenerating it from a template to flip one flag would throw their
 * edits away, and they would find out at the moment the receipt printed the
 * wrong day.
 *
 * A key that is not there is appended; a key that is there keeps its place, and
 * so does the comment above it.
 */
export async function updateEnv(file, updates) {
  let lines = [];
  try {
    lines = (await readFile(file, "utf8")).split("\n");
  } catch {
    // No file yet: the caller is creating one, and the keys are all it wants.
  }

  const remaining = new Map(Object.entries(updates));
  const updated = lines.map((line) => {
    const key = /^\s*([A-Z0-9_]+)\s*=/u.exec(line)?.[1];
    if (!key || !remaining.has(key)) return line;
    const value = remaining.get(key);
    remaining.delete(key);
    return `${key}=${value}`;
  });

  for (const [key, value] of remaining) updated.push(`${key}=${value}`);
  if (updated.at(-1) !== "") updated.push("");

  await writeFile(file, updated.join("\n"), "utf8");
}

export function layout(root) {
  return {
    root,
    app: join(root, "app"),
    postgres: join(root, "postgres"),
    data: join(root, "data", "pgdata"),
    backups: join(root, "backups"),
    logs: join(root, "logs"),
    config: join(root, "pharmacy.json"),
  };
}
