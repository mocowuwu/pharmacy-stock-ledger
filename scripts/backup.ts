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
 * This handles the database only. The other half of a restore is the
 * `.env.local` file: without `SESSION_SECRET` the restored database is intact
 * but nobody can sign in. Keep a copy of it somewhere separate, and treat it
 * as the secret it is.
 */
import "./env";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
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

  const dump = spawn(
    "pg_dump",
    [
      url,
      "--format=custom",
      "--compress=9",
      // The ledger is append-only and the dump is of a live pharmacy: a
      // consistent snapshot matters more than speed.
      "--serializable-deferrable",
      `--file=${file}`,
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );

  dump.on("error", (error) => {
    console.error(
      `Could not run pg_dump: ${error.message}\n` +
        "On macOS with Homebrew it lives in /opt/homebrew/opt/postgresql@18/bin.",
    );
    process.exit(1);
  });

  dump.on("exit", (code) => {
    if (code !== 0) {
      console.error(`pg_dump exited with ${code}. The backup was NOT written.`);
      process.exit(code ?? 1);
    }
    console.log("Backup written.");
    console.log("");
    console.log("Two things left, and neither is optional:");
    console.log("  1. Copy it off this machine. A backup on the machine that dies");
    console.log("     is not a backup.");
    console.log("  2. Restore it into a scratch database and look at the data.");
    console.log("     npm run restore -- " + file + " --into pharmacy_restore_test");
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
