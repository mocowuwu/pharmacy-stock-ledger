/**
 * Development database server.
 *
 * PGlite is an in-process Postgres, so two processes cannot share one data
 * directory: the Next.js dev server and a seed script would each hold their own
 * view of the same files, and writes made by one would be invisible to the
 * other. This wraps a single PGlite instance in a Postgres wire-protocol
 * socket, so the app, the migration script and any ad-hoc query all connect as
 * ordinary clients to one owner of the data.
 *
 * It also means development uses the same node-postgres driver as production,
 * rather than a second code path that only runs locally.
 *
 *   npm run db:serve
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const DEV_DB_PORT = Number(process.env.PGLITE_PORT ?? 54329);
export const DEV_DB_URL = `postgres://postgres:postgres@127.0.0.1:${DEV_DB_PORT}/postgres`;

export async function startDevDatabase(): Promise<{ stop: () => Promise<void> }> {
  const dir = process.env.PGLITE_DIR ?? ".data/pgdata";
  mkdirSync(dirname(dir), { recursive: true });

  const db = await PGlite.create(dir);
  const server = new PGLiteSocketServer({ db, port: DEV_DB_PORT, host: "127.0.0.1" });
  await server.start();

  return {
    stop: async () => {
      await server.stop();
      await db.close();
    },
  };
}

async function main() {
  const { stop } = await startDevDatabase();
  console.log(`Development database listening on ${DEV_DB_URL}`);
  console.log("Press Ctrl+C to stop.");

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      void stop().then(() => process.exit(0));
    });
  }
}

if (process.argv[1]?.endsWith("db-server.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
