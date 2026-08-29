import "server-only";

import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { batches, items, sales, suppliers } from "@/db/schema";
import { assertPermission } from "./session";
import { recordAudit } from "@/lib/audit";

/**
 * Clearing the demo data.
 *
 * The seeded catalogue is deliberately kept: a system that opens on an empty
 * screen teaches nobody anything, and the demo items are how staff learn the
 * till before real stock exists. But it has to be removable in one action on
 * the day the pharmacy starts counting for real, or the first month's reports
 * mix invented sales with actual ones.
 *
 * This is the only destructive operation in the system, and it is the exception
 * that proves the rule elsewhere: everything else archives, voids, suspends or
 * quarantines. Here the point is that the data was never real.
 *
 * **What survives:** accounts, permissions, settings, tax rates and the audit
 * log -- including the record of this wipe. What goes: items, batches, the
 * ledger, sales, returns, disposals, counts, alerts and suppliers.
 */

/** Typed by the owner to confirm. Deliberately not "yes". */
export const RESET_CONFIRMATION = "HAPUS DEMO";

export class MaintenanceError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "MaintenanceError";
  }
}

export async function demoDataSummary() {
  await assertPermission("settings.manage");
  const db = await getDb();

  const [row] = await db
    .select({
      items: sql<number>`(select count(*)::int from ${items})`,
      batches: sql<number>`(select count(*)::int from ${batches})`,
      sales: sql<number>`(select count(*)::int from ${sales})`,
      suppliers: sql<number>`(select count(*)::int from ${suppliers} where is_system = false)`,
    })
    .from(sql`(select 1) as one`);

  return row ?? { items: 0, batches: 0, sales: 0, suppliers: 0 };
}

/**
 * Wipes the operational data and leaves the pharmacy configured and staffed.
 *
 * One `truncate ... cascade` rather than a careful sequence of deletes: the
 * foreign keys between these tables are dense, and a partial wipe that stopped
 * halfway would leave a ledger referring to items that no longer exist. All of
 * it or none of it.
 */
export async function resetDemoData(confirmation: string) {
  const session = await assertPermission("settings.manage");
  if (!session.user.isOwner) throw new MaintenanceError("owner_only");
  if (confirmation.trim() !== RESET_CONFIRMATION) {
    throw new MaintenanceError("confirmation_mismatch");
  }

  const db = await getDb();
  const before = await demoDataSummary();

  await db.execute(sql`
    truncate table
      stock_movements, stock_adjustments, stock_count_lines, stock_counts,
      disposals, return_lines, returns, sale_lines, sales,
      alerts, batches, item_barcodes, items, suppliers
    restart identity cascade
  `);

  // Written after the wipe, and it survives it: the audit log is not in the
  // truncate list, so "the owner cleared the demo data on this date" is part of
  // the permanent record rather than something that vanishes with the data.
  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "settings.demo_data_cleared",
    entityType: "settings",
    entityId: null,
    before,
  });

  return before;
}
