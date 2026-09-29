import { and, between, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { devicePasses, items, offlineSaleReviews, sales, users } from "@/db/schema";
import { commitSale, SaleError } from "@/lib/stock/sale";
import { LedgerError } from "@/lib/stock/ledger";
import { permissionsOf, type DeviceRow } from "./devices";
import type { OfflineSale, SyncResult } from "./contract";

/**
 * Booking a sale the Android till rang while the server was unreachable.
 *
 * The phone's copy is never the record. Every sale goes through `commitSale`,
 * the same transaction as the counter's, which allocates FEFO against the
 * stock as it is now and refuses anything expired. What cannot be booked is
 * not dropped -- the medicine has already left the shop -- it waits on the
 * review list with everything the phone sent, for a manager to decide.
 *
 * The sale is dated from the server's own clock: the pass it was rung under
 * was issued at a time the server recorded, and the phone reports how long
 * after that it rang the sale on a clock that changing the date cannot move.
 */

type Flag =
  | "unknown_pass"
  | "outside_pass"
  | "over_pass_limit"
  | "cashier_inactive"
  | "cashier_cannot_sell"
  | "discount_without_permission"
  | "price_differs"
  | "total_differs";

function saleErrorCode(error: unknown): string | null {
  if (error instanceof SaleError) return error.code;
  if (error instanceof LedgerError) return error.code;
  return null;
}

async function postSale(
  db: Database,
  device: { id: string },
  sale: OfflineSale,
  soldAt: Date,
  cashier: { id: string; isPharmacist: boolean },
) {
  return db.transaction(async (tx) =>
    commitSale(tx as unknown as Database, {
      actorId: cashier.id,
      actorIsPharmacist: cashier.isPharmacist,
      lines: sale.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitPrice: l.unitPrice })),
      paymentMethod: sale.paymentMethod,
      discount: sale.discount,
      tendered: sale.tendered,
      notes: sale.notes,
      offline: {
        clientId: sale.clientId,
        number: sale.offlineNumber,
        deviceId: device.id,
        soldAt,
      },
    }),
  );
}

export async function replayOfflineSale(
  db: Database,
  device: DeviceRow,
  sale: OfflineSale,
  now: Date = new Date(),
): Promise<SyncResult & { saleId?: string; actorId?: string }> {
  // Already here? A phone that lost its connection halfway through a sync
  // sends the whole queue again.
  const [booked] = await db
    .select({ id: sales.id, number: sales.saleNumber })
    .from(sales)
    .where(eq(sales.offlineClientId, sale.clientId))
    .limit(1);
  if (booked) {
    return { clientId: sale.clientId, status: "duplicate", saleNumber: booked.number, flags: [] };
  }
  const [waiting] = await db
    .select({ id: offlineSaleReviews.id })
    .from(offlineSaleReviews)
    .where(eq(offlineSaleReviews.clientId, sale.clientId))
    .limit(1);
  if (waiting) return { clientId: sale.clientId, status: "duplicate", flags: [] };

  const flags: Flag[] = [];

  const [pass] = await db
    .select()
    .from(devicePasses)
    .where(and(eq(devicePasses.id, sale.passId), eq(devicePasses.deviceId, device.id)))
    .limit(1);

  let soldAt: Date;
  if (!pass) {
    flags.push("unknown_pass");
    soldAt = now;
  } else {
    const claimed = pass.issuedAt.getTime() + Math.max(0, sale.elapsedMs);
    if (sale.elapsedMs < 0 || claimed > pass.expiresAt.getTime()) flags.push("outside_pass");
    // Never in the future, whatever the phone says.
    soldAt = new Date(Math.min(claimed, now.getTime()));

    const [used] = await db
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(${sales.total}), 0)::bigint`,
      })
      .from(sales)
      .where(
        and(
          eq(sales.deviceId, device.id),
          between(sales.soldAt, pass.issuedAt, pass.expiresAt),
        ),
      );
    if (
      (used?.count ?? 0) + 1 > pass.maxSales ||
      Number(used?.total ?? 0) + sale.total > pass.maxTotal
    ) {
      flags.push("over_pass_limit");
    }
  }

  // Users are never deleted, so an id the phone holds always resolves --
  // unless the payload is not what the app sent.
  const [cashier] = await db.select().from(users).where(eq(users.id, sale.cashierId)).limit(1);
  const actor = cashier ?? (await db.select().from(users).where(eq(users.id, device.registeredBy)))[0];

  if (cashier) {
    if (cashier.status !== "active") flags.push("cashier_inactive");
    const granted = new Set(await permissionsOf(db, cashier));
    if (!granted.has("sales.create")) flags.push("cashier_cannot_sell");
    if (sale.discount > 0 && !granted.has("sales.discount")) {
      flags.push("discount_without_permission");
    }
  } else {
    flags.push("cashier_inactive");
  }

  const prices = sale.lines.length
    ? await db
        .select({ id: items.id, price: items.defaultPrice })
        .from(items)
        .where(inArray(items.id, sale.lines.map((l) => l.itemId)))
    : [];
  const priceOf = new Map(prices.map((p) => [p.id, p.price]));
  if (sale.lines.some((l) => priceOf.has(l.itemId) && priceOf.get(l.itemId) !== l.unitPrice)) {
    flags.push("price_differs");
  }

  const review = (kind: "not_posted" | "flagged", reasons: string[], saleId: string | null) =>
    db.insert(offlineSaleReviews).values({
      kind,
      deviceId: device.id,
      clientId: sale.clientId,
      offlineNumber: sale.offlineNumber,
      cashierId: actor.id,
      soldAt,
      saleId,
      reasons,
      payload: sale,
    });

  try {
    const result = await postSale(db, device, sale, soldAt, actor);
    if (result.total !== sale.total) flags.push("total_differs");
    if (flags.length > 0) await review("flagged", flags, result.saleId);
    return {
      clientId: sale.clientId,
      status: flags.length > 0 ? "review" : "posted",
      saleNumber: result.saleNumber,
      saleId: result.saleId,
      actorId: actor.id,
      flags,
    };
  } catch (error) {
    const code = saleErrorCode(error);
    if (!code) throw error;
    await review("not_posted", [code, ...flags], null);
    return { clientId: sale.clientId, status: "review", actorId: actor.id, flags: [code, ...flags] };
  }
}

/**
 * A manager's second attempt at a sale that could not be booked -- typically
 * after receiving or correcting the stock it names. Books it as the cashier who
 * rang it, on the day it was rung, and closes the review with the manager's
 * note either way it is closed.
 */
export async function retryOfflineReview(
  db: Database,
  input: { reviewId: string; actorId: string; note: string },
): Promise<{ ok: true; saleNumber: string } | { ok: false; code: string }> {
  const [row] = await db
    .select()
    .from(offlineSaleReviews)
    .where(and(eq(offlineSaleReviews.id, input.reviewId), isNull(offlineSaleReviews.resolvedAt)))
    .limit(1);
  if (!row) return { ok: false, code: "review_not_open" };
  if (row.saleId) return { ok: false, code: "already_posted" };

  const [cashier] = await db.select().from(users).where(eq(users.id, row.cashierId)).limit(1);
  const sale = row.payload as OfflineSale;

  try {
    const result = await postSale(db, { id: row.deviceId }, sale, row.soldAt, cashier);
    await db
      .update(offlineSaleReviews)
      .set({
        saleId: result.saleId,
        resolvedAt: new Date(),
        resolvedBy: input.actorId,
        resolutionNote: input.note,
      })
      .where(eq(offlineSaleReviews.id, row.id));
    return { ok: true, saleNumber: result.saleNumber };
  } catch (error) {
    const code = saleErrorCode(error);
    if (!code) throw error;
    return { ok: false, code };
  }
}

/** Closes a review without booking anything more. The note says what was done instead. */
export async function closeOfflineReview(
  db: Database,
  input: { reviewId: string; actorId: string; note: string },
): Promise<boolean> {
  const closed = await db
    .update(offlineSaleReviews)
    .set({ resolvedAt: new Date(), resolvedBy: input.actorId, resolutionNote: input.note })
    .where(and(eq(offlineSaleReviews.id, input.reviewId), isNull(offlineSaleReviews.resolvedAt)))
    .returning({ id: offlineSaleReviews.id });
  return closed.length > 0;
}
