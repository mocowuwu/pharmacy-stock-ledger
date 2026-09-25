import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { createTestDb, type TestDb } from "./helpers/db";
import { suppliers } from "@/db/schema";
import type { Executor } from "@/lib/stock/ledger";
import { DOSAGE_FORMS, DRUG_CLASSES } from "@/lib/catalogue/enums";
import {
  IMPORT_COLUMNS,
  importFileToCsv,
  parseImportCsv,
  validateImportRows,
} from "@/lib/catalogue/import";
import { buildImportTemplateSheets, type Translate } from "@/lib/catalogue/import-guide";
import { buildXlsx, readFirstSheet } from "@/lib/format/xlsx";
import id from "@/i18n/messages/id.json";
import en from "@/i18n/messages/en.json";

let db: TestDb;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(suppliers).values({ name: "Saldo Awal", isSystem: true });
});

afterAll(async () => {
  await close();
});

/** A translator over a real message catalogue, resolving dotted keys and {vars}. */
function translator(messages: unknown): Translate {
  return (key, values) => {
    const found = key
      .split(".")
      .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);
    if (typeof found !== "string") throw new Error(`missing message: ${key}`);
    return found.replace(/\{(\w+)\}/gu, (_, name: string) => String(values?.[name] ?? `{${name}}`));
  };
}

describe("xlsx round trip", () => {
  it("keeps text exactly: leading zeros, dates, markup and accents", () => {
    const rows = [
      ["code", "barcode", "expiry_date", "notes"],
      ["A&B", "0012345678905", "2027-12-31", 'Tablet <500 mg> "salut" — Ünïcode'],
    ];
    const bytes = buildXlsx([
      { name: "Data", widths: [10, 10, 10, 10], rows: rows.map((cells) => ({ cells })) },
    ]);
    expect(readFirstSheet(bytes)).toEqual(rows);
  });

  it("returns only the first sheet, and keeps a blank cell in place", () => {
    const bytes = buildXlsx([
      { name: "Data", widths: [5, 5, 5], rows: [{ cells: ["a", "", "c"] }] },
      { name: "Guide", widths: [5], rows: [{ cells: ["not this"] }] },
    ]);
    expect(readFirstSheet(bytes)).toEqual([["a", "", "c"]]);
  });

  it("refuses bytes that are not a workbook", () => {
    expect(readFirstSheet(strToU8("PK not really"))).toBeNull();
    expect(importFileToCsv(zipSync({ "hello.txt": strToU8("hi") }))).toEqual({
      error: "unreadable_file",
    });
  });

  it("reads a workbook Excel wrote: shared strings, numbers and a date cell", () => {
    const serial = (Date.UTC(2027, 11, 31) - Date.UTC(1899, 11, 30)) / 86_400_000;
    const bytes = zipSync({
      "xl/workbook.xml": strToU8(
        `<workbook xmlns:r="x"><sheets><sheet name="S" sheetId="1" r:id="rId7"/></sheets></workbook>`,
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        `<Relationships><Relationship Id="rId7" Type="t" Target="worksheets/sheet3.xml"/></Relationships>`,
      ),
      "xl/sharedStrings.xml": strToU8(
        `<sst><si><t>expiry_date</t></si><si><r><t>Para</t></r><r><t>cetamol</t></r></si></sst>`,
      ),
      "xl/styles.xml": strToU8(
        `<styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
      ),
      "xl/worksheets/sheet3.xml": strToU8(
        `<worksheet><sheetData>` +
          `<row r="1"><c r="A1" t="s"><v>0</v></c></row>` +
          `<row r="3"><c r="A3" t="s"><v>1</v></c><c r="C3" s="1"><v>${serial}</v></c><c r="D3"><v>15000</v></c></row>` +
          `</sheetData></worksheet>`,
      ),
    });
    expect(readFirstSheet(bytes)).toEqual([
      ["expiry_date"],
      [],
      ["Paracetamol", "", "2027-12-31", "15000"],
    ]);
  });

  it("reads a formula's number as what it shows, never as a thousands grouping", () => {
    const bytes = zipSync({
      "xl/workbook.xml": strToU8(
        `<workbook xmlns:r="x"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        `<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>`,
      ),
      "xl/worksheets/sheet1.xml": strToU8(
        `<worksheet><sheetData><row r="1">` +
          // 3 × 3333.33 as Excel keeps it, 15000 in exponent form, a cost worked
          // out by dividing, and a fraction of a unit.
          `<c r="A1"><v>9999.9899999999998</v></c>` +
          `<c r="B1"><v>1.5E4</v></c>` +
          `<c r="C1"><v>9090.9090909</v></c>` +
          `<c r="D1"><v>2.5</v></c>` +
          `</row></sheetData></worksheet>`,
      ),
    });
    expect(readFirstSheet(bytes)).toEqual([["9999.99", "15000", "9090.91", "2.50"]]);
  });
});

describe("the import template", () => {
  for (const [name, messages] of [
    ["id", id],
    ["en", en],
  ] as const) {
    describe(name, () => {
      const sheets = buildImportTemplateSheets(translator(messages));
      const [data, guide] = sheets;

      it("has the data sheet first and the guide second", () => {
        expect(sheets).toHaveLength(2);
        expect(data.rows[0].cells).toEqual([...IMPORT_COLUMNS]);
        expect(guide.rows.length).toBeGreaterThan(30);
      });

      it("explains every column, and lists every drug class and dosage form", () => {
        const guideText = guide.rows.map((row) => row.cells[0]);
        for (const column of IMPORT_COLUMNS) expect(guideText).toContain(column);
        for (const value of [...DRUG_CLASSES, ...DOSAGE_FORMS]) expect(guideText).toContain(value);
        // No message went missing and left an empty cell behind.
        for (const row of guide.rows.filter((r) => r.style === "wrap" && !r.span)) {
          expect(row.cells.filter((c) => c !== "").length).toBeGreaterThanOrEqual(2);
        }
      });

      it("downloads as a workbook whose first sheet is the one that gets imported", async () => {
        const bytes = buildXlsx(sheets);
        const read = importFileToCsv(bytes);
        expect("csv" in read).toBe(true);
        if (!("csv" in read)) return;

        const { rows, error } = parseImportCsv(read.csv);
        expect(error).toBeNull();
        // Only the example row: the guide sheet contributed nothing.
        expect(rows).toHaveLength(1);

        // The example must itself be importable, so nobody's first upload fails on it.
        const preview = await validateImportRows(db as unknown as Executor, rows);
        expect(preview.errors).toEqual([]);
        expect(preview.validRows).toHaveLength(1);
      });
    });
  }

  it("has the same guide keys in both languages", () => {
    const shape = (node: unknown): string[] =>
      typeof node === "object" && node !== null
        ? Object.entries(node).flatMap(([k, v]) => shape(v).map((rest) => (rest ? `${k}.${rest}` : k)))
        : [""];
    expect(shape(en.itemsImport.guide).sort()).toEqual(shape(id.itemsImport.guide).sort());
  });
});

describe("importFileToCsv", () => {
  it("passes plain CSV through untouched", () => {
    const csv = "code,generic_name\nA,B\n";
    expect(importFileToCsv(strToU8(csv))).toEqual({ csv });
  });

  it("drops rows of empty cells that a spreadsheet leaves behind", () => {
    const bytes = buildXlsx([
      {
        name: "Data",
        widths: [5, 5],
        rows: [{ cells: ["a", "b"] }, { cells: ["", " "] }, { cells: ["1", "2"] }],
      },
    ]);
    const read = importFileToCsv(bytes);
    if (!("csv" in read)) throw new Error("expected csv");
    expect(parseImportCsv(read.csv).rows).toHaveLength(1);
  });
});
