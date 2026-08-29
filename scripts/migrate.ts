/**
 * Applies pending migrations. Works against whichever driver is configured:
 * a Postgres server when DATABASE_URL is set, PGlite otherwise.
 *
 *   npm run db:migrate
 */
import "./env";
import { getDbHandle, isEphemeral } from "../src/db/client";

async function main() {
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
