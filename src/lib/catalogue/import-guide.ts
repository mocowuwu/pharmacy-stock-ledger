import { DOSAGE_FORMS, DRUG_CLASSES } from "./enums";
import { IMPORT_COLUMNS, MAX_IMPORT_ROWS, type ImportColumn } from "./import";
import type { XlsxRow, XlsxSheet } from "@/lib/format/xlsx";

/**
 * The import template: a data sheet to fill in, and a second sheet that says
 * what every column wants.
 *
 * The column names on the data sheet are fixed English identifiers -- a
 * machine-matched contract with `parseImportCsv` -- so the second sheet is
 * where a person learns what `drug_class` means and which values it accepts.
 * Its wording is translated, in the language of whoever downloads it; the
 * identifiers and the accepted values are not.
 */

export type Translate = (key: string, values?: Record<string, string | number>) => string;

/** A filled-in example, shown on row 2 of the data sheet. */
export const IMPORT_EXAMPLE: Record<ImportColumn, string> = {
  code: "AMOX001",
  generic_name: "Amoxicillin",
  brand_name: "Generik",
  form: "capsule",
  strength: "500 mg",
  unit: "kapsul",
  pack_size: "10",
  category: "",
  drug_class: "bebas_terbatas",
  nie: "",
  is_tax_exempt: "0",
  reorder_point: "0",
  reorder_qty: "",
  default_price: "12000",
  min_shelf_life_days: "",
  barcode: "",
  notes: "",
  lot_number: "LOT-001",
  expiry_date: "2027-12-31",
  qty: "100",
  unit_cost: "9000",
  supplier: "Saldo Awal",
};

/**
 * What each column needs. `batch` columns are the opening-stock group: leave
 * them all blank to add the item alone, but fill any one and the rest of the
 * required ones follow (see `validateImportRows`).
 */
export const IMPORT_REQUIREMENT: Record<ImportColumn, "required" | "optional" | "batchRequired"> = {
  code: "optional",
  generic_name: "required",
  brand_name: "optional",
  form: "required",
  strength: "optional",
  unit: "required",
  pack_size: "optional",
  category: "optional",
  drug_class: "required",
  nie: "optional",
  is_tax_exempt: "optional",
  reorder_point: "optional",
  reorder_qty: "optional",
  default_price: "optional",
  min_shelf_life_days: "optional",
  barcode: "optional",
  notes: "optional",
  lot_number: "optional",
  expiry_date: "batchRequired",
  qty: "batchRequired",
  unit_cost: "optional",
  supplier: "batchRequired",
};

/** The guide has five columns; anything wider than this is a merged sentence. */
const GUIDE_WIDTHS = [24, 20, 48, 52, 22];
const TOTAL_WIDTH = GUIDE_WIDTHS.reduce((a, b) => a + b, 0);

/** Points of height for a merged, wrapped sentence, since Excel will not fit it. */
function heightFor(text: string, widthChars = TOTAL_WIDTH): number {
  const lines = Math.max(1, Math.ceil(text.length / (widthChars * 0.95)));
  return 16 * lines + 4;
}

export function buildImportTemplateSheets(t: Translate): XlsxSheet[] {
  const columns = [...IMPORT_COLUMNS];

  const data: XlsxSheet = {
    name: t("itemsImport.guide.sheetData"),
    widths: columns.map((c) => Math.max(14, c.length + 4)),
    textColumns: true,
    freezeHeader: true,
    rows: [
      { cells: columns, style: "header" },
      {
        // The one free-text column is where the row says it is only an example.
        cells: columns.map((c) => (c === "notes" ? t("itemsImport.guide.exampleNote") : IMPORT_EXAMPLE[c])),
      },
    ],
  };

  const guideRows: XlsxRow[] = [];
  const sentence = (text: string, style: XlsxRow["style"] = "wrap") =>
    guideRows.push({ cells: [text], style, span: GUIDE_WIDTHS.length, height: heightFor(text) });

  guideRows.push({ cells: [t("itemsImport.guide.title")], style: "title", height: 26 });
  sentence(t("itemsImport.guide.intro"), "note");
  guideRows.push({ cells: [] });

  guideRows.push({ cells: [t("itemsImport.guide.howTitle")], style: "section", span: GUIDE_WIDTHS.length });
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    sentence(`${n}. ${t(`itemsImport.guide.how.${n}`, { max: MAX_IMPORT_ROWS.toLocaleString("id-ID") })}`);
  }
  guideRows.push({ cells: [] });

  guideRows.push({ cells: [t("itemsImport.guide.columnsTitle")], style: "section", span: GUIDE_WIDTHS.length });
  guideRows.push({
    cells: ["column", "required", "meaning", "accepted", "example"].map((k) =>
      t(`itemsImport.guide.head.${k}`),
    ),
    style: "header",
    height: 22,
  });
  for (const column of columns) {
    guideRows.push({
      cells: [
        column,
        t(`itemsImport.guide.requirement.${IMPORT_REQUIREMENT[column]}`),
        t(`itemsImport.guide.columns.${column}.meaning`),
        t(`itemsImport.guide.columns.${column}.accepted`),
        IMPORT_EXAMPLE[column],
      ],
      style: "wrap",
    });
  }
  guideRows.push({ cells: [] });

  guideRows.push({ cells: [t("itemsImport.guide.classTitle")], style: "section", span: GUIDE_WIDTHS.length });
  sentence(t("itemsImport.guide.classIntro"), "note");
  guideRows.push({
    cells: ["code", "name", "note"].map((k) => t(`itemsImport.guide.head.${k}`)),
    style: "header",
    height: 22,
  });
  for (const value of DRUG_CLASSES) {
    guideRows.push({
      cells: [value, t(`drugClass.${value}`), t(`itemsImport.guide.classNote.${value}`)],
      style: "wrap",
    });
  }
  guideRows.push({ cells: [] });

  guideRows.push({ cells: [t("itemsImport.guide.formTitle")], style: "section", span: GUIDE_WIDTHS.length });
  sentence(t("itemsImport.guide.formIntro"), "note");
  guideRows.push({
    cells: ["code", "name"].map((k) => t(`itemsImport.guide.head.${k}`)),
    style: "header",
    height: 22,
  });
  for (const value of DOSAGE_FORMS) {
    guideRows.push({ cells: [value, t(`dosageForm.${value}`)], style: "wrap" });
  }

  const guide: XlsxSheet = {
    name: t("itemsImport.guide.sheetGuide"),
    widths: GUIDE_WIDTHS,
    printFit: true,
    rows: guideRows,
  };

  return [data, guide];
}
