import "server-only";

import { getDb } from "@/db";
import { assertPermission } from "./session";
import { getSettings } from "./settings";
import { today } from "@/lib/format/date";
import * as reports from "@/lib/reports/queries";
import type { DateRange } from "@/lib/reports/queries";

// The catalogue is plain data in its own module, so the nav, the export route
// and the tests can read it without pulling the database in behind it.
export {
  REPORTS,
  REPORT_PERMISSION,
  PRESETS,
  isReportSlug,
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

export async function salesReport(range: DateRange) {
  await assertPermission("reports.sales");
  const db = await getDb();
  const options = await withTimezone(range);

  return {
    summary: await reports.salesSummary(db, options),
    daily: await reports.dailyRevenue(db, options),
    byItem: await reports.salesByItem(db, options),
    byCategory: await reports.salesByCategory(db, options),
    byCashier: await reports.salesByCashier(db, options),
    byPaymentMethod: await reports.salesByPaymentMethod(db, options),
  };
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

export async function marginReport(range: DateRange) {
  await assertPermission("reports.financial");
  const db = await getDb();
  const options = await withTimezone(range);

  return {
    summary: await reports.marginSummary(db, options),
    byItem: await reports.marginByItem(db, options),
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
