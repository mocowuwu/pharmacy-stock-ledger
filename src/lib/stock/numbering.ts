import { sql } from "drizzle-orm";
import type { Database } from "@/db/client";

/**
 * Document numbers -- sales, returns, disposals, counts.
 *
 * Every one of them is allocated the same way: read the highest number issued
 * today, add one. That is correct with one till and wrong with two, and the
 * failure is not a harmless collision. Two simultaneous sales both read the
 * same highest number, both build the same next one, and the unique index
 * refuses the second -- so a cashier with plenty of stock in front of them
 * gets an opaque database error instead of a receipt.
 *
 * A real Postgres server found this; the development database could not,
 * because it serves a single connection and never contends.
 *
 * The fix is to serialise the read-then-insert on a lock named after the
 * series and the day. `pg_advisory_xact_lock` is held until the transaction
 * commits or rolls back, so a sale that fails later releases it without
 * leaving a gap in the numbering -- the increment rolls back with everything
 * else.
 *
 * Call it as late as possible, immediately before the insert that uses the
 * number: everything before that point can still run concurrently, and only
 * the moment of numbering is single-file. It is always the last lock taken in
 * a transaction, so it cannot be half of a deadlock cycle.
 */
export async function lockNumberSeries(
  tx: Database,
  series: string,
  on: string,
): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${series}:${on}`})::bigint)`);
}
