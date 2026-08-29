import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { batches, items, returns, returnLines, sales, saleLines, users } from "@/db/schema";
import { assertPermission } from "./session";
import { addDays, today } from "@/lib/format/date";
import { getSettings } from "./settings";
import { recordAudit } from "@/lib/audit";
import {
  commitSale,
  reverseSale,
  SaleError,
  type CommitSaleRequest,
  type SaleLineRequest,
} from "@/lib/stock/sale";
import {
  commitReturn,
  returnedQtyBySaleLine,
  type CommitReturnRequest,
} from "@/lib/stock/return";
import type { AvailableBatch } from "@/lib/stock/fefo";

export { SaleError };
export type { SaleLineRequest };

export type CreateReturnRequest = Omit<
  CommitReturnRequest,
  "actorId" | "actorIsPharmacist"
>;

export type CreateSaleRequest = Omit<CommitSaleRequest, "actorId" | "actorIsPharmacist">;

/** Sellable stock for one item, in the order it should leave the shelf. */
export async function sellableStock(itemId: string): Promise<AvailableBatch[]> {
  await assertPermission("items.view");
  const db = await getDb();
  return db
    .select({
      id: batches.id,
      lotNumber: batches.lotNumber,
      expiryDate: batches.expiryDate,
      qtyRemaining: batches.qtyRemaining,
      unitCost: batches.unitCost,
      status: batches.status,
    })
    .from(batches)
    .where(and(eq(batches.itemId, itemId), eq(batches.status, "active")))
    .orderBy(batches.expiryDate);
}

export async function createSale(request: CreateSaleRequest) {
  const session = await assertPermission("sales.create");
  const db = await getDb();

  if (request.discount && request.discount > 0) {
    await assertPermission("sales.discount");
  }

  const result = await db.transaction(async (tx) =>
    commitSale(tx as unknown as typeof db, {
      ...request,
      actorId: session.user.id,
      actorIsPharmacist: session.user.isPharmacist,
    }),
  );

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "sale.created",
    entityType: "sales",
    entityId: result.saleId,
    after: { saleNumber: result.saleNumber, total: result.total },
  });

  return result;
}

export async function voidSale(saleId: string, reason: string) {
  const session = await assertPermission("sales.void");
  const db = await getDb();

  const result = await db.transaction(async (tx) =>
    reverseSale(tx as unknown as typeof db, {
      saleId,
      reason,
      actorId: session.user.id,
    }),
  );

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "sale.voided",
    entityType: "sales",
    entityId: saleId,
    before: result.sale,
    after: { reason, linesReversed: result.linesReversed },
  });

  return result;
}

/* --------------------------------------------------------------- reading */

export async function listSales(opts: { limit?: number } = {}) {
  const session = await assertPermission("sales.create");
  const db = await getDb();

  // Without sales.view_all a cashier sees their own sales and nobody else's.
  const canSeeAll =
    session.grant.isOwner || session.grant.permissions.has("sales.view_all");

  return db
    .select({
      id: sales.id,
      saleNumber: sales.saleNumber,
      soldAt: sales.soldAt,
      total: sales.total,
      paymentMethod: sales.paymentMethod,
      status: sales.status,
      cashier: users.fullName,
    })
    .from(sales)
    .innerJoin(users, eq(users.id, sales.cashierId))
    .where(canSeeAll ? undefined : eq(sales.cashierId, session.user.id))
    .orderBy(desc(sales.soldAt))
    .limit(opts.limit ?? 100);
}

/** Takings so far today, for the dashboard. Voided sales do not count. */
export async function todaysTakings() {
  await assertPermission("sales.create");
  const db = await getDb();
  const { timezone } = await getSettings();

  const [sold] = await db
    .select({
      total: sql<number>`coalesce(sum(${sales.total}), 0)::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(sales)
    .where(
      and(
        eq(sales.status, "completed"),
        sql`(${sales.soldAt} at time zone ${timezone})::date
            = (now() at time zone ${timezone})::date`,
      ),
    );

  // Refunds come off, exactly as they do in the sales report. Two different
  // answers to "what did we take today" would be worse than either.
  const [refunded] = await db
    .select({ total: sql<number>`coalesce(sum(${returns.refundTotal}), 0)::bigint` })
    .from(returns)
    .where(
      sql`(${returns.returnedAt} at time zone ${timezone})::date
          = (now() at time zone ${timezone})::date`,
    );

  const gross = Number(sold?.total ?? 0);
  const refunds = Number(refunded?.total ?? 0);
  return { total: gross - refunds, gross, refunds, count: sold?.count ?? 0 };
}

/**
 * Takings per day over a window, with empty days included as zero.
 *
 * The gaps matter: a line that skips quiet days would slope through them and
 * imply trade that did not happen.
 */
export async function dailyTakings(days = 30) {
  await assertPermission("sales.create");
  const db = await getDb();
  // A day is a day in the pharmacy's timezone, as it is in the reports.
  const { timezone } = await getSettings();

  const rows = await db
    .select({
      day: sql<string>`(${sales.soldAt} at time zone ${timezone})::date::text`,
      total: sql<number>`coalesce(sum(${sales.total}), 0)::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(sales)
    .where(
      and(
        eq(sales.status, "completed"),
        sql`${sales.soldAt} >= current_date - make_interval(days => ${days - 1})`,
      ),
    )
    // By output position: the timezone is a bind parameter, and Postgres will
    // not match `$1` in the GROUP BY against `$6` in the SELECT.
    .groupBy(sql`1`);

  const byDay = new Map(rows.map((r) => [r.day, { total: Number(r.total), count: r.count }]));
  const series: Array<{ day: string; total: number; count: number }> = [];

  for (let i = days - 1; i >= 0; i--) {
    const day = addDays(today(), -i);
    const hit = byDay.get(day);
    series.push({ day, total: hit?.total ?? 0, count: hit?.count ?? 0 });
  }
  return series;
}

export async function getSale(saleId: string) {
  const session = await assertPermission("sales.create");
  const db = await getDb();

  const [sale] = await db
    .select({
      id: sales.id,
      saleNumber: sales.saleNumber,
      soldAt: sales.soldAt,
      subtotal: sales.subtotal,
      discount: sales.discount,
      taxAmount: sales.taxAmount,
      taxRateBps: sales.taxRateBps,
      taxMode: sales.taxMode,
      total: sales.total,
      paymentMethod: sales.paymentMethod,
      tendered: sales.tendered,
      changeGiven: sales.changeGiven,
      status: sales.status,
      voidReason: sales.voidReason,
      notes: sales.notes,
      cashierId: sales.cashierId,
      cashier: users.fullName,
    })
    .from(sales)
    .innerJoin(users, eq(users.id, sales.cashierId))
    .where(eq(sales.id, saleId))
    .limit(1);

  if (!sale) return null;

  const canSeeAll =
    session.grant.isOwner || session.grant.permissions.has("sales.view_all");
  if (!canSeeAll && sale.cashierId !== session.user.id) return null;

  const lines = await db
    .select({
      id: saleLines.id,
      qty: saleLines.qty,
      unitPrice: saleLines.unitPrice,
      lineTotal: saleLines.lineTotal,
      overrideReason: saleLines.fefoOverrideReason,
      itemName: items.genericName,
      strength: items.strength,
      unit: items.unit,
      lotNumber: batches.lotNumber,
      expiryDate: batches.expiryDate,
    })
    .from(saleLines)
    .innerJoin(items, eq(items.id, saleLines.itemId))
    .innerJoin(batches, eq(batches.id, saleLines.batchId))
    .where(eq(saleLines.saleId, saleId));

  return { ...sale, lines };
}

/* --------------------------------------------------------------- returns */

/**
 * The lines of a sale that can still come back, with how much of each already
 * has. The till needs this before it can offer a return at all.
 */
export async function returnableLines(saleId: string) {
  await assertPermission("sales.return");
  const db = await getDb();

  const sale = await getSale(saleId);
  if (!sale) return null;

  const already = await returnedQtyBySaleLine(db, saleId);

  return {
    sale,
    lines: sale.lines.map((line) => ({
      ...line,
      alreadyReturned: already.get(line.id) ?? 0,
      returnable: line.qty - (already.get(line.id) ?? 0),
    })),
  };
}

export async function createReturn(request: CreateReturnRequest) {
  const session = await assertPermission("sales.return");
  const db = await getDb();

  const result = await db.transaction(async (tx) =>
    commitReturn(tx as unknown as typeof db, {
      ...request,
      actorId: session.user.id,
      actorIsPharmacist: session.user.isPharmacist,
    }),
  );

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "sale.returned",
    entityType: "returns",
    entityId: result.returnId,
    after: {
      returnNumber: result.returnNumber,
      saleId: request.saleId,
      refundTotal: result.refundTotal,
      restockedLines: result.restocked,
    },
  });

  return result;
}

/**
 * How many units of a sale could still come back. Zero means the return screen
 * has nothing to offer, so the sale detail should stop advertising it.
 */
export async function returnableUnits(saleId: string): Promise<number> {
  await assertPermission("sales.return");
  const db = await getDb();

  const [row] = await db
    .select({ sold: sql<number>`coalesce(sum(${saleLines.qty}), 0)::int` })
    .from(saleLines)
    .where(eq(saleLines.saleId, saleId));

  const already = await returnedQtyBySaleLine(db, saleId);
  const returned = [...already.values()].reduce((sum, qty) => sum + qty, 0);

  return Math.max((row?.sold ?? 0) - returned, 0);
}

/** Returns booked against one sale, for the sale detail screen. */
export async function returnsForSale(saleId: string) {
  await assertPermission("sales.create");
  const db = await getDb();

  return db
    .select({
      id: returns.id,
      returnNumber: returns.returnNumber,
      returnedAt: returns.returnedAt,
      refundTotal: returns.refundTotal,
      refundMethod: returns.refundMethod,
      reason: returns.reason,
      processedBy: users.fullName,
    })
    .from(returns)
    .innerJoin(users, eq(users.id, returns.processedBy))
    .where(eq(returns.saleId, saleId))
    .orderBy(desc(returns.returnedAt));
}

/** Every return, most recent first. */
export async function listReturns(limit = 100) {
  await assertPermission("sales.return");
  const db = await getDb();

  return db
    .select({
      id: returns.id,
      returnNumber: returns.returnNumber,
      returnedAt: returns.returnedAt,
      refundTotal: returns.refundTotal,
      refundMethod: returns.refundMethod,
      reason: returns.reason,
      saleId: returns.saleId,
      saleNumber: sales.saleNumber,
      processedBy: users.fullName,
      lines: sql<number>`(select count(*)::int from ${returnLines} where ${returnLines.returnId} = ${returns.id})`,
    })
    .from(returns)
    .innerJoin(sales, eq(sales.id, returns.saleId))
    .innerJoin(users, eq(users.id, returns.processedBy))
    .orderBy(desc(returns.returnedAt))
    .limit(limit);
}
