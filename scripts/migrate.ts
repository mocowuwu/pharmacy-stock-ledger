/**
 * Applies pending migrations. Works against whichever driver is configured:
 * a Postgres server when DATABASE_URL is set, PGlite otherwise.
 *
 *   npm run db:migrate
 *
 * `MIGRATE_DATABASE_URL`, when set, is used instead of DATABASE_URL. The hosted
 * demo needs it: the app talks to Supabase through its transaction pooler, and
 * migrations want a direct connection. `--require-url` refuses to fall back to
 * the in-memory database -- a Vercel build missing its variable would
 * otherwise "migrate" nothing and report success.
 */
import "./env";
import { getDbHandle, isEphemeral } from "../src/db/client";

async function main() {
  if (process.env.MIGRATE_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.MIGRATE_DATABASE_URL;
  }
  if (process.argv.includes("--require-url") && isEphemeral()) {
    throw new Error("No DATABASE_URL or MIGRATE_DATABASE_URL set; refusing to migrate an in-memory database.");
  }

  const { db, close } = await getDbHandle();
  const target = isEphemeral()
    ? "an in-memory database (no DATABASE_URL set)"
    : process.env.DATABASE_URL!.replace(/:[^:@/]*@/, ":***@");
  console.log(`Applying migrations to ${target}...`);

  if (isEphemeral()) {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await migrate(db as any, { migrationsFolder: "./drizzle" });
  } else {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db, { migrationsFolder: "./drizzle" });
  }

  console.log("Migrations applied.");
  await close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
