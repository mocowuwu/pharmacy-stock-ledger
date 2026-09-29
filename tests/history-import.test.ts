import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb, violatedConstraint, type TestDb } from "./helpers/db";
import { historyImports, historySaleLines, items, sales, settings, suppliers, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { commitSale } from "@/lib/stock/sale";
import { receiveStock, type Executor } from "@/lib/stock/ledger";
import { addDays, today } from "@/lib/format/date";
import { buildXlsx } from "@/lib/format/xlsx";
import {
  commitHistoryRows,
  HISTORY_COLUMNS,
  historyFileHash,
  historyFileToCsv,
  HistoryImportError,
  MAX_HISTORY_ROWS,
  normaliseDay,
  parseHistoryCsv,
  parsePaymentMethod,
  validateHistoryRows,
  withdrawHistoryImport,
} from "@/lib/history/import";
import { buildHistoryTemplateSheets, HISTORY_REQUIREMENT } from "@/lib/history/import-guide";
import id from "@/i18n/messages/id.json";
import en from "@/i18n/messages/en.json";

let db: TestDb;
let close: () => Promise<void>;
let ownerId: string;
let paraId: string;

const ex = () => db as unknown as Executor;
const HEADER = HISTORY_COLUMNS.join(",");
const csvOf = (lines: string[]) => [HEADER, ...lines].join("\n");
const past = (days: number) => addDays(today(), -days);

async function check(csv: string) {
  const { rows, error } = parseHistoryCsv(csv);
  expect(error).toBeNull();
  return validateHistoryRows(ex(), rows, { fileHash: historyFileHash(csv) });
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
  [{ id: ownerId }] = await db
    .insert(users)
    .values({
      username: "pemilik",
      fullName: "Pemilik Apotek",
      passwordHash: await hashPassword("a-long-enough-password"),
      isOwner: true,
    })
    .returning({ id: users.id });

  const insert = (code: string, genericName: string, strength: string | null, brandName: string | null = null) =>
    db
      .insert(items)
      .values({ code, genericName, strength, brandName, form: "tablet", unit: "tablet", drugClass: "bebas" })
      .returning({ id: items.id })
      .then(([row]) => row.id);

  paraId = await insert("PARA001", "Paracetamol", "500 mg", "Sanmol");
  // Two items share a brand, so the brand alone names neither.
  await insert("AMOX001", "Amoxicillin", "500 mg", "Generik");
  await insert("CTM001", "Klorfeniramin", "4 mg", "Generik");
});

afterAll(async () => close());

describe("reading a history file", () => {
  it("refuses a file whose header is not the template's", () => {
    expect(parseHistoryCsv("tanggal,barang,jumlah\n2026-01-01,Obat,1").error).toBe("wrong_columns");
  });

  it("numbers rows the way the spreadsheet does, blank rows included", () => {
    const bytes = buildXlsx([
      {
        name: "Data",
        widths: [10],
        rows: [
          { cells: [...HISTORY_COLUMNS] },
          { cells: ["2026-01-02", "", "", "Obat A", "1", "", "1000"] },
          { cells: [] },
          { cells: ["2026-01-03", "", "", "Obat B", "2", "", "2000"] },
          { cells: [] },
          { cells: [] },
        ],
      },
    ]);
    const read = historyFileToCsv(bytes);
    expect("csv" in read).toBe(true);
    const { rows } = parseHistoryCsv((read as { csv: string }).csv);
    expect(rows.map((r) => r.row)).toEqual([2, 4]);
  });

  it("caps a file at the documented size", () => {
    const line = `${past(10)},,,Obat,1,,1000,,,`;
    const csv = csvOf(Array.from({ length: MAX_HISTORY_ROWS + 1 }, () => line));
    expect(parseHistoryCsv(csv).error).toBe("too_many_history_rows");
  });

  it("reads days written year first, and refuses the ones that could be two days", () => {
    expect(normaliseDay("2026-09-05")).toBe("2026-09-05");
    expect(normaliseDay("2026-9-5")).toBe("2026-09-05");
    expect(normaliseDay("2026/09/05")).toBe("2026-09-05");
    expect(normaliseDay("05/09/2026")).toBeNull();
    expect(normaliseDay("2026-02-30")).toBeNull();
  });

  it("knows payment methods by their keys and by the words people write", () => {
    expect(parsePaymentMethod("Kartu Debit")).toBe("kartu_debit");
    expect(parsePaymentMethod("cash")).toBe("tunai");
    expect(parsePaymentMethod("Transfer Bank")).toBe("transfer");
    expect(parsePaymentMethod("")).toBeNull();
    expect(parsePaymentMethod("gopay")).toBe("invalid");
  });
});

describe("checking a history file", () => {
  it("names every refused row by its spreadsheet row, with the reason", async () => {
    const preview = await check(
      csvOf([
        `${today()},,,Obat,1,,1000,,,`, // row 2: today belongs to the till
        "25/09/2026,,,Obat,1,,1000,,,", // row 3
        `${past(3)},,NOPE,,1,,1000,,,`, // row 4
        `${past(3)},,,,1,,1000,,,`, // row 5
        `${past(3)},,,Obat,2.5,,1000,,,`, // row 6
        `${past(3)},,,Obat,1,,,,,`, // row 7
        `${past(3)},,,Obat,1,,1000,,gopay,`, // row 8
        `1999-12-31,,,Obat,1,,1000,,,`, // row 9
      ]),
    );

    expect(preview.validRows).toEqual([]);
    expect(preview.errors).toEqual([
      { row: 2, field: "date", message: "date_not_past" },
      { row: 3, field: "date", message: "invalid_date" },
      { row: 4, field: "item_code", message: "unknown_item_code" },
      { row: 5, field: "item_name", message: "item_required" },
      { row: 6, field: "qty", message: "invalid_qty" },
      { row: 7, field: "line_total", message: "price_required" },
      { row: 8, field: "payment_method", message: "invalid_payment_method" },
      { row: 9, field: "date", message: "date_too_old" },
    ]);
  });

  it("ties lines to the catalogue by code or by one unambiguous name", async () => {
    const preview = await check(
      csvOf([
        `${past(5)},N1,para001,,2,1000,,400,Tunai,Siti`,
        `${past(5)},N1,,paracetamol 500 MG,1,1000,,,,`,
        `${past(5)},N2,,Generik,1,,5000,,qris,`,
        `${past(4)},,,Obat Lama,3,,9090.91,,,`,
      ]),
    );

    expect(preview.errors).toEqual([]);
    const [byCode, byName, ambiguous, unknown] = preview.validRows;
    expect(byCode).toMatchObject({
      itemId: paraId,
      itemName: "Paracetamol 500 mg",
      lineTotal: 2_000,
      unitCost: 400,
      paymentMethod: "tunai",
      cashierName: "Siti",
    });
    expect(byName.itemId).toBe(paraId);
    // "Generik" is the brand of two items, so it is kept as written.
    expect(ambiguous).toMatchObject({ itemId: null, itemName: "Generik", unitPrice: 5_000 });
    // A formula's decimal total is rounded to the rupiah, not read as 909.091.
    expect(unknown).toMatchObject({ itemId: null, lineTotal: 9_091, unitPrice: 3_030 });

    expect(preview.summary).toMatchObject({
      lines: 4,
      firstDay: past(5),
      lastDay: past(4),
      total: 2_000 + 1_000 + 5_000 + 9_091,
      units: 7,
      linked: 2,
      unlinked: 2,
      costed: 1,
      receipts: 2,
      withoutReceipt: 1,
    });
  });

  it("warns about days the till has already counted", async () => {
    const [{ id: supplierId }] = await db.insert(suppliers).values({ name: "PBF" }).returning({ id: suppliers.id });
    await receiveStock(ex(), {
      itemId: paraId,
      lotNumber: "P1",
      expiryDate: addDays(today(), 300),
      supplierId,
      receivedDate: today(),
      qty: 50,
      unitCost: 400,
      performedBy: ownerId,
    });
    const sale = await commitSale(ex(), {
      actorId: ownerId,
      lines: [{ itemId: paraId, qty: 1, unitPrice: 1_000 }],
      paymentMethod: "tunai",
    });
    // Rung up six days ago, as far as the report is concerned.
    await db
      .update(sales)
      .set({ soldAt: sql`now() - interval '6 days'` })
      .where(eq(sales.id, sale.saleId));

    const preview = await check(csvOf([`${past(6)},,,Obat,1,,1000,,,`, `${past(7)},,,Obat,1,,1000,,,`]));
    expect(preview.overlap.tillDays).toEqual([past(6)]);
  });
});

describe("committing and withdrawing", () => {
  const file = csvOf([`${past(20)},A1,PARA001,,4,1000,,400,tunai,`, `${past(19)},,,Salep Lama,1,,7500,,,`]);

  it("writes one numbered import, and refuses the same file twice", async () => {
    const preview = await check(file);
    const result = await db.transaction((tx) =>
      commitHistoryRows(tx as unknown as Executor, {
        actorId: ownerId,
        rows: preview.validRows,
        fileHash: preview.fileHash,
        fileName: "riwayat.xlsx",
      }),
    );

    expect(result.importNumber).toMatch(/^H\d{6}-0001$/u);
    const lines = await db
      .select()
      .from(historySaleLines)
      .where(eq(historySaleLines.importId, result.importId));
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.sourceRow).sort()).toEqual([2, 3]);

    const again = await check(file);
    expect(again.duplicateOf?.importNumber).toBe(result.importNumber);
    await expect(
      db.transaction((tx) =>
        commitHistoryRows(tx as unknown as Executor, {
          actorId: ownerId,
          rows: again.validRows,
          fileHash: again.fileHash,
          fileName: null,
        }),
      ),
    ).rejects.toThrow(HistoryImportError);

    // The overlapping days are named before a second, different file lands on them.
    const overlapping = await check(csvOf([`${past(20)},A2,PARA001,,1,1000,,,,`]));
    expect(overlapping.overlap.importedDays).toEqual([past(20)]);
  });

  it("withdraws with a reason, keeps the lines, and lets the file come back", async () => {
    const [existing] = await db.select().from(historyImports).where(eq(historyImports.fileHash, historyFileHash(file)));

    await expect(
      withdrawHistoryImport(ex(), { importId: existing.id, actorId: ownerId, reason: "  " }),
    ).rejects.toThrow("reason_required");
    await expect(
      withdrawHistoryImport(ex(), { importId: "not-a-uuid", actorId: ownerId, reason: "x" }),
    ).rejects.toThrow("import_not_found");

    const { after } = await withdrawHistoryImport(ex(), {
      importId: existing.id,
      actorId: ownerId,
      reason: "Bulan yang salah",
    });
    expect(after).toMatchObject({ status: "withdrawn", withdrawnBy: ownerId, withdrawReason: "Bulan yang salah" });
    await expect(
      withdrawHistoryImport(ex(), { importId: existing.id, actorId: ownerId, reason: "lagi" }),
    ).rejects.toThrow("already_withdrawn");

    const kept = await db.select().from(historySaleLines).where(eq(historySaleLines.importId, existing.id));
    expect(kept).toHaveLength(2);

    const again = await check(file);
    expect(again.duplicateOf).toBeNull();
  });
});

describe("the database's own guards", () => {
  it("refuses a withdrawal that does not say who and why", async () => {
    const constraint = await violatedConstraint(
      db.insert(historyImports).values({
        importNumber: "H990101-0001",
        fileHash: "x1",
        lineCount: 1,
        firstDay: "2026-01-01",
        lastDay: "2026-01-01",
        total: 0,
        importedBy: ownerId,
        status: "withdrawn",
      }),
    );
    expect(constraint).toBe("history_imports_withdrawal_is_explained");
  });

  it("refuses a second active copy of one file", async () => {
    const values = {
      fileHash: "same-file",
      lineCount: 1,
      firstDay: "2026-01-01",
      lastDay: "2026-01-01",
      total: 0,
      importedBy: ownerId,
    };
    await db.insert(historyImports).values({ ...values, importNumber: "H990101-0002" });
    const constraint = await violatedConstraint(
      db.insert(historyImports).values({ ...values, importNumber: "H990101-0003" }),
    );
    expect(constraint).toBe("history_imports_active_hash_idx");
  });

  it("refuses a line with no quantity", async () => {
    const [header] = await db.select({ id: historyImports.id }).from(historyImports).limit(1);
    const constraint = await violatedConstraint(
      db.insert(historySaleLines).values({
        importId: header.id,
        sourceRow: 2,
        soldOn: "2026-01-01",
        itemName: "Obat",
        qty: 0,
        unitPrice: 0,
        lineTotal: 0,
      }),
    );
    expect(constraint).toBe("history_sale_lines_qty_positive");
  });
});

describe("the template", () => {
  for (const [name, messages] of [
    ["id", id],
    ["en", en],
  ] as const) {
    it(`explains every column in ${name}, and ships no example row to be imported by mistake`, () => {
      const t = (key: string, values?: Record<string, string | number>) => {
        let node: unknown = messages;
        for (const part of key.split(".")) node = (node as Record<string, unknown>)?.[part];
        if (typeof node !== "string") throw new Error(`missing message ${key}`);
        return node.replace(/\{(\w+)\}/gu, (_, k: string) => String(values?.[k] ?? ""));
      };
      const [data, guide] = buildHistoryTemplateSheets(t);

      expect(data.rows).toHaveLength(1);
      expect(data.rows[0].cells).toEqual([...HISTORY_COLUMNS]);
      for (const column of HISTORY_COLUMNS) {
        expect(guide.rows.some((row) => row.cells[0] === column)).toBe(true);
        expect(HISTORY_REQUIREMENT[column]).toBeDefined();
      }
    });
  }
});
