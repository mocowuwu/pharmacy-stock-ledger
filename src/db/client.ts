import { drizzle as drizzleNodePg } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

/**
 * Database connection.
 *
 * This module deliberately carries no `server-only` guard: the migrate, seed
 * and scheduled-job scripts run as plain Node processes and need it. Anything
 * inside the Next.js app imports `@/db` instead, which re-exports this module
 * behind that guard.
 *
 * Normal operation -- development and production alike -- goes through
 * DATABASE_URL and node-postgres. In development that URL points at the PGlite
 * socket server `npm run dev` starts (see scripts/db-server.ts); in production
 * it points at the Postgres server in docker-compose.yml. Using one driver for
 * both means the local code path is the deployed code path.
 *
 * With no DATABASE_URL the fallback is an *in-memory* PGlite, which exists for
 * tests: each run gets a private database that disappears afterwards.
 *
 * There is deliberately no file-backed embedded mode. PGlite is in-process, so
 * two processes pointed at one data directory each hold their own view of it
 * and silently diverge -- a dev server would not see rows a seed script had
 * just written. The socket server exists precisely so there is one owner.
 */
export type Database = NodePgDatabase<typeof schema>;

type Cached = { db: Database; close: () => Promise<void> };

// Next.js re-evaluates modules on hot reload, which would otherwise open a new
// pool (or a second PGlite instance on the same data directory) every time.
const globalForDb = globalThis as unknown as { __pharmacyDb?: Promise<Cached> };

async function connect(): Promise<Cached> {
  const url = process.env.DATABASE_URL;

  if (url) {
    const { Pool } = await import("pg");

    /**
     * The development database is PGlite behind a socket, and it serves a
     * single connection: a pool that opens a second one gets ECONNRESET the
     * first time two queries overlap -- which any `Promise.all` of two reads
     * does. Capping the pool makes those queries queue instead.
     *
     * This is set only for the development database. Against a real Postgres
     * server the pool default applies, so concurrent queries genuinely run
     * concurrently and application code never has to know the difference.
     */
    const max = process.env.DATABASE_MAX_CONNECTIONS
      ? Number(process.env.DATABASE_MAX_CONNECTIONS)
      : undefined;

    // The cap is per process, and PGlite's limit is global: a dev server
    // holding an idle connection plus a seed script opening its own already
    // exceeds it. Releasing idle connections quickly keeps the two out of each
    // other's way. Harmless against a real Postgres server, where this whole
    // branch does not apply.
    const pool = new Pool({
      connectionString: url,
      ...(max ? { max, idleTimeoutMillis: 1_000 } : {}),
    });
    return {
      db: drizzleNodePg(pool, { schema }),
      close: () => pool.end(),
    };
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");

  // In-memory: private to this process, gone when it exits.
  const client = new PGlite();
  return {
    // Both drivers implement the same query and transaction surface; the cast
    // keeps a single `Database` type across the app rather than a union that
    // every call site would have to narrow.
    db: drizzlePglite(client, { schema }) as unknown as Database,
    close: () => client.close(),
  };
}

export function getDbHandle(): Promise<Cached> {
  globalForDb.__pharmacyDb ??= connect();
  return globalForDb.__pharmacyDb;
}

export async function getDb(): Promise<Database> {
  return (await getDbHandle()).db;
}

/** True only for the in-memory test database. */
export function isEphemeral(): boolean {
  return !process.env.DATABASE_URL;
}

export { schema };
