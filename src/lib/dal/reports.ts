import "server-only";

import { getDb } from "@/db";
import { assertPermission } from "./session";
import { getSettings } from "./settings";
import { today } from "@/lib/format/date";
import * as reports from "@/lib/reports/queries";
import type { DateRange } from "@/lib/reports/queries";
import { previousRange, type Preset } from "@/lib/reports/catalogue";
import { abcClasses } from "@/lib/reports/analysis";
import { isUuid } from "@/lib/format/ids";

// The catalogue is plain data in its own module, so the nav, the export route
// and the tests can read it without pulling the database in behind it.
export {
  REPORTS,
  REPORT_PERMISSION,
  PRESETS,
  isReportSlug,
  previousRange,
  resolveRange,
} from "@/lib/reports/catalogue";
export type { ReportSlug, Preset } from "@/lib/reports/catalogue";
export type { DateRange };

/**
 * Reporting, with the permission split that is the point of this whole screen
 * group: **`reports.sales` shows what sold; `reports.financial` shows what it
 * cost.** A manager can be given the first without the second, which is the
 * default, and every function below asserts only the one it needs.
 *
 * The date window is resolved here rather than in the queries so the screen,
 * the CSV export and any future digest all agree about what "this month" means.
 */

async function withTimezone(range: DateRange) {
  const settings = await getSettings();
  return { ...range, timezone: settings.timezone };
}

/* ------------------------------------------------------------ sales report */

/**
 * Everything the sales screen shows, for the window and the one before it.
 *
 * The per-product rows are fetched once and folded into categories here, so
 * the category table cannot disagree with the product table above it.
 */
export async function salesReport(range: DateRange & { preset?: Preset | "custom" }) {
  await assertPermission("reports.sales");
  const db = await getDb();
  const options = await withTimezone(range);
  const previous = { ...previousRange(range), timezone: options.timezone };

  const byItem = await reports.itemSales(db, options);
  const classes = abcClasses(byItem);

  return {
    summary: await reports.salesSummary(db, options),
    previousSummary: await reports.salesSummary(db, previous),
    previousRange: { from: previous.from, to: previous.to },
    daily: await reports.dailyRevenue(db, options),
    previousDaily: await reports.dailyRevenue(db, previous),
    byHour: await reports.salesByHour(db, options),
    byItem: byItem.map((row) => ({ ...row, abc: classes.get(row.key) ?? "C" })),
    byCategory: reports.groupByCategory(byItem),
    byCashier: await reports.salesByCashier(db, options),
    byPaymentMethod: await reports.salesByPaymentMethod(db, options),
  };
}

/**
 * The figures the reports home page opens on. Each half of the permission
 * split is fetched only for someone who holds it -- a manager's overview has
 * no margin in it at all, not a margin that is hidden.
 */
export async function reportsOverview(
  range: DateRange & { preset?: Preset | "custom" },
  access: { sales: boolean; financial: boolean },
) {
  const db = await getDb();
  const options = await withTimezone(range);
  const previous = { ...previousRange(range), timezone: options.timezone };

  let sales = null;
  if (access.sales) {
    await assertPermission("reports.sales");
    sales = {
      summary: await reports.salesSummary(db, options),
      previousSummary: await reports.salesSummary(db, previous),
      daily: await reports.dailyRevenue(db, options),
      previousDaily: await reports.dailyRevenue(db, previous),
    };
  }

  let financial = null;
  if (access.financial) {
    await assertPermission("reports.financial");
    const byCategory = await reports.valuationByCategory(db);
    financial = {
      margin: await reports.marginSummary(db, options),
      previousMargin: await reports.marginSummary(db, previous),
      stockValue: byCategory.reduce((sum, row) => sum + row.value, 0),
      expiryLoss: (await reports.expiryLoss(db, options)).reduce((sum, row) => sum + row.value, 0),
    };
  }

  return { sales, financial, previousRange: { from: previous.from, to: previous.to } };
}

/* -------------------------------------------------------------- movements */

/**
 * The stock ledger, per item, for the window.
 *
 * Same permission as the sales report -- it carries quantities and names, not
 * cost prices -- because the person who should be checking that what left the
 * shelf matches what was rung up is the manager on the floor.
 */
export async function movementsReport(
  range: DateRange,
  itemId?: string,
  /** `null` lifts the row cap; the CSV export passes it, the screen does not. */
  limit?: number | null,
) {
  await assertPermission("reports.sales");
  const db = await getDb();
  const options = await withTimezone(range);

  // The product comes from a URL; a malformed one is no filter, not a crash.
  if (!isUuid(itemId)) itemId = undefined;
  const all = await reports.movementTotalsByItem(db, options);
  const ledger = await reports.movementLedger(db, { ...options, itemId, limit });
  // The totals follow the filter: with one item selected the headline figures
  // are that item's, not the pharmacy's, which is what the screen is showing.
  const byItem = itemId ? all.filter((row) => row.itemId === itemId) : all;

  return {
    byItem,
    /** Every item that moved, for the filter -- not only the ones listed. */
    choices: all
      .map((row) => ({
        itemId: row.itemId,
        code: row.code,
        label: `${row.name}${row.strength ? ` ${row.strength}` : ""}`,
      }))
      // Alphabetical: a dropdown is scanned by name, not by how much moved.
      .sort((a, b) => a.label.localeCompare(b.label)),
    movements: ledger.rows,
    truncated: ledger.truncated,
    itemId: itemId ?? null,
    qtyIn: byItem.reduce((sum, row) => sum + row.qtyIn, 0),
    qtyOut: byItem.reduce((sum, row) => sum + row.qtyOut, 0),
  };
}

/* ----------------------------------------------------------------- margin */

export async function marginReport(range: DateRange & { preset?: Preset | "custom" }) {
  await assertPermission("reports.financial");
  const db = await getDb();
  const options = await withTimezone(range);
  const previous = { ...previousRange(range), timezone: options.timezone };

  const itemRows = await reports.itemSales(db, options);
  const byItem = reports.toMarginRows(itemRows);
  const summary = reports.summariseMargin(itemRows, byItem);

  // Categories from the same rows, so they add up to the products exactly.
  const categories = new Map<string, { categoryId: string | null; name: string; revenue: number; cost: number; margin: number; items: number }>();
  for (const row of byItem) {
    const key = row.categoryId ?? "";
    const hit = categories.get(key) ?? { categoryId: row.categoryId, name: row.categoryName ?? "", revenue: 0, cost: 0, margin: 0, items: 0 };
    hit.revenue += row.marginRevenue;
    hit.cost += row.cost;
    hit.margin += row.margin;
    hit.items += 1;
    categories.set(key, hit);
  }

  return {
    summary,
    previousSummary: await reports.marginSummary(db, previous),
    previousRange: { from: previous.from, to: previous.to },
    byItem,
    byCategory: [...categories.values()]
      .map((row) => ({ ...row, marginBps: row.revenue > 0 ? Math.round((row.margin / row.revenue) * 10_000) : 0 }))
      .sort((a, b) => b.margin - a.margin),
  };
}

/* -------------------------------------------------------------- valuation */

export async function valuationReport() {
  await assertPermission("reports.financial");
  const db = await getDb();

  const byCategory = await reports.valuationByCategory(db);
  return {
    byCategory,
    byExpiry: await reports.valuationByExpiry(db, today()),
    total: byCategory.reduce((sum, row) => sum + row.value, 0),
    units: byCategory.reduce((sum, row) => sum + row.units, 0),
    /** The valuation is "now"; the screen says so rather than implying a range. */
    asOf: today(),
  };
}

/* ------------------------------------------------------------ expiry loss */

export async function expiryLossReport(range: DateRange) {
  await assertPermission("reports.financial");
  const db = await getDb();
  const options = await withTimezone(range);

  const byItem = await reports.expiryLoss(db, options);
  return {
    byItem,
    byMonth: await reports.expiryLossByMonth(db, options),
    byReason: await reports.disposalReasons(db, options),
    total: byItem.reduce((sum, row) => sum + row.value, 0),
    units: byItem.reduce((sum, row) => sum + row.qty, 0),
  };
}

/* --------------------------------------------------------------- supplier */

export async function supplierReport(range: DateRange) {
  await assertPermission("reports.financial");
  const db = await getDb();
  const options = await withTimezone(range);

  const rows = await reports.supplierHistory(db, options);
  return {
    rows,
    total: rows.reduce((sum, row) => sum + row.value, 0),
    disposed: rows.reduce((sum, row) => sum + row.disposedValue, 0),
  };
}
