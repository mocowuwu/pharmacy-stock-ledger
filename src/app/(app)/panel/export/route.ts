import { getTranslations } from "next-intl/server";
import { panelExport } from "@/lib/dal/panel";
import { AuthenticationError, getCurrentSession, PermissionError } from "@/lib/dal/session";
import { getSettings } from "@/lib/dal/settings";
import { csvFilename, csvHeaders, toCsv } from "@/lib/format/csv";
import { formatDateTime } from "@/lib/format/date";
import { buildXlsx } from "@/lib/format/xlsx";
import { buildPanelExportModel } from "@/lib/panel/export";
import { resolveRange } from "@/lib/reports/catalogue";
import { csvRows, workbook } from "@/lib/reports/export-file";

/**
 * The panel's downloads: CSV, or an Excel workbook with `format=xlsx`.
 *
 * Built exactly like the reports' -- one description of the tables, written as
 * either file -- and from the same DAL the screen uses, so the permission and
 * the cost redaction are the screen's. A route handler is as exposed as a page.
 * The window is read by `resolveRange`, the reports' own reading of a period, so
 * the file covers what the person was looking at, and every row in it, not
 * only the first screen of them.
 *
 * Money is a plain integer in both files: `15000` in the CSV, a number cell in
 * the workbook, so a column of it sums.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const range = resolveRange({
    preset: url.searchParams.get("preset") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });

  try {
    const data = await panelExport(range);
    const t = await getTranslations();
    const model = buildPanelExportModel(t, data);
    const filename = csvFilename(model.name, range.from, range.to);

    if (url.searchParams.get("format") === "xlsx") {
      const session = await getCurrentSession();
      const settings = await getSettings();
      const sheets = workbook(model, {
        business: settings.businessName || t("app.name"),
        title: t("panel.title"),
        period: range.from === range.to ? range.from : `${range.from} — ${range.to}`,
        previous: null,
        printed: t("reports.workbook.generatedBy", {
          name: session?.user.fullName ?? "",
          when: formatDateTime(new Date(), session?.user.locale ?? "id"),
        }),
        labels: {
          summary: t("reports.workbook.summarySheet"),
          figure: t("reports.workbook.figure"),
          value: t("reports.workbook.thisPeriod"),
          previous: t("reports.workbook.previousPeriod"),
          change: t("reports.workbook.change"),
          comparedWith: t("reports.workbook.comparedWith"),
          notes: t("reports.workbook.notes"),
        },
      });
      return new Response(Buffer.from(buildXlsx(sheets)), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename.replace(/\.csv$/u, ".xlsx")}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const [primary] = model.tables;
    return new Response(toCsv(primary.columns.map((column) => column.label), csvRows(primary)), {
      headers: csvHeaders(filename),
    });
  } catch (error) {
    if (error instanceof PermissionError) return new Response("Forbidden", { status: 403 });
    if (error instanceof AuthenticationError) return new Response("Unauthorized", { status: 401 });
    throw error;
  }
}
