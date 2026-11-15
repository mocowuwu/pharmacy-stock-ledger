import { dayOf } from "@/lib/format/date";
import type { ExportModel, ExportTable } from "@/lib/reports/export-file";
import { panelAmounts } from "./amounts";
import type { PanelViewRow } from "./entries";

/**
 * What a panel download contains, as tables of plain values -- rupiah and
 * counts as integers -- for `src/lib/reports/export-file.ts` to write as CSV
 * (the first table) or as a workbook.
 *
 * Decisions worth knowing before changing it:
 *
 * - **Only entries that count are in the first table.** The CSV carries that
 *   table and a spreadsheet user sums a column. A voided entry never happened, a
 *   rejected one never will, and one still waiting for approval is not money
 *   yet, so none of them may sit in a column anyone sums. Voided entries go on a
 *   sheet of their own; waiting and rejected ones on another, with who decided
 *   and why.
 * - **Costs are only here for a reader who may see them.** The rows arrive
 *   already stripped of the unit cost by the DAL; this decides the *columns*,
 *   so a reader without `reports.financial` gets no empty "cost" headings.
 * - **PPN columns appear only when an order carries PPN**, so a pharmacy that
 *   charges none gets the file it always had.
 * - **The table adds up to the summary.** Its totals row is summed from its own
 *   rows, and a test holds it equal to the statement above it.
 */

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export type PanelExportData = {
  canSeeCost: boolean;
  rows: PanelViewRow[];
  totals: {
    entries: number;
    qty: number;
    revenue: number;
    tax: number;
    cost: number | null;
    margin: number | null;
  };
};

const cost = (row: PanelViewRow) => (row.unitCost === null ? null : row.qty * row.unitCost);

export function buildPanelExportModel(t: Translate, data: PanelExportData): ExportModel {
  const { canSeeCost, totals } = data;
  const counted = data.rows.filter((row) => row.voidedAt === null && row.status === "approved");
  const waiting = data.rows.filter((row) => row.voidedAt === null && row.status !== "approved");
  const voided = data.rows.filter((row) => row.voidedAt !== null);
  const hasTax = counted.some((row) => row.taxMode !== null);

  const money = { format: "money" as const, width: 16 };
  const entries: ExportTable = {
    title: t("panel.export.sheetEntries"),
    columns: [
      { label: t("panel.number"), width: 18 },
      { label: t("panel.date"), width: 12 },
      { label: t("panel.orderRef"), width: 20 },
      { label: t("panel.itemCode"), width: 12 },
      { label: t("panel.itemName"), width: 34 },
      { label: t("panel.unit"), width: 10 },
      { label: t("panel.qty"), format: "int" },
      { label: t("panel.unitPrice"), ...money },
      { label: t("panel.lineTotal"), ...money },
      ...(hasTax
        ? [
            { label: t("panel.export.tax"), ...money },
            { label: t("panel.export.taxMode"), width: 20 },
          ]
        : []),
      ...(canSeeCost
        ? [
            { label: t("panel.unitCost"), ...money },
            { label: t("panel.totalCost"), ...money },
            { label: t("panel.margin"), ...money },
          ]
        : []),
      { label: t("panel.destination"), width: 26 },
      { label: t("panel.partnerName"), width: 24 },
      { label: t("panel.pharmacist"), width: 24 },
      { label: t("panel.recordedBy"), width: 20 },
      { label: t("panel.notes"), width: 30 },
    ],
    rows: counted.map((row) => {
      const amounts = panelAmounts(row);
      return [
        row.entryNumber,
        row.entryDate,
        row.orderRef ?? "",
        row.itemCode,
        row.itemName,
        row.unit,
        row.qty,
        row.unitPrice,
        amounts.line,
        ...(hasTax
          ? [
              row.taxMode ? row.taxAmount : null,
              row.taxMode === "exclusive"
                ? t("panel.export.taxOnTop")
                : row.taxMode === "inclusive"
                  ? t("panel.export.taxInside")
                  : "",
            ]
          : []),
        // Margin is on what the pharmacy keeps: the price less any PPN inside it.
        ...(canSeeCost
          ? [row.unitCost, cost(row), row.unitCost === null ? null : amounts.net - (cost(row) ?? 0)]
          : []),
        row.destination ?? "",
        row.partnerName ?? "",
        row.pharmacist ?? "",
        row.recordedBy,
        row.notes ?? "",
      ];
    }),
  };

  // Money columns only: quantities in different units (tablets, bottles) do not
  // add up to anything, and the summary already states the item count.
  const revenue = counted.reduce((sum, row) => sum + panelAmounts(row).line, 0);
  const taxTotal = counted.reduce((sum, row) => sum + (row.taxMode ? row.taxAmount : 0), 0);
  const insideTotal = counted.reduce((sum, row) => sum + panelAmounts(row).taxInside, 0);
  const totalCost = counted.reduce((sum, row) => sum + (cost(row) ?? 0), 0);
  entries.totals = [
    t("reports.table.total"),
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    revenue,
    ...(hasTax ? [taxTotal, null] : []),
    ...(canSeeCost ? [null, totalCost, revenue - insideTotal - totalCost] : []),
    null,
    null,
    null,
    null,
    null,
  ];

  const tables: ExportTable[] = [entries];

  if (waiting.length > 0) {
    tables.push({
      title: t("panel.export.sheetPending"),
      columns: [
        { label: t("panel.number"), width: 18 },
        { label: t("panel.date"), width: 12 },
        { label: t("panel.orderRef"), width: 20 },
        { label: t("panel.itemCode"), width: 12 },
        { label: t("panel.itemName"), width: 34 },
        { label: t("panel.qty"), format: "int" },
        { label: t("panel.lineTotal"), ...money },
        { label: t("panel.destination"), width: 26 },
        { label: t("panel.recordedBy"), width: 20 },
        { label: t("panel.export.status"), width: 22 },
        { label: t("panel.export.decidedBy"), width: 20 },
        { label: t("panel.export.decisionNote"), width: 36 },
      ],
      rows: waiting.map((row) => [
        row.entryNumber,
        row.entryDate,
        row.orderRef ?? "",
        row.itemCode,
        row.itemName,
        row.qty,
        panelAmounts(row).line,
        row.destination ?? "",
        row.recordedBy,
        row.status === "pending" ? t("panel.statusPending") : t("panel.statusRejected"),
        row.decidedBy ?? "",
        row.decisionNote ?? "",
      ]),
    });
  }

  if (voided.length > 0) {
    tables.push({
      title: t("panel.export.sheetVoided"),
      columns: [
        { label: t("panel.number"), width: 18 },
        { label: t("panel.date"), width: 12 },
        { label: t("panel.orderRef"), width: 20 },
        { label: t("panel.itemCode"), width: 12 },
        { label: t("panel.itemName"), width: 34 },
        { label: t("panel.qty"), format: "int" },
        { label: t("panel.lineTotal"), ...money },
        { label: t("panel.destination"), width: 26 },
        { label: t("panel.recordedBy"), width: 20 },
        { label: t("panel.export.voidedBy"), width: 20 },
        { label: t("panel.export.voidedOn"), width: 12 },
        { label: t("panel.voidReason"), width: 36 },
      ],
      rows: voided.map((row) => [
        row.entryNumber,
        row.entryDate,
        row.orderRef ?? "",
        row.itemCode,
        row.itemName,
        row.qty,
        panelAmounts(row).line,
        row.destination ?? "",
        row.recordedBy,
        row.voidedBy ?? "",
        row.voidedAt ? dayOf(row.voidedAt) : "",
        row.voidReason ?? "",
      ]),
    });
  }

  return {
    // "Panel Apotek" -> "panel-apotek", the same in both languages.
    name: t("panel.title").toLowerCase().replace(/\s+/gu, "-"),
    compares: false,
    summary: [
      { label: t("panel.totalEntries"), value: totals.entries, format: "int" },
      { label: t("panel.totalQty"), value: totals.qty, format: "int" },
      { label: t("panel.totalRevenue"), value: totals.revenue, format: "money" },
      ...(totals.tax > 0 ? [{ label: t("panel.totalTax"), value: totals.tax, format: "money" as const }] : []),
      ...(totals.cost !== null
        ? [{ label: t("panel.totalCost"), value: totals.cost, format: "money" as const }]
        : []),
      ...(totals.margin !== null
        ? [{ label: t("panel.totalMargin"), value: totals.margin, format: "money" as const }]
        : []),
    ],
    notes: voided.length > 0 || waiting.length > 0 ? [t("panel.export.note")] : [],
    tables,
  };
}
