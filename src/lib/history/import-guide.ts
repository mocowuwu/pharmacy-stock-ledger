import { PAYMENT_METHODS } from "@/lib/catalogue/enums";
import type { XlsxRow, XlsxSheet } from "@/lib/format/xlsx";
import { HISTORY_COLUMNS, MAX_HISTORY_ROWS, type HistoryColumn } from "./import";

/**
 * The sales-history template: an empty sheet to fill in, and a guide.
 *
 * Unlike the catalogue template, the data sheet carries no example row. A
 * catalogue example left in by mistake is an item called "Amoxicillin" that
 * can be archived; a sales example left in is Rp 10.000 of takings that never
 * happened, added to a real month. The examples live on the guide sheet, where
 * nothing is read.
 */

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export const HISTORY_REQUIREMENT: Record<HistoryColumn, "required" | "optional" | "oneOf"> = {
  date: "required",
  receipt_number: "optional",
  item_code: "oneOf",
  item_name: "oneOf",
  qty: "required",
  unit_price: "oneOf",
  line_total: "oneOf",
  unit_cost: "optional",
  payment_method: "optional",
  cashier: "optional",
};

/** Three lines of two old sales, as they would be typed. */
export const HISTORY_EXAMPLES: Array<Record<HistoryColumn, string>> = [
  {
    date: "2026-08-01",
    receipt_number: "NT-0001",
    item_code: "PARA001",
    item_name: "",
    qty: "10",
    unit_price: "1000",
    line_total: "10000",
    unit_cost: "400",
    payment_method: "tunai",
    cashier: "Siti",
  },
  {
    date: "2026-08-01",
    receipt_number: "NT-0001",
    item_code: "",
    item_name: "Vitamin C 500 mg",
    qty: "2",
    unit_price: "",
    line_total: "9000",
    unit_cost: "",
    payment_method: "tunai",
    cashier: "Siti",
  },
  {
    date: "2026-08-02",
    receipt_number: "",
    item_code: "",
    item_name: "Amoxicillin 500 mg",
    qty: "30",
    unit_price: "2500",
    line_total: "",
    unit_cost: "1200",
    payment_method: "qris",
    cashier: "",
  },
];

const GUIDE_WIDTHS = [20, 18, 50, 50, 20];
const TOTAL_WIDTH = GUIDE_WIDTHS.reduce((a, b) => a + b, 0);

function heightFor(text: string, widthChars = TOTAL_WIDTH): number {
  const lines = Math.max(1, Math.ceil(text.length / (widthChars * 0.95)));
  return 16 * lines + 4;
}

export function buildHistoryTemplateSheets(t: Translate): XlsxSheet[] {
  const columns = [...HISTORY_COLUMNS];

  const data: XlsxSheet = {
    name: t("historyImport.guide.sheetData"),
    widths: columns.map((c) => (c === "item_name" ? 32 : Math.max(14, c.length + 4))),
    textColumns: true,
    freezeHeader: true,
    rows: [{ cells: columns, style: "header" }],
  };

  const rows: XlsxRow[] = [];
  const sentence = (text: string, style: XlsxRow["style"] = "wrap") =>
    rows.push({ cells: [text], style, span: GUIDE_WIDTHS.length, height: heightFor(text) });

  rows.push({ cells: [t("historyImport.guide.title")], style: "title", height: 26 });
  sentence(t("historyImport.guide.intro"), "note");
  rows.push({ cells: [] });

  rows.push({ cells: [t("historyImport.guide.howTitle")], style: "section", span: GUIDE_WIDTHS.length });
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
    sentence(
      `${n}. ${t(`historyImport.guide.how.${n}`, { max: MAX_HISTORY_ROWS.toLocaleString("id-ID") })}`,
    );
  }
  rows.push({ cells: [] });

  rows.push({ cells: [t("historyImport.guide.columnsTitle")], style: "section", span: GUIDE_WIDTHS.length });
  rows.push({
    cells: ["column", "required", "meaning", "accepted", "example"].map((k) =>
      t(`historyImport.guide.head.${k}`),
    ),
    style: "header",
    height: 22,
  });
  for (const column of columns) {
    rows.push({
      cells: [
        column,
        t(`historyImport.guide.requirement.${HISTORY_REQUIREMENT[column]}`),
        t(`historyImport.guide.columns.${column}.meaning`),
        t(`historyImport.guide.columns.${column}.accepted`),
        HISTORY_EXAMPLES[0][column] || HISTORY_EXAMPLES[1][column],
      ],
      style: "wrap",
    });
  }
  rows.push({ cells: [] });

  rows.push({ cells: [t("historyImport.guide.examplesTitle")], style: "section", span: GUIDE_WIDTHS.length });
  sentence(t("historyImport.guide.examplesIntro"), "note");
  rows.push({ cells: columns, style: "header", height: 22 });
  for (const example of HISTORY_EXAMPLES) {
    rows.push({ cells: columns.map((c) => example[c]), style: "wrap" });
  }
  rows.push({ cells: [] });

  rows.push({ cells: [t("historyImport.guide.paymentTitle")], style: "section", span: GUIDE_WIDTHS.length });
  sentence(t("historyImport.guide.paymentIntro"), "note");
  rows.push({
    cells: ["code", "name"].map((k) => t(`historyImport.guide.head.${k}`)),
    style: "header",
    height: 22,
  });
  for (const method of PAYMENT_METHODS) {
    rows.push({ cells: [method, t(`paymentMethod.${method}`)], style: "wrap" });
  }

  const guide: XlsxSheet = {
    name: t("historyImport.guide.sheetGuide"),
    // The examples table is ten columns wide; the explanations use five.
    widths: [...GUIDE_WIDTHS, 14, 14, 14, 14, 14],
    printFit: true,
    rows,
  };

  return [data, guide];
}
