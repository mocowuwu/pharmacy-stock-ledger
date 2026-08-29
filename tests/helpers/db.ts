import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/db/schema";

export type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];

/**
 * A private, in-memory Postgres for one test file, with the real migrations
 * applied. Testing against the actual schema is the point: the check
 * constraints and partial indexes are load-bearing, and a mocked repository
 * would not exercise any of them.
 */
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { db, client, close: () => client.close() };
}

/**
 * Runs a query expected to violate a database constraint and returns the
 * constraint's name.
 *
 * Drizzle wraps driver errors as "Failed query: ...", so the Postgres detail --
 * including which constraint refused -- sits on `cause` rather than in the
 * message. Asserting on the name matters: a test that only checks "something
 * threw" would still pass if the query failed for an unrelated reason.
 */
export async function violatedConstraint(query: Promise<unknown>): Promise<string> {
  try {
    await query;
  } catch (error) {
    const cause = (error as { cause?: { constraint?: string; message?: string } }).cause;
    if (cause?.constraint) return cause.constraint;

    // Unique-index violations name the index in the detail message rather than
    // in a `constraint` field.
    const text = `${cause?.message ?? ""} ${String(error)}`;
    const match = /"([a-z0-9_]+)"/iu.exec(text);
    if (match) return match[1];
    return text.trim();
  }
  throw new Error("Expected the query to be refused, but it succeeded.");
}
