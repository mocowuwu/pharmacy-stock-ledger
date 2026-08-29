import "server-only";

import { and, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { batches, disposals, items, suppliers, users } from "@/db/schema";
import { assertPermission } from "./session";
import { recordAudit } from "@/lib/audit";
import { disposeStock, type DisposeRequest } from "@/lib/stock/disposal";
import { LedgerError } from "@/lib/stock/ledger";
import { today } from "@/lib/format/date";

export { LedgerError };

export type CreateDisposalRequest = Omit<DisposeRequest, "actorId">;

/**
 * Stock that has a reason to be written off: expired, or quarantined and going
 * nowhere. Sorted worst-first, because that is the order the shelf should be
 * cleared in.
 *
 * Anything else can still be disposed from the item's own batch list -- damage
 * and recalls do not announce themselves in advance -- but this is the working
 * queue.
 */
export async function disposableBatches() {
  await assertPermission("stock.dispose");
  const db = await getDb();

  return db
    .select({
      id: batches.id,
      lotNumber: batches.lotNumber,
      expiryDate: batches.expiryDate,
      qtyRemaining: batches.qtyRemaining,
      unitCost: batches.unitCost,
      status: batches.status,
      itemId: items.id,
      code: items.code,
      genericName: items.genericName,
      strength: items.strength,
      unit: items.unit,
      drugClass: items.drugClass,
      supplierName: suppliers.name,
    })
    .from(batches)
    .innerJoin(items, eq(items.id, batches.itemId))
    .innerJoin(suppliers, eq(suppliers.id, batches.supplierId))
    .where(
      and(
        sql`${batches.qtyRemaining} > 0`,
        or(
          inArray(batches.status, ["expired", "quarantined"]),
          // Past its date but not yet swept by the nightly job. It is not
          // sellable either way -- the ledger refuses it -- but it should
          // appear here the moment it turns, not the next morning.
          and(eq(batches.status, "active"), lte(batches.expiryDate, today())),
        ),
      ),
    )
    .orderBy(batches.expiryDate);
}

/** One batch, with enough context to confirm what is about to be destroyed. */
export async function batchForDisposal(batchId: string) {
  await assertPermission("stock.dispose");
  const db = await getDb();

  const [row] = await db
    .select({
      id: batches.id,
      lotNumber: batches.lotNumber,
      expiryDate: batches.expiryDate,
      qtyRemaining: batches.qtyRemaining,
      unitCost: batches.unitCost,
      status: batches.status,
      itemId: items.id,
      code: items.code,
      genericName: items.genericName,
      strength: items.strength,
      unit: items.unit,
      drugClass: items.drugClass,
      supplierName: suppliers.name,
    })
    .from(batches)
    .innerJoin(items, eq(items.id, batches.itemId))
    .innerJoin(suppliers, eq(suppliers.id, batches.supplierId))
    .where(eq(batches.id, batchId))
    .limit(1);

  return row ?? null;
}

export async function createDisposal(request: CreateDisposalRequest) {
  const session = await assertPermission("stock.dispose");
  const db = await getDb();

  const result = await db.transaction(async (tx) =>
    disposeStock(tx as unknown as typeof db, {
      ...request,
      actorId: session.user.id,
      // The operator is the responsible pharmacist when they are one. The
      // ledger refuses the restricted classes without this, which is the point.
      pharmacistId:
        request.pharmacistId ?? (session.user.isPharmacist ? session.user.id : null),
    }),
  );

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "stock.disposed",
    entityType: "disposals",
    entityId: result.disposalId,
    after: {
      disposalNumber: result.disposalNumber,
      batchId: request.batchId,
      qty: request.qty,
      costValue: result.costValue,
      reason: request.reason,
    },
  });

  return result;
}

/**
 * Who could sign as a witness. Destruction of drug stock is commonly witnessed
 * by a second member of staff, so this is every active account other than the
 * one doing the disposing -- the caller filters itself out.
 */
export async function witnessOptions() {
  await assertPermission("stock.dispose");
  const db = await getDb();
  return db
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(eq(users.status, "active"))
    .orderBy(users.fullName);
}

/**
 * What has been thrown away recently, at cost.
 *
 * Computed in the database rather than by filtering the list in a page: the
 * window is a date calculation, which belongs next to the data, and the figure
 * should not change depending on how many rows the screen happened to fetch.
 */
export async function recentDisposalLoss(days = 30) {
  await assertPermission("stock.dispose");
  const db = await getDb();
  const [row] = await db
    .select({
      value: sql<number>`coalesce(sum(${disposals.costValue}), 0)::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(disposals)
    .where(sql`${disposals.disposedAt} >= current_date - make_interval(days => ${days})`);
  return { value: Number(row?.value ?? 0), count: row?.count ?? 0 };
}

/** The disposal record, most recent first. Feeds the expiry-loss report later. */
export async function listDisposals(limit = 100) {
  await assertPermission("stock.dispose");
  const db = await getDb();

  return db
    .select({
      id: disposals.id,
      disposalNumber: disposals.disposalNumber,
      disposedAt: disposals.disposedAt,
      qty: disposals.qty,
      costValue: disposals.costValue,
      reason: disposals.reason,
      method: disposals.method,
      lotNumber: batches.lotNumber,
      expiryDate: batches.expiryDate,
      itemId: items.id,
      genericName: items.genericName,
      strength: items.strength,
      unit: items.unit,
      disposedBy: users.fullName,
    })
    .from(disposals)
    .innerJoin(batches, eq(batches.id, disposals.batchId))
    .innerJoin(items, eq(items.id, batches.itemId))
    .innerJoin(users, eq(users.id, disposals.disposedBy))
    .orderBy(desc(disposals.disposedAt))
    .limit(limit);
}
