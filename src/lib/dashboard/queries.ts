import { and, eq, gt, inArray, lte, ne, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { alerts, batches, items, returns, sales } from "@/db/schema";
import { addDays, daysBetween } from "@/lib/format/date";
import type { AlertRules, Thresholds } from "@/lib/alerts/rules";

/**
 * What the dashboard reads that no report already answers.
 *
 * Session-free and taking an executor, like `src/lib/reports/queries.ts`:
 * `src/lib/dal/dashboard.ts` adds the permission checks. Nothing in here
 * carries a cost price, which is what lets the stock widgets sit behind
 * `alerts.view` rather than `reports.financial`.
 */

/* ------------------------------------------------------------- the till */

export type TillTakings = { gross: number; refunds: number; net: number; count: number };

/**
 * What the till took on one day in the pharmacy's timezone, refunds off.
 *
 * `until` stops the clock part-way through the day, which is how today at
 * 10.00 is compared with yesterday at 10.00 rather than with the whole of
 * yesterday -- against a full day, every morning looks like a collapse.
 */
export async function tillTakingsOn(
  tx: Database,
  options: { day: string; timezone: string; until?: Date },
): Promise<TillTakings> {
  const { day, timezone, until } = options;

  const [sold] = await tx
    .select({
      total: sql<number>`coalesce(sum(${sales.total}), 0)::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(sales)
    .where(
      and(
        // A voided sale never happened as far as the money is concerned.
        eq(sales.status, "completed"),
        sql`(${sales.soldAt} at time zone ${timezone})::date = ${day}::date`,
        until ? lte(sales.soldAt, until) : undefined,
      ),
    );

  const [refunded] = await tx
    .select({ total: sql<number>`coalesce(sum(${returns.refundTotal}), 0)::bigint` })
    .from(returns)
    .where(
      and(
        sql`(${returns.returnedAt} at time zone ${timezone})::date = ${day}::date`,
        until ? lte(returns.returnedAt, until) : undefined,
      ),
    );

  const gross = Number(sold?.total ?? 0);
  const refunds = Number(refunded?.total ?? 0);
  return { gross, refunds, net: gross - refunds, count: sold?.count ?? 0 };
}

/* ------------------------------------------------------ expiry calendar */

export type ExpiryBand = "expired" | "urgent" | "notice" | "later";

export type ExpiryMonth = {
  /** `YYYY-MM`, or `expired` for everything already past its date. */
  key: string;
  batches: Record<ExpiryBand, number>;
  units: number;
};

export type ExpiryCalendar = {
  /** The already-expired column first, then one per month from this one. */
  months: ExpiryMonth[];
  /** Batches dated after the last month shown. */
  beyond: { batches: number; units: number };
  /** The windows the bands were cut at, 0 where that rule is switched off. */
  windows: { urgent: number; notice: number };
};

/**
 * The band a batch falls in, by the pharmacy's own rules. A switched-off rule
 * hands its batches to the next band out, exactly as `computeAlerts` does.
 */
export function expiryBand(
  daysLeft: number,
  windows: { urgent: number; notice: number },
): ExpiryBand {
  if (daysLeft < 0) return "expired";
  if (windows.urgent > 0 && daysLeft <= windows.urgent) return "urgent";
  if (windows.notice > 0 && daysLeft <= windows.notice) return "notice";
  return "later";
}

/**
 * Batches still holding stock, by the month they expire in.
 *
 * Counted in batches, not units: a batch is one thing somebody has to pull
 * off a shelf, and a count of them adds up across tablets and bottles in a way
 * units never do. The units ride along for the tooltip.
 *
 * The same stock the alert rules look at -- anything not disposed or
 * depleted, of items still in the catalogue -- so the calendar and the alert
 * list cannot disagree about what is on the shelf.
 */
export async function expiryCalendar(
  tx: Database,
  options: {
    on: string;
    months?: number;
    thresholds: Pick<Thresholds, "expiringUrgentDays" | "expiringNoticeDays">;
    rules: Pick<AlertRules, "expiring_urgent" | "expiring_notice">;
  },
): Promise<ExpiryCalendar> {
  const { on } = options;
  const count = options.months ?? 12;
  const windows = {
    urgent: options.rules.expiring_urgent.enabled ? options.thresholds.expiringUrgentDays : 0,
    notice: options.rules.expiring_notice.enabled ? options.thresholds.expiringNoticeDays : 0,
  };

  const rows = await tx
    .select({
      expiryDate: batches.expiryDate,
      batches: sql<number>`count(*)::int`,
      units: sql<number>`coalesce(sum(${batches.qtyRemaining}), 0)::int`,
    })
    .from(batches)
    .innerJoin(items, eq(items.id, batches.itemId))
    .where(
      and(
        gt(batches.qtyRemaining, 0),
        inArray(batches.status, ["active", "quarantined", "expired"]),
        eq(items.status, "active"),
      ),
    )
    .groupBy(batches.expiryDate);

  const empty = (): Record<ExpiryBand, number> => ({ expired: 0, urgent: 0, notice: 0, later: 0 });
  const expired: ExpiryMonth = { key: "expired", batches: empty(), units: 0 };
  const months: ExpiryMonth[] = [];
  let year = Number(on.slice(0, 4));
  let month = Number(on.slice(5, 7));
  for (let i = 0; i < count; i++) {
    months.push({ key: `${year}-${String(month).padStart(2, "0")}`, batches: empty(), units: 0 });
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  const byKey = new Map(months.map((entry) => [entry.key, entry]));
  const beyond = { batches: 0, units: 0 };

  for (const row of rows) {
    const band = expiryBand(daysBetween(on, row.expiryDate), windows);
    if (band === "expired") {
      expired.batches.expired += row.batches;
      expired.units += row.units;
      continue;
    }
    const hit = byKey.get(row.expiryDate.slice(0, 7));
    if (!hit) {
      beyond.batches += row.batches;
      beyond.units += row.units;
      continue;
    }
    hit.batches[band] += row.batches;
    hit.units += row.units;
  }

  return { months: [expired, ...months], beyond, windows };
}

/* ---------------------------------------------------------- stock health */

export type StockHealth = { items: number; out: number; low: number; healthy: number };

/**
 * How much of the catalogue is in trouble, read off the alert list itself.
 *
 * Deliberately not a second calculation of "low": the pharmacy's rules decide
 * that (a minimum, a default minimum, days of cover), the alert job applies
 * them, and this counts what the job found. Two definitions of low on one
 * screen would be worse than either. A snoozed or acknowledged alert still
 * counts -- the shelf is no fuller for having been snoozed.
 */
export async function stockHealth(tx: Database): Promise<StockHealth> {
  const [catalogue] = await tx
    .select({ items: sql<number>`count(*)::int` })
    .from(items)
    .where(eq(items.status, "active"));

  const flagged = await tx
    .select({ type: alerts.type, items: sql<number>`count(distinct ${alerts.itemId})::int` })
    .from(alerts)
    .innerJoin(items, eq(items.id, alerts.itemId))
    .where(
      and(
        ne(alerts.status, "resolved"),
        inArray(alerts.type, ["out_of_stock", "low_stock"]),
        eq(items.status, "active"),
      ),
    )
    .groupBy(alerts.type);

  const total = catalogue?.items ?? 0;
  const out = flagged.find((row) => row.type === "out_of_stock")?.items ?? 0;
  const low = flagged.find((row) => row.type === "low_stock")?.items ?? 0;
  return { items: total, out, low, healthy: Math.max(0, total - out - low) };
}

/** The window the dashboard's "last 30 days" widgets share, ending today. */
export function trailingRange(on: string, days: number): { from: string; to: string } {
  return { from: addDays(on, -(days - 1)), to: on };
}
