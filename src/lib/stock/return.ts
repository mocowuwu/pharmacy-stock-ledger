import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  batches,
  items,
  returns,
  returnLines,
  sales,
  saleLines,
  settings,
} from "@/db/schema";
import { applyMovement } from "./ledger";
import { lockNumberSeries } from "./numbering";
import { SaleError } from "./sale";
import { isExpired, today } from "@/lib/format/date";
import { RESTRICTED_DRUG_CLASSES } from "@/lib/catalogue/enums";

/**
 * Returns.
 *
 * A return always references the original sale, so the refund is derived from
 * what was actually paid rather than from a price typed at the counter. Like
 * the sale, this module is free of sessions and permissions so it can be
 * tested directly.
 *
 * The rule that shapes everything here: **returned medicine is quarantined,
 * not restocked.** Once a box has left the counter nobody knows how it was
 * stored. It comes back as a quarantined child batch of the lot it went out
 * on, so the units are still counted and still traceable, but they are not
 * sellable. A setting may permit restocking sealed OTC and devices; the
 * restricted classes are refused in code regardless of that setting.
 */

export type ReturnLineRequest = {
  saleLineId: string;
  qty: number;
};

export type CommitReturnRequest = {
  saleId: string;
  actorId: string;
  actorIsPharmacist?: boolean;
  lines: ReturnLineRequest[];
  refundMethod:
    | "tunai"
    | "kartu_debit"
    | "kartu_kredit"
    | "qris"
    | "transfer"
    | "lainnya";
  reason: string;
  notes?: string | null;
};

/** Sequential per day and never reused, like the sale number it mirrors. */
export async function nextReturnNumber(tx: Database, on: string): Promise<string> {
  await lockNumberSeries(tx, "return", on);
  const prefix = `R${on.replaceAll("-", "").slice(2)}`; // RYYMMDD
  const [last] = await tx
    .select({ number: returns.returnNumber })
    .from(returns)
    .where(sql`${returns.returnNumber} like ${`${prefix}-%`}`)
    .orderBy(desc(returns.returnNumber))
    .limit(1);

  const seq = last ? Number(last.number.split("-")[1]) + 1 : 1;
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

/** How much of each sale line has already come back. */
export async function returnedQtyBySaleLine(
  tx: Database,
  saleId: string,
): Promise<Map<string, number>> {
  const rows = await tx
    .select({
      saleLineId: returnLines.saleLineId,
      qty: sql<number>`coalesce(sum(${returnLines.qty}), 0)::int`,
    })
    .from(returnLines)
    .innerJoin(returns, eq(returns.id, returnLines.returnId))
    .where(eq(returns.saleId, saleId))
    .groupBy(returnLines.saleLineId);

  return new Map(rows.map((r) => [r.saleLineId, r.qty]));
}

/**
 * Takes stock back and refunds what was paid for it.
 *
 * Every line is checked and priced before anything is written, for the same
 * reason `commitSale` allocates before it writes: a refusal on the last line
 * must not leave the first ones half-committed.
 */
export async function commitReturn(tx: Database, request: CommitReturnRequest) {
  if (request.lines.length === 0) throw new SaleError("empty_return");
  if (!request.reason.trim()) throw new SaleError("reason_required");

  const [sale] = await tx
    .select()
    .from(sales)
    .where(eq(sales.id, request.saleId))
    .for("update")
    .limit(1);
  if (!sale) throw new SaleError("sale_not_found");
  // A voided sale has already put every unit back in its batch. Returning
  // against it as well would book the same stock in twice.
  if (sale.status === "voided") throw new SaleError("sale_voided");

  const [config] = await tx.select().from(settings).where(eq(settings.id, 1));
  const restockAllowed = config?.allowReturnRestock ?? false;

  const requested = new Map<string, number>();
  for (const line of request.lines) {
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      throw new SaleError("invalid_quantity");
    }
    // Two entries for one sale line would each pass the cap on their own.
    requested.set(line.saleLineId, (requested.get(line.saleLineId) ?? 0) + line.qty);
  }

  const originals = await tx
    .select({
      id: saleLines.id,
      itemId: saleLines.itemId,
      batchId: saleLines.batchId,
      qty: saleLines.qty,
      unitPrice: saleLines.unitPrice,
      lineTotal: saleLines.lineTotal,
      saleId: saleLines.saleId,
      drugClass: items.drugClass,
      genericName: items.genericName,
      lotNumber: batches.lotNumber,
      expiryDate: batches.expiryDate,
      supplierId: batches.supplierId,
      unitCost: batches.unitCost,
      batchStatus: batches.status,
    })
    .from(saleLines)
    .innerJoin(items, eq(items.id, saleLines.itemId))
    .innerJoin(batches, eq(batches.id, saleLines.batchId))
    .where(inArray(saleLines.id, [...requested.keys()]));

  const byId = new Map(originals.map((o) => [o.id, o]));
  const alreadyReturned = await returnedQtyBySaleLine(tx, request.saleId);

  let needsPharmacist = false;

  const planned = [...requested.entries()].map(([saleLineId, qty]) => {
    const original = byId.get(saleLineId);
    if (!original || original.saleId !== request.saleId) {
      throw new SaleError("line_not_in_sale");
    }

    const remaining = original.qty - (alreadyReturned.get(saleLineId) ?? 0);
    if (qty > remaining) {
      throw new SaleError("return_exceeds_sold", {
        item: original.genericName,
        remaining,
      });
    }

    const restricted = (RESTRICTED_DRUG_CLASSES as readonly string[]).includes(
      original.drugClass,
    );
    if (restricted) needsPharmacist = true;

    // Restocking is refused for the restricted classes in code, so the settings
    // toggle can never put dispensed keras stock back on the shelf. Expired
    // stock is never restocked either, whatever it is.
    const restock =
      restockAllowed &&
      !restricted &&
      original.batchStatus === "active" &&
      !isExpired(original.expiryDate);

    return { original, qty, restock, refund: refundFor(original, qty) };
  });

  const refundTotal = planned.reduce((sum, p) => sum + p.refund, 0);
  const returnDate = today();
  const returnNumber = await nextReturnNumber(tx, returnDate);

  const [record] = await tx
    .insert(returns)
    .values({
      returnNumber,
      saleId: request.saleId,
      processedBy: request.actorId,
      pharmacistId:
        needsPharmacist && request.actorIsPharmacist ? request.actorId : null,
      refundTotal,
      refundMethod: request.refundMethod,
      reason: request.reason,
      notes: request.notes ?? null,
    })
    .returning();

  for (const plan of planned) {
    const targetBatchId = plan.restock
      ? plan.original.batchId
      : await quarantineBatchFor(tx, plan.original, plan.qty, request.actorId);

    await tx.insert(returnLines).values({
      returnId: record.id,
      saleLineId: plan.original.id,
      itemId: plan.original.itemId,
      qty: plan.qty,
      refundAmount: plan.refund,
      targetBatchId,
      restocked: plan.restock,
    });

    await applyMovement(tx, {
      batchId: targetBatchId,
      type: "return",
      qtyDelta: plan.qty,
      performedBy: request.actorId,
      refType: "returns",
      refId: record.id,
      reason: request.reason,
      // A quarantined batch keeps that status anyway; naming it here means the
      // intent is on the movement rather than implied by the batch row.
      setStatus: plan.restock ? null : "quarantined",
    });
  }

  return {
    returnId: record.id,
    returnNumber,
    refundTotal,
    lines: planned.length,
    restocked: planned.filter((p) => p.restock).length,
  };

  /**
   * What the customer actually paid for these units.
   *
   * Scaling by the sale's total-over-subtotal ratio carries the discount and
   * the tax through, so a half-price sale refunds half price. Refunding the
   * list price instead would hand back money that never came in.
   */
  function refundFor(original: { unitPrice: number }, qty: number) {
    const gross = qty * original.unitPrice;
    if (sale.subtotal <= 0) return gross;
    return Math.round((gross * sale.total) / sale.subtotal);
  }
}

/**
 * Creates the quarantined child batch a returned line lands in.
 *
 * It carries the parent's lot number and expiry date -- it is physically the
 * same medicine -- but it is a separate row with its own status, which is what
 * keeps it out of FEFO allocation and off the till. It is created holding
 * nothing and filled by the movement, exactly as a received batch is.
 */
async function quarantineBatchFor(
  tx: Database,
  original: {
    itemId: string;
    batchId: string;
    lotNumber: string | null;
    expiryDate: string;
    supplierId: string;
    unitCost: number;
  },
  qty: number,
  actorId: string,
): Promise<string> {
  // One quarantine batch per parent lot, rather than one per return: a second
  // box back from the same lot belongs with the first.
  const [existing] = await tx
    .select({ id: batches.id })
    .from(batches)
    .where(
      and(
        eq(batches.parentBatchId, original.batchId),
        eq(batches.status, "quarantined"),
      ),
    )
    .limit(1);

  if (existing) {
    await tx
      .update(batches)
      .set({
        qtyReceived: sql`${batches.qtyReceived} + ${qty}`,
        updatedAt: new Date(),
      })
      .where(eq(batches.id, existing.id));
    return existing.id;
  }

  const [created] = await tx
    .insert(batches)
    .values({
      itemId: original.itemId,
      lotNumber: original.lotNumber,
      expiryDate: original.expiryDate,
      supplierId: original.supplierId,
      receivedDate: today(),
      qtyReceived: qty,
      qtyRemaining: 0,
      unitCost: original.unitCost,
      status: "quarantined",
      parentBatchId: original.batchId,
      receivedBy: actorId,
    })
    .returning({ id: batches.id });

  return created.id;
}
