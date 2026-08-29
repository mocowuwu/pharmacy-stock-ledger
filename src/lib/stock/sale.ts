import { and, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  batches,
  items,
  returns,
  sales,
  saleLines,
  settings,
  taxRates,
} from "@/db/schema";
import { applyMovement } from "./ledger";
import { lockNumberSeries } from "./numbering";
import { allocateFefo, isOverride } from "./fefo";
import { applyRateBps, splitInclusiveTax } from "@/lib/format/money";
import { today } from "@/lib/format/date";
import { RESTRICTED_DRUG_CLASSES } from "@/lib/catalogue/enums";

/**
 * The sale transaction.
 *
 * Kept free of sessions and permissions -- those belong to the data access
 * layer above -- so the part that actually moves stock and money can be tested
 * directly. No `server-only` guard, for the same reason the ledger has none.
 */

export type SaleLineRequest = {
  itemId: string;
  qty: number;
  unitPrice: number;
  preferBatchId?: string | null;
  overrideReason?: string | null;
};

export type CommitSaleRequest = {
  actorId: string;
  actorIsPharmacist?: boolean;
  lines: SaleLineRequest[];
  paymentMethod: "tunai" | "kartu_debit" | "kartu_kredit" | "qris" | "transfer" | "lainnya";
  discount?: number;
  tendered?: number | null;
  notes?: string | null;
};

export class SaleError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "SaleError";
  }
}

async function activeTax(tx: Database, on: string) {
  const [config] = await tx.select().from(settings).where(eq(settings.id, 1));
  if (!config?.taxEnabled) return null;

  const [rate] = await tx
    .select()
    .from(taxRates)
    .where(
      and(
        lte(taxRates.effectiveFrom, on),
        or(isNull(taxRates.effectiveTo), gte(taxRates.effectiveTo, on)),
      ),
    )
    .orderBy(desc(taxRates.effectiveFrom))
    .limit(1);

  return rate ? { rate, mode: config.taxMode } : null;
}

/**
 * Sequential and never reused.
 *
 * Serialised on the day's series: without that, two simultaneous sales build
 * the same number and the unique index refuses one of them, which reaches the
 * cashier as a failed sale rather than as a queue.
 */
export async function nextSaleNumber(tx: Database, on: string): Promise<string> {
  await lockNumberSeries(tx, "sale", on);
  const prefix = on.replaceAll("-", "").slice(2); // YYMMDD
  const [last] = await tx
    .select({ number: sales.saleNumber })
    .from(sales)
    .where(sql`${sales.saleNumber} like ${`${prefix}-%`}`)
    .orderBy(desc(sales.saleNumber))
    .limit(1);

  const seq = last ? Number(last.number.split("-")[1]) + 1 : 1;
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

/**
 * Rings up a sale inside the caller's transaction.
 *
 * Every line is allocated before anything is written, so a shortfall on the
 * last line cannot leave earlier lines half-committed. Batches are locked for
 * the duration: two tills reaching for the last box produce one sale and one
 * clear refusal, never a negative quantity.
 */
export async function commitSale(tx: Database, request: CommitSaleRequest) {
  if (request.lines.length === 0) throw new SaleError("empty_sale");

  const saleDate = today();
  const tax = await activeTax(tx, saleDate);
  let needsPharmacist = false;

  const planned: Array<{
    line: SaleLineRequest;
    item: { isTaxExempt: boolean; name: string };
    allocations: ReturnType<typeof allocateFefo>["allocations"];
    overrode: boolean;
  }> = [];

  for (const line of request.lines) {
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      throw new SaleError("invalid_quantity");
    }
    if (line.unitPrice < 0) throw new SaleError("invalid_price");

    const [item] = await tx
      .select({
        drugClass: items.drugClass,
        isTaxExempt: items.isTaxExempt,
        genericName: items.genericName,
        strength: items.strength,
        status: items.status,
      })
      .from(items)
      .where(eq(items.id, line.itemId))
      .limit(1);
    if (!item) throw new SaleError("item_not_found");
    if (item.status !== "active") throw new SaleError("item_archived");

    const available = await tx
      .select({
        id: batches.id,
        lotNumber: batches.lotNumber,
        expiryDate: batches.expiryDate,
        qtyRemaining: batches.qtyRemaining,
        unitCost: batches.unitCost,
        status: batches.status,
      })
      .from(batches)
      .where(and(eq(batches.itemId, line.itemId), eq(batches.status, "active")))
      .for("update");

    const result = allocateFefo(available, line.qty, {
      preferBatchId: line.preferBatchId ?? undefined,
    });

    if (result.shortfall > 0) {
      throw new SaleError("insufficient_stock", {
        item: item.genericName,
        short: result.shortfall,
        blockedByExpiry: result.blockedByExpiry,
      });
    }

    const overrode = isOverride(available, result.allocations);
    if (overrode && !line.overrideReason?.trim()) {
      throw new SaleError("override_reason_required", { item: item.genericName });
    }

    if ((RESTRICTED_DRUG_CLASSES as readonly string[]).includes(item.drugClass)) {
      needsPharmacist = true;
    }

    planned.push({
      line,
      item: {
        isTaxExempt: item.isTaxExempt,
        name: `${item.genericName}${item.strength ? ` ${item.strength}` : ""}`,
      },
      allocations: result.allocations,
      overrode,
    });
  }

  const subtotal = planned.reduce((sum, p) => sum + p.line.qty * p.line.unitPrice, 0);
  const discount = Math.min(Math.max(request.discount ?? 0, 0), subtotal);
  const net = subtotal - discount;

  let taxAmount = 0;
  let total = net;
  if (tax) {
    const taxable = planned
      .filter((p) => !p.item.isTaxExempt)
      .reduce((sum, p) => sum + p.line.qty * p.line.unitPrice, 0);
    // A discount reduces the taxable portion in the same proportion it reduces
    // the sale, so the two never drift apart.
    const taxableAfterDiscount =
      subtotal === 0 ? 0 : Math.round((taxable * net) / subtotal);

    if (tax.mode === "inclusive") {
      taxAmount = splitInclusiveTax(taxableAfterDiscount, tax.rate.rateBps).tax;
      total = net;
    } else {
      taxAmount = applyRateBps(taxableAfterDiscount, tax.rate.rateBps);
      total = net + taxAmount;
    }
  }

  // Numbered here rather than at the top: everything above can run
  // concurrently, and only this moment needs to be single-file.
  const saleNumber = await nextSaleNumber(tx, saleDate);

  const [sale] = await tx
    .insert(sales)
    .values({
      saleNumber,
      cashierId: request.actorId,
      pharmacistId:
        needsPharmacist && request.actorIsPharmacist ? request.actorId : null,
      subtotal,
      discount,
      taxAmount,
      total,
      taxRateId: tax?.rate.id ?? null,
      taxMode: tax?.mode ?? null,
      taxRateBps: tax?.rate.rateBps ?? null,
      paymentMethod: request.paymentMethod,
      tendered: request.tendered ?? null,
      changeGiven:
        request.tendered != null ? Math.max(request.tendered - total, 0) : null,
      notes: request.notes ?? null,
    })
    .returning();

  for (const plan of planned) {
    for (const allocation of plan.allocations) {
      await tx.insert(saleLines).values({
        saleId: sale.id,
        itemId: plan.line.itemId,
        batchId: allocation.batchId,
        qty: allocation.qty,
        unitPrice: plan.line.unitPrice,
        lineTotal: allocation.qty * plan.line.unitPrice,
        // Copied now: without it, last month's margin changes when this
        // month's delivery costs more.
        unitCostSnapshot: allocation.unitCost,
        taxExempt: plan.item.isTaxExempt,
        fefoOverrideReason: plan.overrode ? plan.line.overrideReason ?? null : null,
      });

      // The ledger refuses expired stock here, so no screen or API path can
      // route around the rule.
      await applyMovement(tx, {
        batchId: allocation.batchId,
        type: "sale",
        qtyDelta: -allocation.qty,
        performedBy: request.actorId,
        refType: "sales",
        refId: sale.id,
        reason: plan.overrode ? plan.line.overrideReason ?? null : null,
      });
    }
  }

  return {
    saleId: sale.id,
    saleNumber,
    subtotal,
    discount,
    taxAmount,
    total,
    change: sale.changeGiven,
  };
}

/**
 * Reverses a sale, returning each unit to the batch it came from.
 *
 * A void is never a deletion: the sale and its lines stay, the reversing
 * movements say why, and a receipt printed once remains findable.
 */
export async function reverseSale(
  tx: Database,
  input: { saleId: string; actorId: string; reason: string },
) {
  if (!input.reason.trim()) throw new SaleError("reason_required");

  const [sale] = await tx
    .select()
    .from(sales)
    .where(eq(sales.id, input.saleId))
    .for("update")
    .limit(1);
  if (!sale) throw new SaleError("sale_not_found");
  if (sale.status === "voided") throw new SaleError("already_voided");

  // A void puts every unit back in the batch it came from. If part of the sale
  // has already been returned, those units are back in stock once already --
  // voiding on top of that would book the same medicine in twice.
  const [returned] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(returns)
    .where(eq(returns.saleId, input.saleId));
  if ((returned?.count ?? 0) > 0) throw new SaleError("sale_has_returns");

  const lines = await tx
    .select()
    .from(saleLines)
    .where(eq(saleLines.saleId, input.saleId));

  for (const line of lines) {
    await applyMovement(tx, {
      batchId: line.batchId,
      type: "sale_void",
      qtyDelta: line.qty,
      performedBy: input.actorId,
      refType: "sales",
      refId: input.saleId,
      reason: input.reason,
    });
  }

  await tx
    .update(sales)
    .set({
      status: "voided",
      voidedBy: input.actorId,
      voidReason: input.reason,
      voidedAt: new Date(),
    })
    .where(eq(sales.id, input.saleId));

  return { saleId: input.saleId, linesReversed: lines.length, sale };
}
