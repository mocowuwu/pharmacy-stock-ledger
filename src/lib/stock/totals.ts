import { applyRateBps, splitInclusiveTax } from "@/lib/format/money";

/**
 * The arithmetic of a sale: subtotal, discount, tax and total.
 *
 * One function because two places compute it -- `commitSale` on the server and
 * the Android app's offline till -- and a customer handed an offline receipt
 * must be charged exactly what the server books when the sale is replayed.
 * Two copies of this would drift the first time either was touched.
 *
 * Pure and dependency-free apart from the money helpers, so the app can bundle
 * it.
 */

export type TotalsLine = { qty: number; unitPrice: number; taxExempt: boolean };

export type TotalsTax = { mode: "inclusive" | "exclusive"; rateBps: number } | null;

export type SaleTotals = {
  subtotal: number;
  discount: number;
  taxAmount: number;
  total: number;
};

export function saleTotals(
  lines: readonly TotalsLine[],
  requestedDiscount: number,
  tax: TotalsTax,
): SaleTotals {
  const subtotal = lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
  const discount = Math.min(Math.max(requestedDiscount, 0), subtotal);
  const net = subtotal - discount;

  if (!tax) return { subtotal, discount, taxAmount: 0, total: net };

  const taxable = lines
    .filter((l) => !l.taxExempt)
    .reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
  // A discount reduces the taxable portion in the same proportion it reduces
  // the sale, so the two never drift apart.
  const taxableAfterDiscount = subtotal === 0 ? 0 : Math.round((taxable * net) / subtotal);

  if (tax.mode === "inclusive") {
    return {
      subtotal,
      discount,
      taxAmount: splitInclusiveTax(taxableAfterDiscount, tax.rateBps).tax,
      total: net,
    };
  }
  const taxAmount = applyRateBps(taxableAfterDiscount, tax.rateBps);
  return { subtotal, discount, taxAmount, total: net + taxAmount };
}
