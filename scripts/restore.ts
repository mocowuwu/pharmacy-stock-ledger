/**
 * Restores a backup, and by default restores it somewhere harmless.
 *
 *   npm run restore -- backups/pharmacy-2026-08-29-2130.dump
 *
 * That restores into a scratch database called `pharmacy_restore_test`, leaving
 * the live one untouched. **This is the drill**, and it is the whole point: a
 * backup nobody has restored is a hypothesis, and the morning you find out
 * otherwise is the morning you needed it.
 *
 * To restore over the live database you have to say so and mean it:
 *
 *   npm run restore -- <file> --into pharmacy --i-am-replacing-live-data
 *
 * It refuses without that flag, because the difference between the drill and
 * the disaster is one word on a command line at four in the morning.
 */
import "./env";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const SCRATCH = "pharmacy_restore_test";

function run(command: string, args: string[]): Promise<number> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"] });
    child.on("error", fail);
    child.on("exit", (code) => done(code ?? 1));
  });
}

async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) {
    console.error("usage: restore.ts <backup file> [--into <database>] [--i-am-replacing-live-data]");
    process.exit(1);
  }

  const path = resolve(file);
  try {
    await access(path);
  } catch {
    console.error(`No such backup: ${path}`);
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set; it names the server to restore into.");
    process.exit(1);
  }

  const target = argument("into") ?? SCRATCH;
  const replacingLive = process.argv.includes("--i-am-replacing-live-data");

  if (target !== SCRATCH && !replacingLive) {
    console.error(
      `Refusing to restore into "${target}".\n\n` +
        "Without --into this restores into the scratch database and leaves the\n" +
        "live one alone, which is what the drill wants. If you really are\n" +
        "replacing live data, add --i-am-replacing-live-data and be sure you\n" +
        "have a backup of what you are about to overwrite.",
    );
    process.exit(1);
  }

  // Rebuild the server URL with the target database name on the end.
  const server = new URL(url);
  server.pathname = `/${target}`;

  console.log(`Restoring ${path}`);
  console.log(`        -> ${server.protocol}//${server.host}/${target}`);
  if (replacingLive) console.log("        -> REPLACING LIVE DATA");
  console.log("");

  if (target === SCRATCH) {
    // Dropping and recreating gives the drill a clean target every time, so a
    // successful restore cannot be a leftover from the previous one.
    await run("dropdb", ["--if-exists", "-h", server.hostname, "-p", server.port || "5432", target]);
    const created = await run("createdb", ["-h", server.hostname, "-p", server.port || "5432", target]);
    if (created !== 0) {
      console.error("Could not create the scratch database.");
      process.exit(created);
    }
  }

  const code = await run("pg_restore", [
    "--dbname",
    server.toString(),
    "--clean",
    "--if-exists",
    "--no-owner",
    "--exit-on-error",
    path,
  ]);

  if (code !== 0) {
    console.error(`pg_restore exited with ${code}. The restore did NOT complete.`);
    process.exit(code);
  }

  console.log("");
  console.log("Restored. Now check it is actually usable, not merely present:");
  console.log(`  psql ${server.toString()} -c "select count(*) from stock_movements"`);
  console.log(`  DATABASE_URL=${server.toString()} npm run check-ledger`);
  console.log("");
  console.log("The second one matters most: it proves the ledger still reconciles.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
