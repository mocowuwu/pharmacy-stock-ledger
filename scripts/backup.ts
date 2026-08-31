/**
 * Takes a backup.
 *
 * `pg_dump` in custom format, gzip-compressed by pg_dump itself, written to a
 * dated file. Nothing clever: the point of a backup script is that it works on
 * the worst day of the year, and every layer of cleverness is a layer that can
 * be the reason it doesn't.
 *
 *   npm run backup                     -> backups/pharmacy-2026-08-29-2130.dump
 *   npm run backup -- --out /Volumes/USB
 *
 * Restore is `npm run restore -- <file>`, and **it must be rehearsed before
 * real data goes in, not after.** A backup nobody has restored is a hypothesis.
 *
 * This handles the database only. Keep a copy of `.env.local` somewhere
 * separate too: it holds the database password, and a dump you cannot connect
 * to is not much use. There is no session secret to lose -- sessions are opaque
 * random tokens stored as hashes, so a restored database keeps working with no
 * key to reunite it with.
 *
 * ## Getting it off the machine automatically
 *
 * Set `BACKUP_RCLONE_REMOTE` in `.env.local` (e.g. `gdrive:pharmacy-backups`)
 * and the dump is copied there with `rclone copy` after it lands locally.
 * rclone, not a hand-rolled Google API client, because token refresh for a
 * script nobody watches is exactly the kind of thing worth handing to a tool
 * that already does it for a living -- see README.md for one-time setup. With
 * no remote configured this behaves exactly as before: local file only.
 *
 * This runs through the supervisor's daily job and the control panel's
 * "back up now" button alike (`installer/operations.mjs`'s `backup()`, which
 * just runs this script) -- one code path, so an upload failure here is
 * surfaced the same way a `pg_dump` failure already is: the job recorded as
 * failed, not silently skipped.
 */
import "./env";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

/** Runs a command, resolving its exit code rather than throwing on a nonzero one. */
function run(command: string, args: string[]): Promise<{ code: number | null; missing: boolean }> {
  return new Promise((done) => {
    const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", (error) => {
      done({ code: null, missing: (error as NodeJS.ErrnoException).code === "ENOENT" });
    });
    child.on("exit", (code) => done({ code, missing: false }));
  });
}

/** `2026-08-29-2130`, in the machine's local time -- when the operator took it. */
function stamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`
  );
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      "DATABASE_URL is not set.\n" +
        "The development database is an embedded one and is not backed up this way;\n" +
        "point DATABASE_URL at the server you actually run on.",
    );
    process.exit(1);
  }

  const directory = resolve(argument("out") ?? "backups");
  await mkdir(directory, { recursive: true });
  const file = resolve(directory, `pharmacy-${stamp()}.dump`);

  console.log(`Dumping to ${file}`);

  const dump = await run("pg_dump", [
    url,
    "--format=custom",
    "--compress=9",
    // The ledger is append-only and the dump is of a live pharmacy: a
    // consistent snapshot matters more than speed.
    "--serializable-deferrable",
    `--file=${file}`,
  ]);

  if (dump.missing) {
    console.error(
      "Could not run pg_dump: command not found.\n" +
        "On macOS with Homebrew it lives in /opt/homebrew/opt/postgresql@18/bin.",
    );
    process.exit(1);
  }
  if (dump.code !== 0) {
    console.error(`pg_dump exited with ${dump.code}. The backup was NOT written.`);
    process.exit(dump.code ?? 1);
  }

  console.log("Backup written.");

  const remote = argument("remote") ?? process.env.BACKUP_RCLONE_REMOTE;
  if (remote) {
    console.log(`Uploading to ${remote}`);
    const upload = await run("rclone", ["copy", file, remote]);

    if (upload.missing) {
      console.error(
        "\nThe dump is safe at " +
          file +
          ", but rclone is not installed, so it never left this machine.\n" +
          "Install it from https://rclone.org/downloads/ and run `rclone config`\n" +
          "once to set up the " +
          JSON.stringify(remote.split(":")[0]) +
          " remote -- see README.md.",
      );
      process.exit(1);
    }
    if (upload.code !== 0) {
      console.error(
        `\nrclone exited with ${upload.code}. The dump is safe at ${file},\n` +
          "but it did not reach " + remote + " -- check the network and the remote's\n" +
          "credentials (`rclone config reconnect " + remote.split(":")[0] + ":`).",
      );
      process.exit(upload.code ?? 1);
    }
    console.log(`Uploaded to ${remote}.`);
  }

  console.log("");
  if (remote) {
    console.log("One thing left, and it is not optional:");
    console.log("  Restore it into a scratch database and look at the data.");
    console.log("  npm run restore -- " + file + " --into pharmacy_restore_test");
  } else {
    console.log("Two things left, and neither is optional:");
    console.log("  1. Copy it off this machine. A backup on the machine that dies");
    console.log("     is not a backup. Set BACKUP_RCLONE_REMOTE in .env.local to");
    console.log("     automate this -- see README.md.");
    console.log("  2. Restore it into a scratch database and look at the data.");
    console.log("     npm run restore -- " + file + " --into pharmacy_restore_test");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
