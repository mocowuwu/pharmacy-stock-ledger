import { and, eq, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  batches,
  categories,
  disposals,
  items,
  returns,
  returnLines,
  sales,
  saleLines,
  stockCounts,
  stockMovements,
  suppliers,
  users,
} from "@/db/schema";
import { addDays, DEFAULT_TIMEZONE, today } from "@/lib/format/date";

/**
 * The reporting queries.
 *
 * Session-free and taking an executor, like `src/lib/stock/*`, so the
 * arithmetic can be tested directly against a real database rather than
 * inspected by eye. `src/lib/dal/reports.ts` adds the permission checks.
 *
 * Three rules run through all of it:
 *
 * 1. **Aggregate in SQL.** Fetching rows and summing them in a page would be
 *    slower and would quietly change as soon as a limit was hit.
 * 2. **Cost comes from `sale_lines.unit_cost_snapshot`, never from the batch.**
 *    That column exists so last month's margin does not move when this month's
 *    delivery costs more. Joining to `batches` for cost would undo it.
 * 3. **A day is a day in the pharmacy's timezone.** `soldAt` is an instant;
 *    casting it to a date in UTC would file a sale made at 06:00 in Jakarta
 *    under the previous day. Every date bucket goes through `localDate`.
 */

export type DateRange = { from: string; to: string };

export type ReportOptions = DateRange & {
  /** The pharmacy's timezone, from settings. */
  timezone?: string;
};

/** A timestamptz as a calendar date in the pharmacy's own timezone. */
function localDate(column: SQL | ReturnType<typeof sql>, timezone: string) {
  return sql`((${column} at time zone ${timezone})::date)`;
}

function soldWithin({ from, to, timezone = DEFAULT_TIMEZONE }: ReportOptions) {
  return and(
    // A voided sale never happened as far as the money is concerned. It stays
    // in the record, but it is not revenue.
    eq(sales.status, "completed"),
    sql`${localDate(sql`${sales.soldAt}`, timezone)} between ${from} and ${to}`,
  );
}

function returnedWithin({ from, to, timezone = DEFAULT_TIMEZONE }: ReportOptions) {
  return sql`${localDate(sql`${returns.returnedAt}`, timezone)} between ${from} and ${to}`;
}

/* ------------------------------------------------------------------ sales */

/**
 * The headline figures.
 *
 * Refunds are subtracted but reported separately rather than folded in
 * silently: "Rp 4.1 juta, of which Rp 90.000 went back out" is a different
 * story from "Rp 4.01 juta", and the owner should see which one they are in.
 */
export async function salesSummary(tx: Database, options: ReportOptions) {
  const [sold] = await tx
    .select({
      revenue: sql<number>`coalesce(sum(${sales.total}), 0)::bigint`,
      discount: sql<number>`coalesce(sum(${sales.discount}), 0)::bigint`,
      tax: sql<number>`coalesce(sum(${sales.taxAmount}), 0)::bigint`,
      transactions: sql<number>`count(*)::int`,
    })
    .from(sales)
    .where(soldWithin(options));

  const [refunded] = await tx
    .select({
      refunds: sql<number>`coalesce(sum(${returns.refundTotal}), 0)::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(returns)
    .where(returnedWithin(options));

  const [voided] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(sales)
    .where(
      and(
        eq(sales.status, "voided"),
        sql`${localDate(sql`${sales.soldAt}`, options.timezone ?? DEFAULT_TIMEZONE)} between ${options.from} and ${options.to}`,
      ),
    );

  const [units] = await tx
    .select({ total: sql<number>`coalesce(sum(${saleLines.qty}), 0)::int` })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .where(soldWithin(options));

  const revenue = Number(sold?.revenue ?? 0);
  const refunds = Number(refunded?.refunds ?? 0);
  const transactions = sold?.transactions ?? 0;

  return {
    revenue,
    refunds,
    net: revenue - refunds,
    discount: Number(sold?.discount ?? 0),
    tax: Number(sold?.tax ?? 0),
    transactions,
    returns: refunded?.count ?? 0,
    voided: voided?.count ?? 0,
    units: units?.total ?? 0,
    /** Rounded, because an average basket in fractional rupiah is noise. */
    averageSale: transactions > 0 ? Math.round(revenue / transactions) : 0,
  };
}

/** Revenue per day, with quiet days present as zero so a line does not slope through them. */
export async function dailyRevenue(tx: Database, options: ReportOptions) {
  const timezone = options.timezone ?? DEFAULT_TIMEZONE;
  const day = localDate(sql`${sales.soldAt}`, timezone);

  const rows = await tx
    .select({
      day: sql<string>`${day}::text`,
      total: sql<number>`coalesce(sum(${sales.total}), 0)::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(sales)
    .where(soldWithin(options))
    // By output position, not by repeating the expression: the timezone is a
    // bind parameter, and Postgres will not match `$1` in the GROUP BY against
    // `$6` in the SELECT even though they carry the same value.
    .groupBy(sql`1`);

  const byDay = new Map(
    rows.map((r) => [r.day, { total: Number(r.total), count: r.count }]),
  );

  const series: Array<{ day: string; total: number; count: number }> = [];
  for (let cursor = options.from; cursor <= options.to; cursor = addDays(cursor, 1)) {
    const hit = byDay.get(cursor);
    series.push({ day: cursor, total: hit?.total ?? 0, count: hit?.count ?? 0 });
  }
  return series;
}

/**
 * Units and revenue per item, net of what came back.
 *
 * The returned quantity is deducted here rather than reported alongside,
 * because "we sold 40 and 38 came back" is not a 40-unit line in any sense the
 * owner cares about.
 */
export async function salesByItem(tx: Database, options: ReportOptions) {
  const returnedQty = sql<number>`coalesce((
    select sum(${returnLines.qty})
    from ${returnLines}
    join ${returns} on ${returns.id} = ${returnLines.returnId}
    where ${returnLines.itemId} = ${items.id}
      and ${returnedWithin(options)}
  ), 0)::int`;

  const returnedValue = sql<number>`coalesce((
    select sum(${returnLines.refundAmount})
    from ${returnLines}
    join ${returns} on ${returns.id} = ${returnLines.returnId}
    where ${returnLines.itemId} = ${items.id}
      and ${returnedWithin(options)}
  ), 0)::bigint`;

  const rows = await tx
    .select({
      itemId: items.id,
      code: items.code,
      name: items.genericName,
      strength: items.strength,
      unit: items.unit,
      drugClass: items.drugClass,
      categoryName: categories.name,
      qtySold: sql<number>`coalesce(sum(${saleLines.qty}), 0)::int`,
      revenue: sql<number>`coalesce(sum(${saleLines.lineTotal}), 0)::bigint`,
      qtyReturned: returnedQty,
      refunded: returnedValue,
    })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .innerJoin(items, eq(items.id, saleLines.itemId))
    .leftJoin(categories, eq(categories.id, items.categoryId))
    .where(soldWithin(options))
    .groupBy(items.id, categories.name);

  return rows
    .map((row) => ({
      ...row,
      revenue: Number(row.revenue),
      refunded: Number(row.refunded),
      qtyNet: row.qtySold - row.qtyReturned,
      revenueNet: Number(row.revenue) - Number(row.refunded),
    }))
    .sort((a, b) => b.revenueNet - a.revenueNet);
}

export async function salesByCategory(tx: Database, options: ReportOptions) {
  const rows = await tx
    .select({
      categoryId: categories.id,
      name: sql<string>`coalesce(${categories.name}, '')`,
      qty: sql<number>`coalesce(sum(${saleLines.qty}), 0)::int`,
      revenue: sql<number>`coalesce(sum(${saleLines.lineTotal}), 0)::bigint`,
    })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .innerJoin(items, eq(items.id, saleLines.itemId))
    .leftJoin(categories, eq(categories.id, items.categoryId))
    .where(soldWithin(options))
    .groupBy(categories.id, categories.name);

  return rows
    .map((r) => ({ ...r, revenue: Number(r.revenue) }))
    .sort((a, b) => b.revenue - a.revenue);
}

export async function salesByCashier(tx: Database, options: ReportOptions) {
  const rows = await tx
    .select({
      cashierId: users.id,
      name: users.fullName,
      transactions: sql<number>`count(*)::int`,
      revenue: sql<number>`coalesce(sum(${sales.total}), 0)::bigint`,
    })
    .from(sales)
    .innerJoin(users, eq(users.id, sales.cashierId))
    .where(soldWithin(options))
    .groupBy(users.id);

  return rows
    .map((r) => ({ ...r, revenue: Number(r.revenue) }))
    .sort((a, b) => b.revenue - a.revenue);
}

/** How the money came in. Recorded, not reconciled -- there is no gateway. */
export async function salesByPaymentMethod(tx: Database, options: ReportOptions) {
  const rows = await tx
    .select({
      method: sales.paymentMethod,
      transactions: sql<number>`count(*)::int`,
      revenue: sql<number>`coalesce(sum(${sales.total}), 0)::bigint`,
    })
    .from(sales)
    .where(soldWithin(options))
    .groupBy(sales.paymentMethod);

  return rows
    .map((r) => ({ ...r, revenue: Number(r.revenue) }))
    .sort((a, b) => b.revenue - a.revenue);
}

/* ----------------------------------------------------------------- margin */

/**
 * Revenue against cost of goods, per item.
 *
 * Cost is `unit_cost_snapshot`, copied onto the line at the moment of sale. A
 * returned unit takes back both its revenue and its cost, so the margin on
 * what actually stayed sold is what appears.
 */
export async function marginByItem(tx: Database, options: ReportOptions) {
  const returnedQty = sql<number>`coalesce((
    select sum(${returnLines.qty})
    from ${returnLines}
    join ${returns} on ${returns.id} = ${returnLines.returnId}
    where ${returnLines.itemId} = ${items.id}
      and ${returnedWithin(options)}
  ), 0)::int`;

  const returnedValue = sql<number>`coalesce((
    select sum(${returnLines.refundAmount})
    from ${returnLines}
    join ${returns} on ${returns.id} = ${returnLines.returnId}
    where ${returnLines.itemId} = ${items.id}
      and ${returnedWithin(options)}
  ), 0)::bigint`;

  /** Cost of the returned units, at the snapshot on the line they came from. */
  const returnedCost = sql<number>`coalesce((
    select sum(${returnLines.qty} * rl_line.unit_cost_snapshot)
    from ${returnLines}
    join ${returns} on ${returns.id} = ${returnLines.returnId}
    join ${saleLines} as rl_line on rl_line.id = ${returnLines.saleLineId}
    where ${returnLines.itemId} = ${items.id}
      and ${returnedWithin(options)}
  ), 0)::bigint`;

  const rows = await tx
    .select({
      itemId: items.id,
      code: items.code,
      name: items.genericName,
      strength: items.strength,
      unit: items.unit,
      categoryName: categories.name,
      qtySold: sql<number>`coalesce(sum(${saleLines.qty}), 0)::int`,
      revenue: sql<number>`coalesce(sum(${saleLines.lineTotal}), 0)::bigint`,
      cost: sql<number>`coalesce(sum(${saleLines.qty} * ${saleLines.unitCostSnapshot}), 0)::bigint`,
      qtyReturned: returnedQty,
      refunded: returnedValue,
      costReturned: returnedCost,
    })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .innerJoin(items, eq(items.id, saleLines.itemId))
    .leftJoin(categories, eq(categories.id, items.categoryId))
    .where(soldWithin(options))
    .groupBy(items.id, categories.name);

  return rows
    .map((row) => {
      const revenue = Number(row.revenue) - Number(row.refunded);
      const cost = Number(row.cost) - Number(row.costReturned);
      const margin = revenue - cost;
      return {
        ...row,
        qtyNet: row.qtySold - row.qtyReturned,
        revenue,
        cost,
        margin,
        // Basis points, so no float ever reaches a stored or compared figure.
        marginBps: revenue > 0 ? Math.round((margin / revenue) * 10_000) : 0,
      };
    })
    .sort((a, b) => b.margin - a.margin);
}

export async function marginSummary(tx: Database, options: ReportOptions) {
  const rows = await marginByItem(tx, options);
  const revenue = rows.reduce((sum, r) => sum + r.revenue, 0);
  const cost = rows.reduce((sum, r) => sum + r.cost, 0);
  const margin = revenue - cost;
  return {
    revenue,
    cost,
    margin,
    marginBps: revenue > 0 ? Math.round((margin / revenue) * 10_000) : 0,
    items: rows.length,
  };
}

/* -------------------------------------------------------------- valuation */

/**
 * What is on the shelf, at what it cost.
 *
 * A point in time -- now -- not a range. A valuation for a past date would mean
 * replaying the ledger to reconstruct every batch's quantity on that day, which
 * is a real feature rather than a free one. The screen says so rather than
 * implying a date range applies.
 */
export async function valuationByCategory(tx: Database) {
  const rows = await tx
    .select({
      categoryId: categories.id,
      name: sql<string>`coalesce(${categories.name}, '')`,
      batches: sql<number>`count(distinct ${batches.id})::int`,
      units: sql<number>`coalesce(sum(${batches.qtyRemaining}), 0)::int`,
      value: sql<number>`coalesce(sum(${batches.qtyRemaining} * ${batches.unitCost}), 0)::bigint`,
    })
    .from(batches)
    .innerJoin(items, eq(items.id, batches.itemId))
    .leftJoin(categories, eq(categories.id, items.categoryId))
    .where(and(eq(batches.status, "active"), sql`${batches.qtyRemaining} > 0`))
    .groupBy(categories.id, categories.name);

  return rows
    .map((r) => ({ ...r, value: Number(r.value) }))
    .sort((a, b) => b.value - a.value);
}

export type ExpiryHorizon = "expired" | "within30" | "within90" | "within180" | "beyond";

/**
 * The same money, arranged by how long there is to sell it.
 *
 * This is the valuation figure that actually informs a decision: stock worth
 * millions is worth less if a quarter of it turns in six weeks. Quarantined and
 * expired batches are included -- the money is still tied up in them -- and the
 * `expired` bucket is the write-off waiting to happen.
 */
export async function valuationByExpiry(tx: Database, on: string = today()) {
  const rows = await tx
    .select({
      expiryDate: batches.expiryDate,
      status: batches.status,
      units: sql<number>`coalesce(sum(${batches.qtyRemaining}), 0)::int`,
      value: sql<number>`coalesce(sum(${batches.qtyRemaining} * ${batches.unitCost}), 0)::bigint`,
    })
    .from(batches)
    .where(
      and(
        sql`${batches.qtyRemaining} > 0`,
        sql`${batches.status} in ('active', 'quarantined', 'expired')`,
      ),
    )
    .groupBy(batches.expiryDate, batches.status);

  const buckets: Record<ExpiryHorizon, { units: number; value: number }> = {
    expired: { units: 0, value: 0 },
    within30: { units: 0, value: 0 },
    within90: { units: 0, value: 0 },
    within180: { units: 0, value: 0 },
    beyond: { units: 0, value: 0 },
  };

  for (const row of rows) {
    const key: ExpiryHorizon =
      row.expiryDate < on
        ? "expired"
        : row.expiryDate <= addDays(on, 30)
          ? "within30"
          : row.expiryDate <= addDays(on, 90)
            ? "within90"
            : row.expiryDate <= addDays(on, 180)
              ? "within180"
              : "beyond";

    buckets[key].units += row.units;
    buckets[key].value += Number(row.value);
  }

  return buckets;
}

/* ------------------------------------------------------------ expiry loss */

/** Everything written off in the window, most costly first. */
export async function expiryLoss(tx: Database, options: ReportOptions) {
  const timezone = options.timezone ?? DEFAULT_TIMEZONE;
  const disposedOn = localDate(sql`${disposals.disposedAt}`, timezone);

  const rows = await tx
    .select({
      itemId: items.id,
      code: items.code,
      name: items.genericName,
      strength: items.strength,
      unit: items.unit,
      categoryName: categories.name,
      qty: sql<number>`coalesce(sum(${disposals.qty}), 0)::int`,
      value: sql<number>`coalesce(sum(${disposals.costValue}), 0)::bigint`,
      events: sql<number>`count(*)::int`,
    })
    .from(disposals)
    .innerJoin(batches, eq(batches.id, disposals.batchId))
    .innerJoin(items, eq(items.id, batches.itemId))
    .leftJoin(categories, eq(categories.id, items.categoryId))
    .where(sql`${disposedOn} between ${options.from} and ${options.to}`)
    .groupBy(items.id, categories.name);

  return rows
    .map((r) => ({ ...r, value: Number(r.value) }))
    .sort((a, b) => b.value - a.value);
}

/** Write-offs by month, for the trend that says whether ordering is improving. */
export async function expiryLossByMonth(tx: Database, options: ReportOptions) {
  const timezone = options.timezone ?? DEFAULT_TIMEZONE;
  const disposedOn = localDate(sql`${disposals.disposedAt}`, timezone);
  const month = sql`to_char(${disposedOn}, 'YYYY-MM')`;

  const rows = await tx
    .select({
      month: sql<string>`${month}`,
      qty: sql<number>`coalesce(sum(${disposals.qty}), 0)::int`,
      value: sql<number>`coalesce(sum(${disposals.costValue}), 0)::bigint`,
    })
    .from(disposals)
    .where(sql`${disposedOn} between ${options.from} and ${options.to}`)
    .groupBy(sql`1`);

  return rows
    .map((r) => ({ ...r, value: Number(r.value) }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

/** The stated reasons, which is what tells expiry apart from breakage. */
export async function disposalReasons(tx: Database, options: ReportOptions) {
  const timezone = options.timezone ?? DEFAULT_TIMEZONE;
  const disposedOn = localDate(sql`${disposals.disposedAt}`, timezone);

  const rows = await tx
    .select({
      reason: disposals.reason,
      events: sql<number>`count(*)::int`,
      qty: sql<number>`coalesce(sum(${disposals.qty}), 0)::int`,
      value: sql<number>`coalesce(sum(${disposals.costValue}), 0)::bigint`,
    })
    .from(disposals)
    .where(sql`${disposedOn} between ${options.from} and ${options.to}`)
    .groupBy(disposals.reason);

  return rows
    .map((r) => ({ ...r, value: Number(r.value) }))
    .sort((a, b) => b.value - a.value);
}

/* -------------------------------------------------------------- suppliers */

/**
 * What each supplier delivered, and how much of it was thrown away.
 *
 * The disposal rate is the column worth having. A supplier whose stock is
 * cheap but arrives three months from expiry costs more than one whose stock is
 * dearer and sells through, and nothing else in the system would show that.
 *
 * Write-offs are counted against the batch's supplier whenever the disposal
 * happened, not only within the window, because stock received in March and
 * binned in September is still March's delivery that went bad.
 *
 * Derived batches are excluded. A quarantined return carries the supplier and
 * the lot of the batch it came back from, but nobody delivered it -- counting
 * it would inflate the delivery count with the pharmacy's own returns.
 */
export async function supplierHistory(tx: Database, options: ReportOptions) {
  const disposedValue = sql<number>`coalesce((
    select sum(${disposals.costValue})
    from ${disposals}
    join ${batches} as disposed_batch on disposed_batch.id = ${disposals.batchId}
    where disposed_batch.supplier_id = ${suppliers.id}
      and disposed_batch.parent_batch_id is null
      and disposed_batch.received_date between ${options.from} and ${options.to}
  ), 0)::bigint`;

  const rows = await tx
    .select({
      supplierId: suppliers.id,
      name: suppliers.name,
      isSystem: suppliers.isSystem,
      deliveries: sql<number>`count(${batches.id})::int`,
      units: sql<number>`coalesce(sum(${batches.qtyReceived}), 0)::int`,
      value: sql<number>`coalesce(sum(${batches.qtyReceived} * ${batches.unitCost}), 0)::bigint`,
      remaining: sql<number>`coalesce(sum(${batches.qtyRemaining}), 0)::int`,
      disposedValue,
    })
    .from(suppliers)
    .innerJoin(batches, eq(batches.supplierId, suppliers.id))
    .where(
      and(
        sql`${batches.parentBatchId} is null`,
        sql`${batches.receivedDate} between ${options.from} and ${options.to}`,
      ),
    )
    .groupBy(suppliers.id);

  return rows
    .map((row) => {
      const value = Number(row.value);
      const disposed = Number(row.disposedValue);
      return {
        ...row,
        value,
        disposedValue: disposed,
        disposalBps: value > 0 ? Math.round((disposed / value) * 10_000) : 0,
      };
    })
    .sort((a, b) => b.value - a.value);
}

/* ------------------------------------------------------------- movements */

/**
 * Every unit in and every unit out, per item.
 *
 * This is the fraud report. The other five say what the business did; this one
 * says what happened to the stock, which is where a discrepancy shows up:
 * received 100, sold 60, adjusted away 40 is a different story from received
 * 100 and sold 100, and no revenue figure can tell them apart.
 *
 * `qty_delta` is signed, so "in" and "out" are the positive and negative halves
 * of the same column rather than a guess from the movement type -- a voided
 * sale is a `sale_void` putting units back, and it belongs in the in column.
 */

/** The ledger's own types, kept as data so a caller can pivot on them. */
export type MovementBucket = {
  type: string;
  qtyIn: number;
  qtyOut: number;
  events: number;
};

export type MovementTotals = {
  itemId: string;
  code: string;
  name: string;
  strength: string | null;
  unit: string;
  categoryName: string | null;
  qtyIn: number;
  qtyOut: number;
  /** In minus out. Not the on-hand figure -- only what moved in the window. */
  net: number;
  events: number;
  byType: MovementBucket[];
};

function movedWithin({ from, to, timezone = DEFAULT_TIMEZONE }: ReportOptions) {
  return sql`${localDate(sql`${stockMovements.createdAt}`, timezone)} between ${from} and ${to}`;
}

/**
 * Totals per item, split by movement type.
 *
 * Aggregated in SQL down to one row per item and type -- a handful of rows per
 * item -- and folded into a per-item shape here. The fold is arithmetic on an
 * already-complete result, not a summation of a limited row set.
 */
export async function movementTotalsByItem(
  tx: Database,
  options: ReportOptions,
): Promise<MovementTotals[]> {
  const rows = await tx
    .select({
      itemId: items.id,
      code: items.code,
      name: items.genericName,
      strength: items.strength,
      unit: items.unit,
      categoryName: categories.name,
      type: stockMovements.type,
      qtyIn: sql<number>`coalesce(sum(greatest(${stockMovements.qtyDelta}, 0)), 0)::int`,
      qtyOut: sql<number>`coalesce(sum(-least(${stockMovements.qtyDelta}, 0)), 0)::int`,
      events: sql<number>`count(*)::int`,
    })
    .from(stockMovements)
    .innerJoin(items, eq(items.id, stockMovements.itemId))
    .leftJoin(categories, eq(categories.id, items.categoryId))
    .where(movedWithin(options))
    .groupBy(items.id, categories.name, stockMovements.type);

  const byItem = new Map<string, MovementTotals>();
  for (const row of rows) {
    const existing =
      byItem.get(row.itemId) ??
      ({
        itemId: row.itemId,
        code: row.code,
        name: row.name,
        strength: row.strength,
        unit: row.unit,
        categoryName: row.categoryName,
        qtyIn: 0,
        qtyOut: 0,
        net: 0,
        events: 0,
        byType: [],
      } satisfies MovementTotals);

    existing.qtyIn += row.qtyIn;
    existing.qtyOut += row.qtyOut;
    existing.net = existing.qtyIn - existing.qtyOut;
    existing.events += row.events;
    existing.byType.push({
      type: row.type,
      qtyIn: row.qtyIn,
      qtyOut: row.qtyOut,
      events: row.events,
    });
    byItem.set(row.itemId, existing);
  }

  return [...byItem.values()]
    .map((row) => ({
      ...row,
      byType: row.byType.sort((a, b) => b.qtyIn + b.qtyOut - (a.qtyIn + a.qtyOut)),
    }))
    .sort((a, b) => b.qtyOut - a.qtyOut || b.qtyIn - a.qtyIn);
}

export type MovementRow = {
  id: string;
  itemId: string;
  type: string;
  qtyDelta: number;
  reason: string | null;
  createdAt: Date;
  lotNumber: string | null;
  expiryDate: string;
  performedBy: string;
  /** The sale, return, disposal or count this movement came from, if any. */
  document: string | null;
};

/**
 * The movements themselves, newest first.
 *
 * Every row carries who did it and which document it belongs to, because a
 * quantity with no name against it is exactly the row somebody would want to
 * be anonymous. The document numbers are joined per reference table rather
 * than stored on the movement -- `ref_type`/`ref_id` is the ledger's own
 * pointer and this is the only place that has to read it.
 *
 * `limit` is a display cap, not part of any total: the figures above the list
 * come from `movementTotalsByItem`, which counts every row. `truncated` says
 * plainly when the list is not the whole window rather than letting a short
 * list imply a quiet period. `limit: null` lifts the cap entirely, which is
 * what the CSV export wants -- a spreadsheet has no scroll problem, and a
 * download that quietly stopped at 2.000 rows would be worse than a slow one.
 */
export async function movementLedger(
  tx: Database,
  options: ReportOptions & { itemId?: string; limit?: number | null },
): Promise<{ rows: MovementRow[]; truncated: boolean }> {
  const limit = options.limit === null ? null : (options.limit ?? 2000);

  const where = options.itemId
    ? and(movedWithin(options), eq(stockMovements.itemId, options.itemId))
    : movedWithin(options);

  const rows = await tx
    .select({
      id: stockMovements.id,
      itemId: stockMovements.itemId,
      type: stockMovements.type,
      qtyDelta: stockMovements.qtyDelta,
      reason: stockMovements.reason,
      createdAt: stockMovements.createdAt,
      lotNumber: batches.lotNumber,
      expiryDate: batches.expiryDate,
      performedBy: users.fullName,
      document: sql<string | null>`coalesce(
        ${sales.saleNumber},
        ${returns.returnNumber},
        ${disposals.disposalNumber},
        ${stockCounts.countNumber}
      )`,
    })
    .from(stockMovements)
    .innerJoin(batches, eq(batches.id, stockMovements.batchId))
    .innerJoin(users, eq(users.id, stockMovements.performedBy))
    .leftJoin(
      sales,
      and(eq(stockMovements.refType, sql`'sales'`), eq(sales.id, stockMovements.refId)),
    )
    .leftJoin(
      returns,
      and(
        eq(stockMovements.refType, sql`'returns'`),
        eq(returns.id, stockMovements.refId),
      ),
    )
    .leftJoin(
      disposals,
      and(
        eq(stockMovements.refType, sql`'disposals'`),
        eq(disposals.id, stockMovements.refId),
      ),
    )
    .leftJoin(
      stockCounts,
      and(
        eq(stockMovements.refType, sql`'stock_counts'`),
        eq(stockCounts.id, stockMovements.refId),
      ),
    )
    .where(where)
    .orderBy(sql`${stockMovements.createdAt} desc`)
    // One more than asked for, so "there are more" is known rather than guessed
    // from a full page.
    .limit(limit === null ? Number.MAX_SAFE_INTEGER : limit + 1);

  if (limit === null) return { rows, truncated: false };
  return { rows: rows.slice(0, limit), truncated: rows.length > limit };
}
