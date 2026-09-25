import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  batches,
  categories,
  disposals,
  historyImports,
  historySaleLines,
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
 * Four rules run through all of it:
 *
 * 1. **Aggregate in SQL.** Fetching rows and summing them in a page would be
 *    slower and would quietly change as soon as a limit was hit.
 * 2. **Cost comes from `sale_lines.unit_cost_snapshot`, never from the batch.**
 *    That column exists so last month's margin does not move when this month's
 *    delivery costs more. Joining to `batches` for cost would undo it.
 * 3. **A day is a day in the pharmacy's timezone.** `soldAt` is an instant;
 *    casting it to a date in UTC would file a sale made at 06:00 in Jakarta
 *    under the previous day. Every date bucket goes through `localDate`.
 * 4. **Net sales are net of discounts, returns and PPN.** A line's price is
 *    what was asked; what the pharmacy earned from it is that price less its
 *    share of the sale's discount, less the PPN inside it when prices include
 *    tax, less whatever came back. PPN collected is the tax office's money,
 *    and it is reported beside net sales rather than inside them. Imported
 *    history (`history_sale_lines`) adds to sales and margin only -- never to
 *    anything about stock -- and a withdrawn import adds nothing.
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

/** Imported lines that still count: their import has not been withdrawn. */
function historyWithin({ from, to }: ReportOptions) {
  return and(
    eq(historyImports.status, "active"),
    sql`${historySaleLines.soldOn} between ${from} and ${to}`,
  );
}

/** Postgres hands `numeric` back as text; sums of shares are rounded here, once. */
const num = (value: unknown) => Number(value ?? 0);

/* ------------------------------------------------------------------ sales */

export type SalesSummary = {
  /** Every line at the price asked, plus imported history. */
  gross: number;
  discount: number;
  /** PPN inside the prices of sales rung up with tax-inclusive pricing. */
  taxIncluded: number;
  /** Money handed back for returns, as paid -- PPN and all. */
  refunds: number;
  /** The part of `refunds` that was PPN. */
  refundTax: number;
  /** `refunds` without their PPN: what came off net sales. */
  refundsExTax: number;
  /** Gross, less discounts, returns and the PPN inside prices. */
  net: number;
  /** PPN on every sale in the window, before returns. */
  tax: number;
  /** PPN kept: `tax` less what went back out with refunds. */
  taxNet: number;
  /** What the till took plus imported history, before refunds. */
  revenue: number;
  /** What the drawer and the bank actually kept: `revenue` less refunds. */
  collected: number;
  transactions: number;
  returns: number;
  voided: number;
  units: number;
  /** Rounded, because an average basket in fractional rupiah is noise. */
  averageSale: number;
  history: {
    lines: number;
    revenue: number;
    units: number;
    /** Distinct old receipts, which count as transactions. */
    receipts: number;
    /** Lines with no receipt number: in the revenue, not in the transaction count. */
    withoutReceipt: number;
    withoutReceiptRevenue: number;
  };
};

/**
 * The headline figures, laid out as a sales statement.
 *
 * Refunds are subtracted but reported separately rather than folded in
 * silently: "Rp 4,1 juta, of which Rp 90.000 went back out" is a different
 * story from "Rp 4,01 juta", and the owner should see which one they are in.
 *
 * Every figure is exact at the level of the sale, so the statement adds up to
 * the rupiah: `net + taxNet = collected`.
 */
export async function salesSummary(tx: Database, options: ReportOptions): Promise<SalesSummary> {
  const [sold] = await tx
    .select({
      subtotal: sql<number>`coalesce(sum(${sales.subtotal}), 0)::bigint`,
      discount: sql<number>`coalesce(sum(${sales.discount}), 0)::bigint`,
      tax: sql<number>`coalesce(sum(${sales.taxAmount}), 0)::bigint`,
      taxIncluded: sql<number>`coalesce(sum(case when ${sales.taxMode} = 'inclusive' then ${sales.taxAmount} else 0 end), 0)::bigint`,
      total: sql<number>`coalesce(sum(${sales.total}), 0)::bigint`,
      transactions: sql<number>`count(*)::int`,
    })
    .from(sales)
    .where(soldWithin(options));

  const [refunded] = await tx
    .select({
      refunds: sql<number>`coalesce(sum(${returns.refundTotal}), 0)::bigint`,
      // Each refund gives back tax at its own sale's rate. Summed exactly and
      // rounded once, so the per-product table can be apportioned to this
      // same figure to the rupiah.
      refundTax: sql<number>`coalesce(round(sum(${returns.refundTotal}::numeric * ${sales.taxAmount} / nullif(${sales.total}, 0))), 0)::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(returns)
    .innerJoin(sales, eq(sales.id, returns.saleId))
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
    .select({ total: sql<number>`coalesce(sum(${saleLines.qty}), 0)::bigint` })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .where(soldWithin(options));

  const [history] = await tx
    .select({
      lines: sql<number>`count(*)::int`,
      revenue: sql<number>`coalesce(sum(${historySaleLines.lineTotal}), 0)::bigint`,
      units: sql<number>`coalesce(sum(${historySaleLines.qty}), 0)::bigint`,
      receipts: sql<number>`count(distinct case when ${historySaleLines.receiptNumber} is not null then ${historySaleLines.soldOn}::text || '|' || ${historySaleLines.receiptNumber} end)::int`,
      withoutReceipt: sql<number>`count(*) filter (where ${historySaleLines.receiptNumber} is null)::int`,
      withoutReceiptRevenue: sql<number>`coalesce(sum(${historySaleLines.lineTotal}) filter (where ${historySaleLines.receiptNumber} is null), 0)::bigint`,
    })
    .from(historySaleLines)
    .innerJoin(historyImports, eq(historyImports.id, historySaleLines.importId))
    .where(historyWithin(options));

  const hist = {
    lines: history?.lines ?? 0,
    revenue: num(history?.revenue),
    units: num(history?.units),
    receipts: history?.receipts ?? 0,
    withoutReceipt: history?.withoutReceipt ?? 0,
    withoutReceiptRevenue: num(history?.withoutReceiptRevenue),
  };

  const tillTotal = num(sold?.total);
  const discount = num(sold?.discount);
  const tax = num(sold?.tax);
  const taxIncluded = num(sold?.taxIncluded);
  const refunds = num(refunded?.refunds);
  const refundTax = num(refunded?.refundTax);
  const refundsExTax = refunds - refundTax;
  const gross = num(sold?.subtotal) + hist.revenue;
  const revenue = tillTotal + hist.revenue;
  const transactions = (sold?.transactions ?? 0) + hist.receipts;
  // The average basket counts only what was counted as a transaction: history
  // lines without a receipt number are in the takings but belong to no basket.
  const basketRevenue = revenue - hist.withoutReceiptRevenue;

  return {
    gross,
    discount,
    taxIncluded,
    refunds,
    refundTax,
    refundsExTax,
    net: gross - discount - taxIncluded - refundsExTax,
    tax,
    taxNet: tax - refundTax,
    revenue,
    collected: revenue - refunds,
    transactions,
    returns: refunded?.count ?? 0,
    voided: voided?.count ?? 0,
    units: num(units?.total) + hist.units,
    averageSale: transactions > 0 ? Math.round(basketRevenue / transactions) : 0,
    history: hist,
  };
}

/**
 * Takings per day, with quiet days present as zero so a line does not slope
 * through them. A day's figure is what was rung up that day, before any
 * refund -- a return is filed under the day it came back, not the day it sold.
 */
export async function dailyRevenue(tx: Database, options: ReportOptions) {
  const timezone = options.timezone ?? DEFAULT_TIMEZONE;
  const day = localDate(sql`${sales.soldAt}`, timezone);

  const till = await tx
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

  const history = await tx
    .select({
      day: sql<string>`${historySaleLines.soldOn}::text`,
      total: sql<number>`coalesce(sum(${historySaleLines.lineTotal}), 0)::bigint`,
      count: sql<number>`count(distinct ${historySaleLines.receiptNumber})::int`,
    })
    .from(historySaleLines)
    .innerJoin(historyImports, eq(historyImports.id, historySaleLines.importId))
    .where(historyWithin(options))
    .groupBy(historySaleLines.soldOn);

  const byDay = new Map<string, { total: number; count: number }>();
  for (const row of [...till, ...history]) {
    const hit = byDay.get(row.day) ?? { total: 0, count: 0 };
    byDay.set(row.day, { total: hit.total + num(row.total), count: hit.count + row.count });
  }

  const series: Array<{ day: string; total: number; count: number }> = [];
  for (let cursor = options.from; cursor <= options.to; cursor = addDays(cursor, 1)) {
    const hit = byDay.get(cursor);
    series.push({ day: cursor, total: hit?.total ?? 0, count: hit?.count ?? 0 });
  }
  return series;
}

/** Transactions and takings by hour of the day. Till sales only: history has no clock. */
export async function salesByHour(tx: Database, options: ReportOptions) {
  const timezone = options.timezone ?? DEFAULT_TIMEZONE;
  const rows = await tx
    .select({
      hour: sql<number>`extract(hour from (${sales.soldAt} at time zone ${timezone}))::int`,
      total: sql<number>`coalesce(sum(${sales.total}), 0)::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(sales)
    .where(soldWithin(options))
    .groupBy(sql`1`);

  const byHour = new Map(rows.map((row) => [row.hour, row]));
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    total: num(byHour.get(hour)?.total),
    count: byHour.get(hour)?.count ?? 0,
  }));
}

/**
 * One product's sales in a window, with every deduction taken apart.
 *
 * `key` is the item id, or -- for an imported line that names something not
 * in the catalogue -- the name as written, lowercased.
 */
export type ItemSalesRow = {
  key: string;
  itemId: string | null;
  code: string;
  name: string;
  strength: string | null;
  unit: string;
  categoryId: string | null;
  categoryName: string | null;
  qtySold: number;
  qtyReturned: number;
  qtyNet: number;
  /** At the price asked, lines and history together. */
  revenue: number;
  /** This item's share of the discounts given on the sales it was in. */
  discount: number;
  /** The PPN inside its price, on tax-inclusive sales. */
  taxIncluded: number;
  /** Refunds for it, without their PPN. */
  refunded: number;
  revenueNet: number;
  /** Cost of goods, net of what came back, from the snapshot on the line. */
  cost: number;
  /** How much of `revenue` came from imported history. */
  historyRevenue: number;
  /** History revenue and units with no cost behind them: left out of margin. */
  historyUncostedRevenue: number;
  historyUncostedQty: number;
};

/**
 * Sales per product: till lines, returns and imported history, merged.
 *
 * A till line's share of its sale's discount is its share of the subtotal;
 * its share of the PPN on a tax-inclusive sale is its share of the taxable
 * lines. Both are summed as exact fractions and rounded once per product, so
 * a product's figures do not drift by a rupiah per line.
 *
 * A product returned in the window but sold before it still appears, with
 * nothing sold and a negative net: the refund came out of this window's
 * takings, and the per-product table has to add up to the statement above it.
 */
export async function itemSales(tx: Database, options: ReportOptions): Promise<ItemSalesRow[]> {
  const taxableBase = sql`sum(case when ${saleLines.taxExempt} then 0 else ${saleLines.lineTotal} end) over (partition by ${saleLines.saleId})`;

  const lines = tx
    .select({
      itemId: saleLines.itemId,
      qty: saleLines.qty,
      lineTotal: saleLines.lineTotal,
      discountShare: sql<string>`(${saleLines.lineTotal}::numeric * ${sales.discount} / nullif(${sales.subtotal}, 0))`.as(
        "discount_share",
      ),
      taxShare: sql<string>`(case when ${sales.taxMode} = 'inclusive' and not ${saleLines.taxExempt} then ${sales.taxAmount}::numeric * ${saleLines.lineTotal} / nullif(${taxableBase}, 0) else 0 end)`.as(
        "tax_share",
      ),
      lineCost: sql<string>`(${saleLines.qty} * ${saleLines.unitCostSnapshot})`.as("line_cost"),
    })
    .from(saleLines)
    .innerJoin(sales, eq(sales.id, saleLines.saleId))
    .where(soldWithin(options))
    .as("l");

  const till = await tx
    .select({
      itemId: lines.itemId,
      qty: sql<number>`coalesce(sum(${lines.qty}), 0)::bigint`,
      gross: sql<number>`coalesce(sum(${lines.lineTotal}), 0)::bigint`,
      discount: sql<string>`coalesce(sum(${lines.discountShare}), 0)`,
      tax: sql<string>`coalesce(sum(${lines.taxShare}), 0)`,
      cost: sql<number>`coalesce(sum(${lines.lineCost}), 0)::bigint`,
    })
    .from(lines)
    .groupBy(lines.itemId);

  const back = await tx
    .select({
      itemId: returnLines.itemId,
      qty: sql<number>`coalesce(sum(${returnLines.qty}), 0)::bigint`,
      refund: sql<number>`coalesce(sum(${returnLines.refundAmount}), 0)::bigint`,
      refundTax: sql<string>`coalesce(sum(${returnLines.refundAmount}::numeric * ${sales.taxAmount} / nullif(${sales.total}, 0)), 0)`,
      cost: sql<number>`coalesce(sum(${returnLines.qty} * ${saleLines.unitCostSnapshot}), 0)::bigint`,
    })
    .from(returnLines)
    .innerJoin(returns, eq(returns.id, returnLines.returnId))
    .innerJoin(sales, eq(sales.id, returns.saleId))
    .innerJoin(saleLines, eq(saleLines.id, returnLines.saleLineId))
    .where(returnedWithin(options))
    .groupBy(returnLines.itemId);

  // Unlinked lines are grouped by their name as written, ignoring case and
  // spacing, so "Antasida DOEN" and "antasida  doen" are one row.
  const nameKey = sql<string | null>`case when ${historySaleLines.itemId} is null then lower(regexp_replace(trim(${historySaleLines.itemName}), '\\s+', ' ', 'g')) end`;
  const history = await tx
    .select({
      itemId: historySaleLines.itemId,
      nameKey,
      name: sql<string>`min(${historySaleLines.itemName})`,
      qty: sql<number>`coalesce(sum(${historySaleLines.qty}), 0)::bigint`,
      gross: sql<number>`coalesce(sum(${historySaleLines.lineTotal}), 0)::bigint`,
      cost: sql<number>`coalesce(sum(${historySaleLines.qty} * ${historySaleLines.unitCost}), 0)::bigint`,
      uncostedRevenue: sql<number>`coalesce(sum(${historySaleLines.lineTotal}) filter (where ${historySaleLines.unitCost} is null), 0)::bigint`,
      uncostedQty: sql<number>`coalesce(sum(${historySaleLines.qty}) filter (where ${historySaleLines.unitCost} is null), 0)::bigint`,
    })
    .from(historySaleLines)
    .innerJoin(historyImports, eq(historyImports.id, historySaleLines.importId))
    .where(historyWithin(options))
    .groupBy(historySaleLines.itemId, sql`2`);

  const ids = [
    ...new Set(
      [...till.map((r) => r.itemId), ...back.map((r) => r.itemId), ...history.map((r) => r.itemId)].filter(
        (id): id is string => id !== null,
      ),
    ),
  ];
  const catalogue =
    ids.length === 0
      ? []
      : await tx
          .select({
            id: items.id,
            code: items.code,
            name: items.genericName,
            strength: items.strength,
            unit: items.unit,
            categoryId: items.categoryId,
            categoryName: categories.name,
          })
          .from(items)
          .leftJoin(categories, eq(categories.id, items.categoryId))
          .where(inArray(items.id, ids));
  const info = new Map(catalogue.map((item) => [item.id, item]));

  type Acc = {
    base: Omit<ItemSalesRow, "qtyNet" | "revenueNet" | "discount" | "taxIncluded" | "refunded">;
    /** Exact, fractional shares until they are apportioned below. */
    discount: number;
    taxIncluded: number;
    refundTax: number;
    /** Refunds as paid, PPN and all -- always whole rupiah. */
    refundGross: number;
  };
  const rows = new Map<string, Acc>();
  const entry = (itemId: string | null, key: string, fallbackName: string): Acc => {
    const existing = rows.get(key);
    if (existing) return existing;
    const item = itemId ? info.get(itemId) : undefined;
    const created: Acc = {
      base: {
        key,
        itemId,
        code: item?.code ?? "",
        name: item?.name ?? fallbackName,
        strength: item?.strength ?? null,
        unit: item?.unit ?? "",
        categoryId: item?.categoryId ?? null,
        categoryName: item?.categoryName ?? null,
        qtySold: 0,
        qtyReturned: 0,
        revenue: 0,
        cost: 0,
        historyRevenue: 0,
        historyUncostedRevenue: 0,
        historyUncostedQty: 0,
      },
      discount: 0,
      taxIncluded: 0,
      refundTax: 0,
      refundGross: 0,
    };
    rows.set(key, created);
    return created;
  };

  for (const row of till) {
    const acc = entry(row.itemId, row.itemId, "");
    acc.base.qtySold += num(row.qty);
    acc.base.revenue += num(row.gross);
    acc.base.cost += num(row.cost);
    acc.discount += num(row.discount);
    acc.taxIncluded += num(row.tax);
  }
  for (const row of back) {
    const acc = entry(row.itemId, row.itemId, "");
    acc.base.qtyReturned += num(row.qty);
    acc.base.cost -= num(row.cost);
    acc.refundGross += num(row.refund);
    acc.refundTax += num(row.refundTax);
  }
  for (const row of history) {
    const key = row.itemId ?? `name:${row.nameKey ?? ""}`;
    const acc = entry(row.itemId, key, row.name);
    acc.base.qtySold += num(row.qty);
    acc.base.revenue += num(row.gross);
    acc.base.cost += num(row.cost);
    acc.base.historyRevenue += num(row.gross);
    acc.base.historyUncostedRevenue += num(row.uncostedRevenue);
    acc.base.historyUncostedQty += num(row.uncostedQty);
  }

  // Shares are fractions of a rupiah until here. Rounding each product on its
  // own would leave the table a few rupiah off the statement, so the whole
  // rupiah are handed out by largest remainder: every product within a rupiah
  // of its exact share, and the column adding up to the statement exactly.
  const list = [...rows.values()];
  const discounts = apportion(list.map((row) => row.discount));
  const taxes = apportion(list.map((row) => row.taxIncluded));
  const refundTaxes = apportion(list.map((row) => row.refundTax));

  return list
    .map(({ base, refundGross }, index) => {
      const refunded = refundGross - refundTaxes[index];
      return {
        ...base,
        qtyNet: base.qtySold - base.qtyReturned,
        discount: discounts[index],
        taxIncluded: taxes[index],
        refunded,
        revenueNet: base.revenue - discounts[index] - taxes[index] - refunded,
      };
    })
    .sort((a, b) => b.revenueNet - a.revenueNet || a.name.localeCompare(b.name));
}

/**
 * Whole numbers for a set of exact shares, adding up to the rounded total of
 * the shares: each share is rounded down, and the rupiah left over go to the
 * shares that lost the most in rounding (the largest-remainder method).
 */
export function apportion(shares: number[]): number[] {
  const target = Math.round(shares.reduce((sum, share) => sum + share, 0));
  const floors = shares.map((share) => Math.floor(share + 1e-9));
  let left = target - floors.reduce((sum, value) => sum + value, 0);
  const order = shares
    .map((share, index) => ({ index, remainder: share - floors[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const result = [...floors];
  for (let i = 0; left > 0 && i < order.length; i += 1, left -= 1) result[order[i].index] += 1;
  return result;
}

/**
 * Units and revenue per item, net of what came back.
 *
 * The returned quantity is deducted here rather than reported alongside,
 * because "we sold 40 and 38 came back" is not a 40-unit line in any sense the
 * owner cares about.
 */
export async function salesByItem(tx: Database, options: ReportOptions) {
  return itemSales(tx, options);
}

export type CategorySalesRow = {
  categoryId: string | null;
  name: string;
  qty: number;
  revenue: number;
  items: number;
};

/**
 * Per-product rows folded into categories. Arithmetic on a complete result,
 * so the categories add up to exactly the products above them.
 */
export function groupByCategory(rows: ItemSalesRow[]): CategorySalesRow[] {
  const byCategory = new Map<string, CategorySalesRow>();
  for (const row of rows) {
    const key = row.categoryId ?? "";
    const existing =
      byCategory.get(key) ??
      ({ categoryId: row.categoryId, name: row.categoryName ?? "", qty: 0, revenue: 0, items: 0 } satisfies CategorySalesRow);
    existing.qty += row.qtyNet;
    existing.revenue += row.revenueNet;
    existing.items += 1;
    byCategory.set(key, existing);
  }
  return [...byCategory.values()].sort((a, b) => b.revenue - a.revenue);
}

export async function salesByCategory(tx: Database, options: ReportOptions) {
  return groupByCategory(await itemSales(tx, options));
}

export type CashierSalesRow = {
  cashierId: string | null;
  name: string;
  transactions: number;
  revenue: number;
  /** An old till's cashier, named in imported history, not an account here. */
  fromHistory: boolean;
};

export async function salesByCashier(tx: Database, options: ReportOptions): Promise<CashierSalesRow[]> {
  const till = await tx
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

  const history = await tx
    .select({
      name: sql<string>`coalesce(${historySaleLines.cashierName}, '')`,
      transactions: sql<number>`count(distinct case when ${historySaleLines.receiptNumber} is not null then ${historySaleLines.soldOn}::text || '|' || ${historySaleLines.receiptNumber} end)::int`,
      revenue: sql<number>`coalesce(sum(${historySaleLines.lineTotal}), 0)::bigint`,
    })
    .from(historySaleLines)
    .innerJoin(historyImports, eq(historyImports.id, historySaleLines.importId))
    .where(historyWithin(options))
    .groupBy(sql`1`);

  return [
    ...till.map((r) => ({ ...r, revenue: num(r.revenue), fromHistory: false })),
    ...history.map((r) => ({
      cashierId: null,
      name: r.name,
      transactions: r.transactions,
      revenue: num(r.revenue),
      fromHistory: true,
    })),
  ].sort((a, b) => b.revenue - a.revenue);
}

export type PaymentSalesRow = {
  /** A payment method key, or `unrecorded` for history that never said. */
  method: string;
  transactions: number;
  /** Taken in, before refunds. */
  revenue: number;
  /** Paid back out by this method. */
  refunds: number;
  net: number;
};

/**
 * How the money came in, and how it went back out. Recorded, not reconciled --
 * there is no gateway -- but this is the table the day's cash count is checked
 * against, so a refund is taken off the method it was paid back by.
 */
export async function salesByPaymentMethod(
  tx: Database,
  options: ReportOptions,
): Promise<PaymentSalesRow[]> {
  const till = await tx
    .select({
      method: sales.paymentMethod,
      transactions: sql<number>`count(*)::int`,
      revenue: sql<number>`coalesce(sum(${sales.total}), 0)::bigint`,
    })
    .from(sales)
    .where(soldWithin(options))
    .groupBy(sales.paymentMethod);

  const refunds = await tx
    .select({
      method: returns.refundMethod,
      refunds: sql<number>`coalesce(sum(${returns.refundTotal}), 0)::bigint`,
    })
    .from(returns)
    .where(returnedWithin(options))
    .groupBy(returns.refundMethod);

  const history = await tx
    .select({
      method: sql<string>`coalesce(${historySaleLines.paymentMethod}::text, 'unrecorded')`,
      transactions: sql<number>`count(distinct case when ${historySaleLines.receiptNumber} is not null then ${historySaleLines.soldOn}::text || '|' || ${historySaleLines.receiptNumber} end)::int`,
      revenue: sql<number>`coalesce(sum(${historySaleLines.lineTotal}), 0)::bigint`,
    })
    .from(historySaleLines)
    .innerJoin(historyImports, eq(historyImports.id, historySaleLines.importId))
    .where(historyWithin(options))
    .groupBy(sql`1`);

  const byMethod = new Map<string, PaymentSalesRow>();
  const at = (method: string) => {
    const existing =
      byMethod.get(method) ?? { method, transactions: 0, revenue: 0, refunds: 0, net: 0 };
    byMethod.set(method, existing);
    return existing;
  };
  for (const row of [...till, ...history]) {
    const hit = at(row.method);
    hit.transactions += row.transactions;
    hit.revenue += num(row.revenue);
  }
  for (const row of refunds) at(row.method).refunds += num(row.refunds);

  return [...byMethod.values()]
    .map((row) => ({ ...row, net: row.revenue - row.refunds }))
    .sort((a, b) => b.revenue - a.revenue);
}

/* ----------------------------------------------------------------- margin */

export type MarginRow = ItemSalesRow & {
  /** Net sales this margin is taken on: imported lines with no cost left out. */
  marginRevenue: number;
  marginQty: number;
  margin: number;
  /** Basis points, so no float ever reaches a stored or compared figure. */
  marginBps: number;
};

/**
 * Net sales against cost of goods, per item.
 *
 * Cost is `unit_cost_snapshot`, copied onto the line at the moment of sale. A
 * returned unit takes back both its revenue and its cost, so the margin on
 * what actually stayed sold is what appears. Imported lines that carry no
 * cost are left out entirely -- counting their revenue against a cost of zero
 * would report them as pure profit -- and `marginSummary` says how much was
 * left out.
 */
export function toMarginRows(rows: ItemSalesRow[]): MarginRow[] {
  return rows
    .map((row) => {
      const marginRevenue = row.revenueNet - row.historyUncostedRevenue;
      const margin = marginRevenue - row.cost;
      return {
        ...row,
        // Kept under the old names too: `revenue` here is net sales.
        revenue: marginRevenue,
        marginRevenue,
        marginQty: row.qtyNet - row.historyUncostedQty,
        margin,
        marginBps: marginRevenue > 0 ? Math.round((margin / marginRevenue) * 10_000) : 0,
      };
    })
    .filter((row) => row.marginQty !== 0 || row.marginRevenue !== 0 || row.cost !== 0)
    .sort((a, b) => b.margin - a.margin || a.name.localeCompare(b.name));
}

export async function marginByItem(tx: Database, options: ReportOptions) {
  return toMarginRows(await itemSales(tx, options));
}

export type MarginSummary = {
  revenue: number;
  cost: number;
  margin: number;
  marginBps: number;
  items: number;
  /** Imported history left out of the margin for want of a cost. */
  uncostedRevenue: number;
};

export function summariseMargin(itemRows: ItemSalesRow[], marginRows: MarginRow[]): MarginSummary {
  const revenue = marginRows.reduce((sum, r) => sum + r.marginRevenue, 0);
  const cost = marginRows.reduce((sum, r) => sum + r.cost, 0);
  const margin = revenue - cost;
  return {
    revenue,
    cost,
    margin,
    marginBps: revenue > 0 ? Math.round((margin / revenue) * 10_000) : 0,
    items: marginRows.length,
    uncostedRevenue: itemRows.reduce((sum, r) => sum + r.historyUncostedRevenue, 0),
  };
}

export async function marginSummary(tx: Database, options: ReportOptions): Promise<MarginSummary> {
  const rows = await itemSales(tx, options);
  return summariseMargin(rows, toMarginRows(rows));
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
