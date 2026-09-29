import { getTranslations } from "next-intl/server";
import { isReportSlug, resolveRange } from "@/lib/dal/reports";
import { AuthenticationError, getCurrentSession, PermissionError } from "@/lib/dal/session";
import { getSettings } from "@/lib/dal/settings";
import { csvFilename, csvHeaders, toCsv, type CsvRow } from "@/lib/format/csv";
import { formatDateTime, today } from "@/lib/format/date";
import { isUuid } from "@/lib/format/ids";
import { buildXlsx, type XlsxRow, type XlsxSheet } from "@/lib/format/xlsx";
import { changeBps } from "@/lib/reports/analysis";
import { buildExportModel, type ExportModel, type ExportTable } from "./model";

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

/** Percentages as a plain two-decimal number, so a spreadsheet can chart them. */
function csvRows(table: ExportTable): CsvRow[] {
  return table.rows.map((row) =>
    row.map((value, i) =>
      table.columns[i]?.format === "percent" && typeof value === "number"
        ? (value / 100).toFixed(2)
        : value,
    ),
  );
}

/** Basis points to the fraction a percent-formatted cell expects. */
function cell(value: string | number | null, format?: string) {
  return format === "percent" && typeof value === "number" ? value / 10_000 : value;
}

function workbook(
  model: ExportModel,
  head: {
    business: string;
    title: string;
    period: string;
    previous: string | null;
    printed: string;
    labels: Record<"summary" | "figure" | "value" | "previous" | "change" | "comparedWith" | "notes", string>;
  },
): XlsxSheet[] {
  // Every sheet opens with the same three lines, so a sheet copied out of the
  // workbook still says whose figures they are and for when.
  const letterhead = (): XlsxRow[] => [
    { cells: [head.business], style: "title", height: 24 },
    { cells: [`${head.title} · ${head.period}`], style: "section" },
    { cells: [head.printed], style: "note" },
    { cells: [] },
  ];

  const summaryRows: XlsxRow[] = [...letterhead()];
  if (model.compares && head.previous) {
    summaryRows.push({ cells: [`${head.labels.comparedWith} ${head.previous}`], style: "note" }, { cells: [] });
  }
  summaryRows.push({
    cells: model.compares
      ? [head.labels.figure, head.labels.value, head.labels.previous, head.labels.change]
      : [head.labels.figure, head.labels.value],
    style: "header",
    height: 20,
  });
  for (const line of model.summary) {
    const hasPrevious = line.previous !== undefined && line.previous !== null;
    // A percentage's change is in points, which the "Previous" column already
    // shows; a relative change of a percentage would be a number nobody reads.
    const change =
      model.compares && hasPrevious && line.format !== "percent"
        ? changeBps(line.value, line.previous as number)
        : null;
    const format = line.format === "percent" ? "percent" : "int";
    summaryRows.push({
      cells: model.compares
        ? [
            line.label,
            cell(line.value, line.format),
            hasPrevious ? cell(line.previous as number, line.format) : null,
            change === null ? null : change / 10_000,
          ]
        : [line.label, cell(line.value, line.format)],
      formats: [undefined, format, format, "percent"],
    });
  }
  if (model.notes.length > 0) {
    summaryRows.push({ cells: [] }, { cells: [head.labels.notes], style: "section" });
    for (const note of model.notes) summaryRows.push({ cells: [note], style: "note", span: 4, height: 32 });
  }

  const summary: XlsxSheet = {
    name: head.labels.summary,
    widths: [36, 18, 18, 12],
    rows: summaryRows,
  };

  const tables = model.tables.map((table): XlsxSheet => {
    const headerRow = letterhead().length;
    return {
      name: table.title,
      widths: table.columns.map((column) => column.width ?? (column.format ? 14 : 20)),
      formats: table.columns.map((column) =>
        column.format === "text" || !column.format ? undefined : column.format,
      ),
      freezeRows: headerRow + 1,
      rows: [
        ...letterhead(),
        { cells: table.columns.map((column) => column.label), style: "header", height: 20 },
        ...table.rows.map((row) => ({
          cells: row.map((value, i) => cell(value, table.columns[i]?.format)),
        })),
        ...(table.totals
          ? [
              {
                cells: table.totals.map((value, i) => cell(value, table.columns[i]?.format)),
                style: "total" as const,
              },
            ]
          : []),
      ],
    };
  });

  return [summary, ...tables];
}
