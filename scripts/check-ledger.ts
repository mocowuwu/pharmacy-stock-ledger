/**
 * Reconciles every batch's stored quantity against its ledger.
 *
 * This is the invariant the whole design rests on: `batches.qty_remaining` must
 * always equal the sum of that batch's movements. Run it on a schedule, so a
 * drift is found by the system rather than by a confused person holding a stock
 * sheet.
 *
 *   npx tsx scripts/check-ledger.ts
 *
 * Exits non-zero if anything disagrees, so it can be wired to an alert.
 */
import "./env";
import { sql } from "drizzle-orm";
import { getDbHandle } from "../src/db/client";
import { batches, items, stockMovements } from "../src/db/schema";
import { findLedgerDrift } from "../src/lib/stock/ledger";

async function main() {
  const { db, close } = await getDbHandle();

  const [counts] = await db
    .select({
      batches: sql<number>`(select count(*) from ${batches})::int`,
      movements: sql<number>`(select count(*) from ${stockMovements})::int`,
      units: sql<number>`(select coalesce(sum(${batches.qtyRemaining}), 0) from ${batches})::int`,
    })
    .from(items)
    .limit(1);

  const drift = await findLedgerDrift(db);

  console.log(`batches   : ${counts?.batches ?? 0}`);
  console.log(`movements : ${counts?.movements ?? 0}`);
  console.log(`units held: ${counts?.units ?? 0}`);

  if (drift.length === 0) {
    console.log("\nLedger agrees with every batch.");
    await close();
    return;
  }

  console.error(`\n${drift.length} batch(es) disagree with the ledger:`);
  for (const row of drift) {
    console.error(`  batch ${row.batchId}: stored ${row.stored}, ledger ${row.ledger}`);
  }
  await close();
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
