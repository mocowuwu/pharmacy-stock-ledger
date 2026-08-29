import { getTranslations } from "next-intl/server";
import {
  expiryLossReport,
  isReportSlug,
  marginReport,
  resolveRange,
  salesReport,
  supplierReport,
  valuationReport,
  type ReportSlug,
} from "@/lib/dal/reports";
import { PermissionError } from "@/lib/dal/session";
import { csvFilename, csvHeaders, toCsv, type CsvRow } from "@/lib/format/csv";
import { today } from "@/lib/format/date";

/**
 * CSV export.
 *
 * It calls the same DAL functions the screen does, so the permission check is
 * the same one: a route handler is exactly as exposed as a page and gets no
 * special trust because a link happens to point at it.
 *
 * Headers are translated -- the person opening the file reads the same language
 * as the person who downloaded it -- while the data is never translated: item
 * names, lot numbers and typed reasons go out exactly as they were entered.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ report: string }> },
) {
  const { report } = await params;
  if (!isReportSlug(report)) {
    return new Response("Not found", { status: 404 });
  }

  const url = new URL(request.url);
  const range = resolveRange({
    preset: url.searchParams.get("preset") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });

  try {
    const { header, rows, name } = await build(report, range);
    const filename = csvFilename(
      name,
      report === "valuation" ? today() : range.from,
      report === "valuation" ? today() : range.to,
    );

    return new Response(toCsv(header, rows), { headers: csvHeaders(filename) });
  } catch (error) {
    if (error instanceof PermissionError) {
      return new Response("Forbidden", { status: 403 });
    }
    throw error;
  }
}

async function build(
  report: ReportSlug,
  range: { from: string; to: string },
): Promise<{ header: CsvRow; rows: CsvRow[]; name: string }> {
  const t = await getTranslations();

  switch (report) {
    case "sales": {
      const data = await salesReport(range);
      return {
        name: t("reports.nav.sales").toLowerCase(),
        header: [
          t("items.code"),
          t("sell.item"),
          t("items.category"),
          t("common.quantity"),
          t("reports.sales.returned"),
          t("reports.sales.netUnits"),
          t("reports.sales.revenue"),
          t("reports.sales.refunds"),
          t("reports.sales.netRevenue"),
        ],
        rows: data.byItem.map((row) => [
          row.code,
          `${row.name}${row.strength ? ` ${row.strength}` : ""}`,
          row.categoryName,
          row.qtySold,
          row.qtyReturned,
          row.qtyNet,
          row.revenue,
          row.refunded,
          row.revenueNet,
        ]),
      };
    }

    case "margin": {
      const data = await marginReport(range);
      return {
        name: t("reports.nav.margin").toLowerCase(),
        header: [
          t("items.code"),
          t("sell.item"),
          t("items.category"),
          t("common.quantity"),
          t("reports.margin.revenue"),
          t("reports.margin.cost"),
          t("reports.margin.margin"),
          t("reports.margin.marginPercent"),
        ],
        rows: data.byItem.map((row) => [
          row.code,
          `${row.name}${row.strength ? ` ${row.strength}` : ""}`,
          row.categoryName,
          row.qtyNet,
          row.revenue,
          row.cost,
          row.margin,
          // Two decimals as a plain number, so a spreadsheet can chart it.
          (row.marginBps / 100).toFixed(2),
        ]),
      };
    }

    case "valuation": {
      const data = await valuationReport();
      return {
        name: t("reports.nav.valuation").toLowerCase(),
        header: [
          t("items.category"),
          t("reports.valuation.batches"),
          t("reports.valuation.units"),
          t("reports.valuation.total"),
        ],
        rows: data.byCategory.map((row) => [
          row.name,
          row.batches,
          row.units,
          row.value,
        ]),
      };
    }

    case "expiry": {
      const data = await expiryLossReport(range);
      return {
        name: t("reports.nav.expiry").toLowerCase(),
        header: [
          t("items.code"),
          t("sell.item"),
          t("items.category"),
          t("reports.expiry.units"),
          t("reports.expiry.events"),
          t("reports.expiry.total"),
        ],
        rows: data.byItem.map((row) => [
          row.code,
          `${row.name}${row.strength ? ` ${row.strength}` : ""}`,
          row.categoryName,
          row.qty,
          row.events,
          row.value,
        ]),
      };
    }

    case "suppliers": {
      const data = await supplierReport(range);
      return {
        name: t("reports.nav.suppliers").toLowerCase(),
        header: [
          t("stock.supplier"),
          t("reports.suppliers.deliveries"),
          t("reports.suppliers.unitsReceived"),
          t("reports.suppliers.value"),
          t("reports.suppliers.remaining"),
          t("reports.suppliers.disposed"),
          t("reports.suppliers.disposalRate"),
        ],
        rows: data.rows.map((row) => [
          row.name,
          row.deliveries,
          row.units,
          row.value,
          row.remaining,
          row.disposedValue,
          (row.disposalBps / 100).toFixed(2),
        ]),
      };
    }
  }
}
