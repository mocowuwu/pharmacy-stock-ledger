import { asc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import { batches, items, offlineSaleReviews, saleLines, sales } from "@/db/schema";
import { can, type Grant } from "@/lib/auth/permissions";
import { commitSale, SaleError } from "@/lib/stock/sale";
import { LedgerError } from "@/lib/stock/ledger";
import type { DeviceRow } from "./devices";
import type { TillSaleRequest, TillSaleResponse } from "./contract";

/**
 * A sale the Android till rings while it can reach the server.
 *
 * This is the counter's sale, not a replay: it goes through `commitSale` now,
 * against the stock as it is now, as the cashier whose session it carries, and
 * a refusal is a refusal -- nothing has left the shop yet, so nothing goes to
 * the review list. The receipt gets the real number straight away.
 *
 * Two things the website's till does not need: the phone sells from a copy, so
 * a price that changed since the copy is refused rather than charged
 * differently from what the cashier just told the customer; and the phone may
 * lose the answer and queue the same sale offline, so the sale keeps the
 * phone's `clientId` and a second arrival is recognised.
 */

export type TillCashier = { id: string; isPharmacist: boolean; grant: Grant };

export type TillSaleOutcome =
  | { ok: true; response: TillSaleResponse; saleId: string }
  | { ok: false; code: string; detail?: Record<string, unknown> };

function errorCode(error: unknown): { code: string; detail?: Record<string, unknown> } | null {
  if (error instanceof SaleError) return { code: error.code, detail: error.detail };
  if (error instanceof LedgerError) return { code: error.code };
  return null;
}

/** The booked sale, described for the phone's receipt. */
async function describe(
  db: Database,
  saleId: string,
  status: TillSaleResponse["status"],
): Promise<TillSaleResponse> {
  const [sale] = await db.select().from(sales).where(eq(sales.id, saleId)).limit(1);
  const lines = await db
    .select({
      itemId: saleLines.itemId,
      batchId: saleLines.batchId,
      lotNumber: batches.lotNumber,
      expiryDate: batches.expiryDate,
      qty: saleLines.qty,
      unitPrice: saleLines.unitPrice,
    })
    .from(saleLines)
    .innerJoin(batches, eq(batches.id, saleLines.batchId))
    .where(eq(saleLines.saleId, saleId))
    .orderBy(asc(batches.expiryDate));
  return {
    status,
    saleNumber: sale.saleNumber,
    soldAt: sale.soldAt.toISOString(),
    subtotal: Number(sale.subtotal),
    discount: Number(sale.discount),
    taxAmount: Number(sale.taxAmount),
    taxMode: sale.taxMode ?? null,
    taxRateBps: sale.taxRateBps ?? null,
    total: Number(sale.total),
    tendered: sale.tendered == null ? null : Number(sale.tendered),
    change: sale.changeGiven == null ? null : Number(sale.changeGiven),
    lines: lines.map((l) => ({ ...l, qty: Number(l.qty), unitPrice: Number(l.unitPrice) })),
  };
}

async function bookedAs(db: Database, clientId: string): Promise<string | null> {
  const [row] = await db
    .select({ id: sales.id })
    .from(sales)
    .where(eq(sales.offlineClientId, clientId))
    .limit(1);
  return row?.id ?? null;
}

export async function bookTillSale(
  db: Database,
  device: DeviceRow,
  cashier: TillCashier,
  sale: TillSaleRequest,
): Promise<TillSaleOutcome> {
  if (device.role !== "till") return { ok: false, code: "not_till" };

  // Already here: the phone sent it, lost the answer, and sent it again.
  const existing = await bookedAs(db, sale.clientId);
  if (existing) return { ok: true, saleId: existing, response: await describe(db, existing, "duplicate") };
  // Queued offline and synced already -- it is the offline path's now.
  const [queued] = await db
    .select({ id: offlineSaleReviews.id })
    .from(offlineSaleReviews)
    .where(eq(offlineSaleReviews.clientId, sale.clientId))
    .limit(1);
  if (queued) return { ok: false, code: "already_received" };

  if (!can(cashier.grant, "sales.create")) return { ok: false, code: "forbidden" };
  if (sale.discount > 0 && !can(cashier.grant, "sales.discount")) {
    return { ok: false, code: "discount_not_allowed" };
  }

  const ids = [...new Set(sale.lines.map((l) => l.itemId))];
  const prices = ids.length
    ? await db.select({ id: items.id, price: items.defaultPrice }).from(items).where(inArray(items.id, ids))
    : [];
  const priceOf = new Map(prices.map((p) => [p.id, Number(p.price)]));
  const changed = sale.lines.filter((l) => priceOf.has(l.itemId) && priceOf.get(l.itemId) !== l.unitPrice);
  if (changed.length > 0) {
    return {
      ok: false,
      code: "price_changed",
      detail: { items: changed.map((l) => ({ itemId: l.itemId, price: priceOf.get(l.itemId) })) },
    };
  }

  try {
    const result = await db.transaction(async (tx) => {
      const booked = await commitSale(tx as unknown as Database, {
        actorId: cashier.id,
        actorIsPharmacist: cashier.isPharmacist,
        lines: sale.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, unitPrice: l.unitPrice })),
        paymentMethod: sale.paymentMethod,
        discount: sale.discount,
        tendered: sale.tendered,
        notes: sale.notes,
        app: { clientId: sale.clientId, deviceId: device.id },
      });
      // The cashier has told the customer a total. If the tax rate or mode
      // moved since the copy, the sale would book at another one: undo it.
      if (booked.total !== sale.total) {
        throw new SaleError("total_changed", { total: booked.total });
      }
      if (sale.tendered != null && sale.tendered < booked.total) {
        throw new SaleError("tendered_short", { total: booked.total });
      }
      return booked;
    });
    return { ok: true, saleId: result.saleId, response: await describe(db, result.saleId, "posted") };
  } catch (error) {
    const refused = errorCode(error);
    if (refused) return { ok: false, ...refused };
    // Two copies of the same sale arriving together: the unique index lets
    // one through, and the other is that one's duplicate.
    const raced = await bookedAs(db, sale.clientId);
    if (raced) return { ok: true, saleId: raced, response: await describe(db, raced, "duplicate") };
    throw error;
  }
}
