import type { XlsxRow, XlsxSheet } from "@/lib/format/xlsx";
import { changeBps } from "@/lib/reports/analysis";

/**
 * What an export contains, independent of the file format, and how that
 * description becomes a file.
 *
 * Each export is described once as tables of plain values -- rupiah and counts
 * as integers, percentages as basis points -- and written as CSV (the first
 * table) or as a workbook (a summary sheet, then a sheet per table). The
 * reports and the panel both describe themselves this way, which is why this
 * lives here and not in either route: a second copy of the workbook layout is
 * a second place for the letterhead to drift.
 */

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

export type WorkbookHead = {
  business: string;
  title: string;
  period: string;
  previous: string | null;
  printed: string;
  labels: Record<"summary" | "figure" | "value" | "previous" | "change" | "comparedWith" | "notes", string>;
};

/** Percentages as a plain two-decimal number, so a spreadsheet can chart them. */
export function csvRows(table: ExportTable): Array<Array<string | number | null>> {
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

export function workbook(model: ExportModel, head: WorkbookHead): XlsxSheet[] {
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
