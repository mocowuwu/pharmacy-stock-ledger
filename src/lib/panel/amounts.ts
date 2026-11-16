import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { panelEntries } from "@/db/schema";

/**
 * What a Panel entry is worth, and when it counts -- said once.
 *
 * The Panel screen, the sales and profit reports, the dashboard and the daily
 * digest all add up the same entries. Each writing its own idea of "counts" or
 * of the PPN on a line is how a screen ends up a rupiah off the report beside
 * it, so they all read these.
 *
 * - **Counts:** approved, and not voided. A pending entry has not been agreed by
 *   anyone above the person who wrote it; a rejected one never will be; a voided
 *   one never happened. None of them is money yet, or ever.
 * - **The line** is what the order was priced at: quantity times unit price.
 * - **PPN on top** is added to what the doctor pays (`exclusive` orders);
 *   **PPN inside** is already in the price (`inclusive`) and comes out of net
 *   sales. Both are the snapshot stored on the entry, never recomputed.
 * - **Paid** is what changed hands: the line, plus PPN where it sits on top.
 *   That is the figure a till sale's `total` corresponds to.
 */
export const panelCounts = and(eq(panelEntries.status, "approved"), isNull(panelEntries.voidedAt));

export const panelLine = sql`(${panelEntries.qty} * ${panelEntries.unitPrice})`;

export const panelTaxOnTop = sql`(case when ${panelEntries.taxMode} = 'exclusive' then ${panelEntries.taxAmount} else 0 end)`;

export const panelTaxInside = sql`(case when ${panelEntries.taxMode} = 'inclusive' then ${panelEntries.taxAmount} else 0 end)`;

export const panelPaid = sql`(${panelLine} + ${panelTaxOnTop})`;

/** An entry's own arithmetic, for code that already holds the row. */
export function panelAmounts(entry: {
  qty: number;
  unitPrice: number;
  taxMode: "inclusive" | "exclusive" | null;
  taxAmount: number;
}) {
  const line = entry.qty * entry.unitPrice;
  const onTop = entry.taxMode === "exclusive" ? entry.taxAmount : 0;
  const inside = entry.taxMode === "inclusive" ? entry.taxAmount : 0;
  return { line, taxOnTop: onTop, taxInside: inside, paid: line + onTop, net: line - inside };
}

/**
 * What the Panel took in on each day of a window, for the dashboard and the
 * digest. A day is the plain date the pharmacist gave the order -- there is no
 * clock on it -- so no timezone arithmetic is needed or wanted here.
 */
export async function panelTakingsByDay(
  tx: Database,
  from: string,
  to: string,
): Promise<Map<string, { paid: number; entries: number }>> {
  const rows = await tx
    .select({
      day: sql<string>`${panelEntries.entryDate}::text`,
      paid: sql<string>`coalesce(sum(${panelPaid}), 0)`,
      entries: sql<number>`count(*)::int`,
    })
    .from(panelEntries)
    .where(and(panelCounts, sql`${panelEntries.entryDate} between ${from} and ${to}`))
    .groupBy(panelEntries.entryDate);

  return new Map(rows.map((row) => [row.day, { paid: Number(row.paid), entries: row.entries }]));
}
