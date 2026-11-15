import { getTranslations } from "next-intl/server";
import { isReportSlug, resolveRange } from "@/lib/dal/reports";
import { AuthenticationError, getCurrentSession, PermissionError } from "@/lib/dal/session";
import { getSettings } from "@/lib/dal/settings";
import { csvFilename, csvHeaders, toCsv } from "@/lib/format/csv";
import { formatDateTime, today } from "@/lib/format/date";
import { isUuid } from "@/lib/format/ids";
import { buildXlsx } from "@/lib/format/xlsx";
import { csvRows, workbook } from "@/lib/reports/export-file";
import { buildExportModel } from "./model";

/**
 * The downloads: CSV, or an Excel workbook with `format=xlsx`.
 *
 * Both call the same DAL functions the screen does, so the permission check is
 * the same one: a route handler is exactly as exposed as a page and gets no
 * special trust because a link happens to point at it.
 *
 * Headers are translated -- the person opening the file reads the same language
 * as the person who downloaded it -- while the data is never translated: item
 * names, lot numbers and typed reasons go out exactly as they were entered.
 *
 * Money is a plain integer in both. In CSV it is `15000`, never `Rp 15.000`;
 * in the workbook it is a number cell shown with thousands grouping, so a
 * column of it sums.
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
  const from = report === "valuation" ? today() : range.from;
  const to = report === "valuation" ? today() : range.to;

  try {
    const t = await getTranslations();
    const item = url.searchParams.get("item");
    const model = await buildExportModel(t, report, range, isUuid(item) ? item : undefined);

    if (url.searchParams.get("format") === "xlsx") {
      const session = await getCurrentSession();
      const settings = await getSettings();
      const sheets = workbook(model, {
        business: settings.businessName || t("app.name"),
        title: t(`reports.nav.${report}`),
        period: from === to ? from : `${from} — ${to}`,
        previous: model.previousRange ? `${model.previousRange.from} — ${model.previousRange.to}` : null,
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
      const filename = csvFilename(model.name, from, to).replace(/\.csv$/u, ".xlsx");
      return new Response(Buffer.from(buildXlsx(sheets)), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const [primary] = model.tables;
    return new Response(toCsv(primary.columns.map((c) => c.label), csvRows(primary)), {
      headers: csvHeaders(csvFilename(model.name, from, to)),
    });
  } catch (error) {
    if (error instanceof PermissionError) {
      return new Response("Forbidden", { status: 403 });
    }
    if (error instanceof AuthenticationError) {
      return new Response("Unauthorized", { status: 401 });
    }
    throw error;
  }
}
