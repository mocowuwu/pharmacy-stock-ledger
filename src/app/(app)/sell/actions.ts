"use server";

import { and, eq, ilike, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { batches, itemBarcodes, items } from "@/db/schema";
import { assertPermission, PermissionError } from "@/lib/dal/session";
import { createSale, type SaleLineRequest } from "@/lib/dal/sales";
import { SaleError } from "@/lib/stock/sale";
import { LedgerError } from "@/lib/stock/ledger";
import { allocateFefo } from "@/lib/stock/fefo";
import { parseScan, gtinVariants } from "@/lib/stock/gs1";

export type Candidate = {
  id: string;
  code: string;
  name: string;
  unit: string;
  drugClass: string;
  price: number;
  onHand: number;
  /** Units present but unsellable because they have expired. */
  expiredUnits: number;
  earliestExpiry: string | null;
  batches: Array<{ id: string; lotNumber: string | null; expiryDate: string; qty: number }>;
};

/**
 * Finds an item for the till, by typed text or by scan.
 *
 * Returns the sellable batches with it so the basket can show which lot is
 * about to leave -- the cashier confirms that against the box in their hand,
 * which is the point of showing it at all.
 */
export async function findForSale(query: string): Promise<Candidate[]> {
  await assertPermission("sales.create");
  const db = await getDb();

  const raw = query.trim();
  if (raw.length < 2) return [];

  // A scan is a search too: resolve the barcode to its item first.
  const scan = parseScan(raw);
  let barcodeItemId: string | null = null;
  const code = scan.kind === "gs1" ? scan.gtin : scan.kind === "plain" ? scan.code : null;
  if (code) {
    const [hit] = await db
      .select({ itemId: itemBarcodes.itemId })
      .from(itemBarcodes)
      .where(
        sql`${itemBarcodes.barcode} in ${gtinVariants(code)}`,
      )
      .limit(1);
    barcodeItemId = hit?.itemId ?? null;
  }

  const found = await db
    .select({
      id: items.id,
      code: items.code,
      genericName: items.genericName,
      brandName: items.brandName,
      strength: items.strength,
      unit: items.unit,
      drugClass: items.drugClass,
      price: items.defaultPrice,
    })
    .from(items)
    .where(
      and(
        eq(items.status, "active"),
        barcodeItemId
          ? eq(items.id, barcodeItemId)
          : or(
              ilike(items.genericName, `%${raw}%`),
              ilike(items.brandName, `%${raw}%`),
              ilike(items.code, `%${raw}%`),
            ),
      ),
    )
    .limit(8);

  const results: Candidate[] = [];
  for (const item of found) {
    const stock = await db
      .select({
        id: batches.id,
        lotNumber: batches.lotNumber,
        expiryDate: batches.expiryDate,
        qtyRemaining: batches.qtyRemaining,
        unitCost: batches.unitCost,
        status: batches.status,
      })
      .from(batches)
      .where(and(eq(batches.itemId, item.id), eq(batches.status, "active")))
      .orderBy(batches.expiryDate);

    // Asking for everything reveals both what is sellable and what is stuck
    // behind an expiry date, which are different problems at the counter.
    const probe = allocateFefo(stock, Number.MAX_SAFE_INTEGER);
    const onHand = probe.allocations.reduce((sum, a) => sum + a.qty, 0);

    results.push({
      id: item.id,
      code: item.code,
      name: `${item.genericName}${item.strength ? ` ${item.strength}` : ""}${
        item.brandName ? ` (${item.brandName})` : ""
      }`,
      unit: item.unit,
      drugClass: item.drugClass,
      price: item.price,
      onHand,
      expiredUnits: probe.blockedByExpiry,
      earliestExpiry: probe.allocations[0]?.expiryDate ?? null,
      batches: probe.allocations.map((a) => ({
        id: a.batchId,
        lotNumber: a.lotNumber,
        expiryDate: a.expiryDate,
        qty: a.qty,
      })),
    });
  }

  return results;
}

export type CheckoutState = {
  error?: string;
  detail?: Record<string, unknown>;
  done?: { saleId: string; saleNumber: string; total: number; change: number | null };
};

export async function checkout(input: {
  lines: SaleLineRequest[];
  paymentMethod: "tunai" | "kartu_debit" | "kartu_kredit" | "qris" | "transfer" | "lainnya";
  discount: number;
  tendered: number | null;
}): Promise<CheckoutState> {
  try {
    const result = await createSale({
      lines: input.lines,
      paymentMethod: input.paymentMethod,
      discount: input.discount,
      tendered: input.tendered,
    });
    revalidatePath("/sell");
    revalidatePath("/items");
    revalidatePath("/sales");
    return {
      done: {
        saleId: result.saleId,
        saleNumber: result.saleNumber,
        total: result.total,
        change: result.change,
      },
    };
  } catch (error) {
    if (error instanceof PermissionError) return { error: "not_allowed" };
    if (error instanceof SaleError) {
      return { error: error.code, detail: error.detail };
    }
    if (error instanceof LedgerError) return { error: error.code };
    console.error(error);
    return { error: "unknown" };
  }
}
