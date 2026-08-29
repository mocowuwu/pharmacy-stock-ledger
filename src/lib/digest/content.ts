import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { alerts, batches, disposals, items, returns, sales } from "@/db/schema";
import { addDays } from "@/lib/format/date";

/**
 * What goes in the morning email.
 *
 * The rule for what belongs here: **only what the owner would act on before
 * opening.** A digest that lists everything is deleted unread within a week,
 * and then the one morning it mattered it is deleted too. So it carries
 * yesterday's trade in three numbers, anything critical still standing, and
 * what is about to expire -- and it says so plainly when there is nothing to
 * report, rather than padding.
 *
 * Session-free and taking an executor, like the rest of `src/lib/*`, so the
 * whole thing can be rendered in a test without a mail server.
 */

export type DigestData = {
  /** The day being reported on -- yesterday, in the pharmacy's timezone. */
  on: string;
  business: string;
  takings: { net: number; gross: number; refunds: number; sales: number };
  critical: Array<{ type: string; itemName: string; detail: string }>;
  expiring: Array<{ itemName: string; lotNumber: string | null; expiryDate: string; qty: number }>;
  outOfStock: Array<{ itemName: string; code: string }>;
  disposed: { count: number; value: number };
  /** True when there is genuinely nothing worth an email. */
  quiet: boolean;
};

export async function buildDigest(
  tx: Database,
  options: { on: string; timezone: string; business: string; expiringDays?: number },
): Promise<DigestData> {
  const { on, timezone } = options;
  const day = (column: unknown) =>
    sql`((${column} at time zone ${timezone})::date)`;

  const [sold] = await tx
    .select({
      total: sql<number>`coalesce(sum(${sales.total}), 0)::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(sales)
    .where(
      and(
        eq(sales.status, "completed"),
        sql`${day(sql`${sales.soldAt}`)} = ${on}`,
      ),
    );

  const [refunded] = await tx
    .select({ total: sql<number>`coalesce(sum(${returns.refundTotal}), 0)::bigint` })
    .from(returns)
    .where(sql`${day(sql`${returns.returnedAt}`)} = ${on}`);

  const [written] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      value: sql<number>`coalesce(sum(${disposals.costValue}), 0)::bigint`,
    })
    .from(disposals)
    .where(sql`${day(sql`${disposals.disposedAt}`)} = ${on}`);

  // Critical alerts, minus out-of-stock, which gets its own section below.
  // Listing the same seven items twice makes the email longer without making
  // it say more -- and a warning that has been on screen for three weeks is
  // not news either, which is why nothing below critical appears at all.
  const criticalRows = await tx
    .select({
      type: alerts.type,
      itemName: items.genericName,
      strength: items.strength,
      lotNumber: batches.lotNumber,
      expiryDate: batches.expiryDate,
      qty: batches.qtyRemaining,
    })
    .from(alerts)
    .innerJoin(items, eq(items.id, alerts.itemId))
    .leftJoin(batches, eq(batches.id, alerts.batchId))
    .where(
      and(
        eq(alerts.severity, "critical"),
        sql`${alerts.status} <> 'resolved'`,
        sql`${alerts.type} <> 'out_of_stock'`,
      ),
    )
    .orderBy(alerts.firstSeenAt)
    .limit(20);

  const expiringWithin = addDays(on, options.expiringDays ?? 30);
  const expiring = await tx
    .select({
      itemName: items.genericName,
      strength: items.strength,
      lotNumber: batches.lotNumber,
      expiryDate: batches.expiryDate,
      qty: batches.qtyRemaining,
    })
    .from(batches)
    .innerJoin(items, eq(items.id, batches.itemId))
    .where(
      and(
        eq(batches.status, "active"),
        sql`${batches.qtyRemaining} > 0`,
        sql`${batches.expiryDate} > ${on}`,
        sql`${batches.expiryDate} <= ${expiringWithin}`,
      ),
    )
    .orderBy(batches.expiryDate)
    .limit(15);

  const outOfStock = await tx
    .select({ itemName: items.genericName, code: items.code, strength: items.strength })
    .from(items)
    .innerJoin(alerts, eq(alerts.itemId, items.id))
    .where(and(eq(alerts.type, "out_of_stock"), sql`${alerts.status} <> 'resolved'`))
    .limit(20);

  const name = (row: { itemName: string; strength?: string | null }) =>
    `${row.itemName}${row.strength ? ` ${row.strength}` : ""}`;

  const gross = Number(sold?.total ?? 0);
  const refunds = Number(refunded?.total ?? 0);

  const data: DigestData = {
    on,
    business: options.business,
    takings: {
      gross,
      refunds,
      net: gross - refunds,
      sales: sold?.count ?? 0,
    },
    critical: criticalRows.map((row) => ({
      type: row.type,
      itemName: name(row),
      detail: row.lotNumber
        ? `${row.lotNumber} · ${row.expiryDate ?? ""} · ${row.qty ?? 0}`
        : "",
    })),
    expiring: expiring.map((row) => ({
      itemName: name(row),
      lotNumber: row.lotNumber,
      expiryDate: row.expiryDate,
      qty: row.qty,
    })),
    outOfStock: outOfStock.map((row) => ({ itemName: name(row), code: row.code })),
    disposed: { count: written?.count ?? 0, value: Number(written?.value ?? 0) },
    quiet: false,
  };

  data.quiet =
    data.critical.length === 0 &&
    data.expiring.length === 0 &&
    data.outOfStock.length === 0 &&
    data.takings.sales === 0;

  return data;
}
