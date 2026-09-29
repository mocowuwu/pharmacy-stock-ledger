import "server-only";

import type { getTranslations } from "next-intl/server";
import {
  expiryLossReport,
  marginReport,
  movementsReport,
  salesReport,
  supplierReport,
  valuationReport,
  type ReportSlug,
} from "@/lib/dal/reports";
import type { Preset } from "@/lib/reports/catalogue";
import { shareBps } from "@/lib/reports/analysis";
import { formatMoney } from "@/lib/format/money";

/**
 * What an export contains, independent of the file format.
 *
 * Each report is described once as tables of plain values -- rupiah and
 * counts as integers, percentages as basis points -- and `route.ts` writes the
 * same description as CSV (the first table) or as a workbook (a summary sheet,
 * then a sheet per table). The screen and the files are built from the same
 * DAL calls, so they cannot disagree about a figure.
 */

type Translate = Awaited<ReturnType<typeof getTranslations>>;
type Value = string | number | null;

export type ColumnFormat = "text" | "int" | "money" | "percent";

export type ExportTable = {
  /** Sheet name in the workbook. */
  title: string;
  columns: Array<{ label: string; format?: ColumnFormat; width?: number }>;
  rows: Value[][];
  totals?: Value[];
};

export type ExportModel = {
  /** File name stem, e.g. "penjualan". */
  name: string;
  /** Label/value lines for the summary sheet, with the period before where it compares. */
  summary: Array<{ label: string; value: number; format: ColumnFormat; previous?: number | null }>;
  tables: ExportTable[];
  /** Plain sentences worth keeping with the figures. */
  notes: string[];
  compares: boolean;
  previousRange?: { from: string; to: string };
};

const product = (row: { name: string; strength: string | null }) =>
  `${row.name}${row.strength ? ` ${row.strength}` : ""}`;

export async function buildExportModel(
  t: Translate,
  report: ReportSlug,
  range: { from: string; to: string; preset: Preset | "custom" },
  itemId?: string,
): Promise<ExportModel> {
  switch (report) {
    case "sales": {
      const data = await salesReport(range);
      const s = data.summary;
      const p = data.previousSummary;
      const totalNet = data.byItem.reduce((sum, row) => sum + row.revenueNet, 0);
      const categoryTotal = data.byCategory.reduce((sum, row) => sum + row.revenue, 0);
      return {
        name: t("reports.nav.sales").toLowerCase(),
        compares: true,
        previousRange: data.previousRange,
        summary: [
          { label: t("reports.statement.gross"), value: s.gross, format: "money", previous: p.gross },
          { label: t("reports.statement.discount"), value: s.discount, format: "money", previous: p.discount },
          { label: t("reports.statement.returns"), value: s.refundsExTax, format: "money", previous: p.refundsExTax },
          { label: t("reports.statement.taxIncluded"), value: s.taxIncluded, format: "money", previous: p.taxIncluded },
          { label: t("reports.statement.net"), value: s.net, format: "money", previous: p.net },
          { label: t("reports.statement.tax"), value: s.taxNet, format: "money", previous: p.taxNet },
          { label: t("reports.statement.collected"), value: s.collected, format: "money", previous: p.collected },
          { label: t("reports.sales.transactions"), value: s.transactions, format: "int", previous: p.transactions },
          { label: t("reports.sales.averageSale"), value: s.averageSale, format: "money", previous: p.averageSale },
          { label: t("reports.sales.units"), value: s.units, format: "int", previous: p.units },
          { label: t("reports.sales.voided"), value: s.voided, format: "int", previous: p.voided },
        ],
        notes: [
          t("reports.statement.note"),
          ...(s.history.lines > 0
            ? [
                t("reports.history.included", {
                  revenue: formatMoney(s.history.revenue),
                  lines: s.history.lines.toLocaleString("id-ID"),
                }),
              ]
            : []),
        ],
        tables: [
          {
            title: t("reports.sales.byItem"),
            columns: [
              { label: t("items.code"), width: 12 },
              { label: t("sell.item"), width: 34 },
              { label: t("items.category"), width: 18 },
              { label: t("reports.sales.abc"), width: 6 },
              { label: t("reports.sales.sold"), format: "int" },
              { label: t("reports.sales.returned"), format: "int" },
              { label: t("reports.sales.netUnits"), format: "int" },
              { label: t("reports.sales.gross"), format: "money", width: 16 },
              { label: t("reports.statement.discount"), format: "money", width: 14 },
              { label: t("reports.statement.taxIncluded"), format: "money", width: 14 },
              { label: t("reports.statement.returns"), format: "money", width: 14 },
              { label: t("reports.sales.netRevenue"), format: "money", width: 16 },
              { label: t("reports.table.share"), format: "percent" },
            ],
            rows: data.byItem.map((row) => [
              row.code,
              product(row),
              row.categoryName,
              row.abc,
              row.qtySold,
              row.qtyReturned,
              row.qtyNet,
              row.revenue,
              row.discount,
              row.taxIncluded,
              row.refunded,
              row.revenueNet,
              shareBps(row.revenueNet, totalNet),
            ]),
            totals: [
              t("reports.table.total"),
              null,
              null,
              null,
              data.byItem.reduce((sum, r) => sum + r.qtySold, 0),
              data.byItem.reduce((sum, r) => sum + r.qtyReturned, 0),
              data.byItem.reduce((sum, r) => sum + r.qtyNet, 0),
              data.byItem.reduce((sum, r) => sum + r.revenue, 0),
              data.byItem.reduce((sum, r) => sum + r.discount, 0),
              data.byItem.reduce((sum, r) => sum + r.taxIncluded, 0),
              data.byItem.reduce((sum, r) => sum + r.refunded, 0),
              totalNet,
              null,
            ],
          },
          {
            title: t("reports.sales.byCategory"),
            columns: [
              { label: t("items.category"), width: 24 },
              { label: t("reports.sales.netUnits"), format: "int" },
              { label: t("reports.sales.netRevenue"), format: "money", width: 16 },
              { label: t("reports.table.share"), format: "percent" },
            ],
            rows: data.byCategory.map((row) => [
              row.name || t("reports.table.uncategorised"),
              row.qty,
              row.revenue,
              shareBps(row.revenue, categoryTotal),
            ]),
            totals: [t("reports.table.total"), data.byCategory.reduce((sum, r) => sum + r.qty, 0), categoryTotal, null],
          },
          {
            title: t("reports.sales.byPayment"),
            columns: [
              { label: t("sell.paymentMethod"), width: 20 },
              { label: t("reports.sales.transactionsShort"), format: "int" },
              { label: t("reports.sales.takings"), format: "money", width: 16 },
              { label: t("reports.sales.refunds"), format: "money", width: 14 },
              { label: t("reports.sales.received"), format: "money", width: 16 },
            ],
            rows: data.byPaymentMethod.map((row) => [
              row.method === "unrecorded" ? t("reports.sales.unrecordedMethod") : t(`paymentMethod.${row.method}`),
              row.transactions,
              row.revenue,
              row.refunds,
              row.net,
            ]),
            totals: [
              t("reports.table.total"),
              data.byPaymentMethod.reduce((sum, r) => sum + r.transactions, 0),
              data.byPaymentMethod.reduce((sum, r) => sum + r.revenue, 0),
              data.byPaymentMethod.reduce((sum, r) => sum + r.refunds, 0),
              data.byPaymentMethod.reduce((sum, r) => sum + r.net, 0),
            ],
          },
          {
            title: t("reports.sales.byCashier"),
            columns: [
              { label: t("reports.sales.cashier"), width: 24 },
              { label: t("reports.sales.transactionsShort"), format: "int" },
              { label: t("reports.sales.takings"), format: "money", width: 16 },
            ],
            rows: data.byCashier.map((row) => [
              `${row.name || t("reports.history.unknownCashier")}${row.fromHistory ? ` (${t("reports.history.tag")})` : ""}`,
              row.transactions,
              row.revenue,
            ]),
            totals: [
              t("reports.table.total"),
              data.byCashier.reduce((sum, r) => sum + r.transactions, 0),
              data.byCashier.reduce((sum, r) => sum + r.revenue, 0),
            ],
          },
          {
            title: t("reports.sales.dailyTable"),
            columns: [
              { label: t("reports.table.date"), width: 12 },
              { label: t("reports.sales.transactionsShort"), format: "int" },
              { label: t("reports.sales.takings"), format: "money", width: 16 },
            ],
            // ISO dates: a spreadsheet sorts them, and nobody misreads the month.
            rows: data.daily.map((row) => [row.day, row.count, row.total]),
            totals: [
              t("reports.table.total"),
              data.daily.reduce((sum, r) => sum + r.count, 0),
              data.daily.reduce((sum, r) => sum + r.total, 0),
            ],
          },
          {
            title: t("reports.sales.byHour"),
            columns: [
              { label: t("reports.table.hour"), width: 12 },
              { label: t("reports.sales.transactionsShort"), format: "int" },
              { label: t("reports.sales.takings"), format: "money", width: 16 },
            ],
            rows: data.byHour
              .filter((row) => row.count > 0)
              .map((row) => [`${String(row.hour).padStart(2, "0")}.00`, row.count, row.total]),
          },
        ],
      };
    }

    /**
     * One row per movement, not per item.
     *
     * The screen collapses the ledger under each product; a spreadsheet has no
     * dropdown, and the point of downloading this one is to sort and filter the
     * individual movements. Quantities stay signed -- positive in, negative out
     * -- so a column of them sums to the net change.
     */
    case "movements": {
      const data = await movementsReport(range, itemId, null);
      const names = new Map(
        data.byItem.map((row) => [row.itemId, { code: row.code, label: product(row) }]),
      );
      return {
        name: t("reports.nav.movements").toLowerCase(),
        compares: false,
        summary: [
          { label: t("reports.movements.unitsIn"), value: data.qtyIn, format: "int" },
          { label: t("reports.movements.unitsOut"), value: data.qtyOut, format: "int" },
          { label: t("reports.movements.products"), value: data.byItem.length, format: "int" },
        ],
        notes: [t("reports.movements.note")],
        tables: [
          {
            title: t("reports.movements.ledgerTitle"),
            columns: [
              { label: t("reports.movements.when"), width: 22 },
              { label: t("items.code"), width: 12 },
              { label: t("sell.item"), width: 32 },
              { label: t("reports.movements.type"), width: 16 },
              { label: t("common.quantity"), format: "int" },
              { label: t("receive.lot"), width: 14 },
              { label: t("receive.expiry"), width: 12 },
              { label: t("reports.movements.document"), width: 16 },
              { label: t("reports.movements.by"), width: 20 },
              { label: t("reports.movements.reason"), width: 30 },
            ],
            rows: data.movements.map((movement) => [
              // ISO, not a formatted date: a spreadsheet sorts this correctly and a
              // localised one sorts alphabetically.
              movement.createdAt.toISOString(),
              names.get(movement.itemId)?.code ?? "",
              names.get(movement.itemId)?.label ?? "",
              t(`movementType.${movement.type}`),
              movement.qtyDelta,
              movement.lotNumber ?? "",
              movement.expiryDate,
              movement.document ?? "",
              movement.performedBy,
              movement.reason ?? "",
            ]),
          },
          {
            title: t("reports.movements.byItem"),
            columns: [
              { label: t("items.code"), width: 12 },
              { label: t("sell.item"), width: 32 },
              { label: t("reports.movements.unitsIn"), format: "int" },
              { label: t("reports.movements.unitsOut"), format: "int" },
              { label: t("reports.movements.net"), format: "int" },
              { label: t("reports.movements.events"), format: "int" },
            ],
            rows: data.byItem.map((row) => [row.code, product(row), row.qtyIn, row.qtyOut, row.net, row.events]),
            totals: [
              t("reports.table.total"),
              null,
              data.qtyIn,
              data.qtyOut,
              data.qtyIn - data.qtyOut,
              data.byItem.reduce((sum, r) => sum + r.events, 0),
            ],
          },
        ],
      };
    }

    case "margin": {
      const data = await marginReport(range);
      const s = data.summary;
      const p = data.previousSummary;
      return {
        name: t("reports.nav.margin").toLowerCase(),
        compares: true,
        previousRange: data.previousRange,
        summary: [
          { label: t("reports.margin.revenue"), value: s.revenue, format: "money", previous: p.revenue },
          { label: t("reports.margin.cost"), value: s.cost, format: "money", previous: p.cost },
          { label: t("reports.margin.margin"), value: s.margin, format: "money", previous: p.margin },
          { label: t("reports.margin.marginPercent"), value: s.marginBps, format: "percent", previous: p.revenue > 0 ? p.marginBps : null },
        ],
        notes: [
          t("reports.margin.costNote"),
          t("reports.margin.netOfReturns"),
          t("reports.margin.netOfDiscount"),
          ...(s.uncostedRevenue > 0
            ? [t("reports.margin.uncosted", { revenue: formatMoney(s.uncostedRevenue) })]
            : []),
        ],
        tables: [
          {
            title: t("reports.margin.byItem"),
            columns: [
              { label: t("items.code"), width: 12 },
              { label: t("sell.item"), width: 34 },
              { label: t("items.category"), width: 18 },
              { label: t("common.quantity"), format: "int" },
              { label: t("reports.margin.revenue"), format: "money", width: 16 },
              { label: t("reports.margin.cost"), format: "money", width: 16 },
              { label: t("reports.margin.margin"), format: "money", width: 16 },
              { label: t("reports.margin.marginPercent"), format: "percent" },
            ],
            rows: data.byItem.map((row) => [
              row.code,
              product(row),
              row.categoryName,
              row.marginQty,
              row.marginRevenue,
              row.cost,
              row.margin,
              row.marginBps,
            ]),
            totals: [
              t("reports.table.total"),
              null,
              null,
              data.byItem.reduce((sum, r) => sum + r.marginQty, 0),
              s.revenue,
              s.cost,
              s.margin,
              s.marginBps,
            ],
          },
          {
            title: t("reports.margin.byCategory"),
            columns: [
              { label: t("items.category"), width: 24 },
              { label: t("reports.margin.revenue"), format: "money", width: 16 },
              { label: t("reports.margin.cost"), format: "money", width: 16 },
              { label: t("reports.margin.margin"), format: "money", width: 16 },
              { label: t("reports.margin.marginPercent"), format: "percent" },
            ],
            rows: data.byCategory.map((row) => [
              row.name || t("reports.table.uncategorised"),
              row.revenue,
              row.cost,
              row.margin,
              row.marginBps,
            ]),
            totals: [t("reports.table.total"), s.revenue, s.cost, s.margin, s.marginBps],
          },
        ],
      };
    }

    case "valuation": {
      const data = await valuationReport();
      const horizons = ["expired", "within30", "within90", "within180", "beyond"] as const;
      return {
        name: t("reports.nav.valuation").toLowerCase(),
        compares: false,
        summary: [
          { label: t("reports.valuation.total"), value: data.total, format: "money" },
          { label: t("reports.valuation.units"), value: data.units, format: "int" },
          {
            label: t("reports.valuation.horizon.expired"),
            value: data.byExpiry.expired.value,
            format: "money",
          },
        ],
        notes: [t("reports.valuation.nowOnly"), t("reports.valuation.quarantineNote")],
        tables: [
          {
            title: t("reports.valuation.byCategory"),
            columns: [
              { label: t("items.category"), width: 24 },
              { label: t("reports.valuation.batches"), format: "int" },
              { label: t("reports.valuation.units"), format: "int" },
              { label: t("reports.valuation.total"), format: "money", width: 16 },
            ],
            rows: data.byCategory.map((row) => [
              row.name || t("reports.table.uncategorised"),
              row.batches,
              row.units,
              row.value,
            ]),
            totals: [
              t("reports.table.total"),
              data.byCategory.reduce((sum, r) => sum + r.batches, 0),
              data.units,
              data.total,
            ],
          },
          {
            title: t("reports.valuation.byExpiry"),
            columns: [
              { label: t("reports.valuation.horizonColumn"), width: 22 },
              { label: t("reports.valuation.units"), format: "int" },
              { label: t("reports.valuation.total"), format: "money", width: 16 },
            ],
            rows: horizons.map((key) => [
              t(`reports.valuation.horizon.${key}`),
              data.byExpiry[key].units,
              data.byExpiry[key].value,
            ]),
          },
        ],
      };
    }

    case "expiry": {
      const data = await expiryLossReport(range);
      return {
        name: t("reports.nav.expiry").toLowerCase(),
        compares: false,
        summary: [
          { label: t("reports.expiry.total"), value: data.total, format: "money" },
          { label: t("reports.expiry.units"), value: data.units, format: "int" },
        ],
        notes: [t("reports.expiry.note")],
        tables: [
          {
            title: t("reports.expiry.byItem"),
            columns: [
              { label: t("items.code"), width: 12 },
              { label: t("sell.item"), width: 34 },
              { label: t("items.category"), width: 18 },
              { label: t("reports.expiry.units"), format: "int" },
              { label: t("reports.expiry.events"), format: "int" },
              { label: t("reports.expiry.total"), format: "money", width: 16 },
            ],
            rows: data.byItem.map((row) => [
              row.code,
              product(row),
              row.categoryName,
              row.qty,
              row.events,
              row.value,
            ]),
            totals: [
              t("reports.table.total"),
              null,
              null,
              data.units,
              data.byItem.reduce((sum, r) => sum + r.events, 0),
              data.total,
            ],
          },
          {
            title: t("reports.expiry.byMonth"),
            columns: [
              { label: t("reports.expiry.month"), width: 12 },
              { label: t("reports.expiry.units"), format: "int" },
              { label: t("reports.expiry.total"), format: "money", width: 16 },
            ],
            rows: data.byMonth.map((row) => [row.month, row.qty, row.value]),
          },
          {
            title: t("reports.expiry.byReason"),
            columns: [
              { label: t("reports.expiry.reason"), width: 30 },
              { label: t("reports.expiry.events"), format: "int" },
              { label: t("reports.expiry.total"), format: "money", width: 16 },
            ],
            rows: data.byReason.map((row) => [row.reason, row.events, row.value]),
          },
        ],
      };
    }

    case "suppliers": {
      const data = await supplierReport(range);
      return {
        name: t("reports.nav.suppliers").toLowerCase(),
        compares: false,
        summary: [
          { label: t("reports.suppliers.value"), value: data.total, format: "money" },
          { label: t("reports.suppliers.disposed"), value: data.disposed, format: "money" },
        ],
        notes: [t("reports.suppliers.note")],
        tables: [
          {
            title: t("reports.suppliers.received"),
            columns: [
              { label: t("stock.supplier"), width: 28 },
              { label: t("reports.suppliers.deliveries"), format: "int" },
              { label: t("reports.suppliers.unitsReceived"), format: "int" },
              { label: t("reports.suppliers.value"), format: "money", width: 16 },
              { label: t("reports.suppliers.remaining"), format: "int" },
              { label: t("reports.suppliers.disposed"), format: "money", width: 16 },
              { label: t("reports.suppliers.disposalRate"), format: "percent" },
            ],
            rows: data.rows.map((row) => [
              row.name,
              row.deliveries,
              row.units,
              row.value,
              row.remaining,
              row.disposedValue,
              row.disposalBps,
            ]),
            totals: [
              t("reports.table.total"),
              data.rows.reduce((sum, r) => sum + r.deliveries, 0),
              data.rows.reduce((sum, r) => sum + r.units, 0),
              data.total,
              data.rows.reduce((sum, r) => sum + r.remaining, 0),
              data.disposed,
              data.total > 0 ? Math.round((data.disposed / data.total) * 10_000) : 0,
            ],
          },
        ],
      };
    }
  }
}
