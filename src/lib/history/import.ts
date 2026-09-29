import Papa from "papaparse";
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { historyImports, historySaleLines, items, sales } from "@/db/schema";
import { PAYMENT_METHODS } from "@/lib/catalogue/enums";
import { normaliseCode } from "@/lib/catalogue/code";
import { parseSheetMoney } from "@/lib/format/money";
import { DEFAULT_TIMEZONE, today } from "@/lib/format/date";
import { lockNumberSeries } from "@/lib/stock/numbering";
import { looksLikeZip, readFirstSheet } from "@/lib/format/xlsx";
import { isUuid } from "@/lib/format/ids";

/**
 * Importing sales from before this system.
 *
 * The same shape as the catalogue import -- a template, a preview that lists
 * every refused row with its reason, and a second explicit submit that writes
 * only what passed -- and the same split: no session here, so it is testable
 * against a real database; `src/lib/dal/history.ts` adds the permission check
 * and the audit entries.
 *
 * What it writes is deliberately not a sale. See `src/db/schema/history.ts`:
 * the stock these lines describe left the shelf before any batch existed here,
 * so nothing in this file touches a batch or the ledger.
 */

export const HISTORY_COLUMNS = [
  "date",
  "receipt_number",
  "item_code",
  "item_name",
  "qty",
  "unit_price",
  "line_total",
  "unit_cost",
  "payment_method",
  "cashier",
] as const;

export type HistoryColumn = (typeof HISTORY_COLUMNS)[number];

/**
 * A year of a busy clinic's till is on the order of twenty thousand lines. A
 * bigger file is split by year or by month; the guide says so.
 */
export const MAX_HISTORY_ROWS = 20_000;

/** The earliest day accepted. Anything older is a typo for this century. */
export const EARLIEST_HISTORY_DAY = "2000-01-01";

export type HistoryPaymentMethod = (typeof PAYMENT_METHODS)[number];

export type HistoryRowError = { row: number; field: string; message: string };

export type ValidatedHistoryRow = {
  row: number;
  soldOn: string;
  receiptNumber: string | null;
  itemId: string | null;
  itemName: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  unitCost: number | null;
  paymentMethod: HistoryPaymentMethod | null;
  cashierName: string | null;
};

export type HistorySummary = {
  lines: number;
  firstDay: string | null;
  lastDay: string | null;
  total: number;
  units: number;
  /** Lines tied to an item in the catalogue. */
  linked: number;
  /** Lines kept under the name the file gave, with no item behind them. */
  unlinked: number;
  /** Lines carrying a cost, and so a margin. */
  costed: number;
  /** Distinct receipts, which is what counts as a transaction. */
  receipts: number;
  /** Lines without a receipt number, which are not counted as transactions. */
  withoutReceipt: number;
};

export type HistoryPreview = {
  validRows: ValidatedHistoryRow[];
  errors: HistoryRowError[];
  totalRows: number;
  summary: HistorySummary;
  /** The same file is already imported and still counted. */
  duplicateOf: { importNumber: string; importedAt: Date } | null;
  /** Days in the file that the till, or an earlier import, already covers. */
  overlap: { tillDays: string[]; importedDays: string[] };
  fileHash: string;
};

export class HistoryImportError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "HistoryImportError";
  }
}

/** `row` is the row number a spreadsheet shows, header being row 1. */
export type ParsedHistoryRow = { row: number; raw: Record<string, string> };

/**
 * An uploaded file as CSV text, with its blank rows kept.
 *
 * The catalogue import drops blank rows before parsing; this one keeps them,
 * so that a refused line is reported under the row number Excel shows beside
 * it. With a year of sales in the file, "row 4.312" has to be row 4.312.
 * Blank rows at the very end -- a sheet formatted further down than it was
 * filled in -- are trimmed.
 */
export function historyFileToCsv(bytes: Uint8Array): { csv: string } | { error: string } {
  if (!looksLikeZip(bytes)) return { csv: new TextDecoder("utf-8").decode(bytes) };

  const sheet = readFirstSheet(bytes);
  if (!sheet) return { error: "unreadable_file" };

  let end = sheet.length;
  while (end > 0 && sheet[end - 1].every((cell) => cell.trim() === "")) end -= 1;
  return { csv: Papa.unparse(sheet.slice(0, end)) };
}

/**
 * Splits CSV text into rows keyed by the fixed header contract.
 *
 * `row` is the spreadsheet row number: the header is row 1, and a blank row
 * still takes up its number without becoming a line.
 */
export function parseHistoryCsv(csvText: string): {
  rows: ParsedHistoryRow[];
  error: string | null;
} {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: false,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  // A row with more or fewer cells than the header is still readable -- Papa
  // pads and trims it -- so only a genuinely broken file is refused whole.
  const fatal = result.errors.filter((e) => e.type !== "FieldMismatch");
  if (fatal.length > 0) return { rows: [], error: "unreadable_file" };

  const fields = result.meta.fields ?? [];
  const missing = ["date", "qty"].filter((column) => !fields.includes(column));
  if (missing.length > 0 || (!fields.includes("item_name") && !fields.includes("item_code"))) {
    return { rows: [], error: "wrong_columns" };
  }

  const rows = result.data
    .map((raw, index) => ({ row: index + 2, raw }))
    .filter(({ raw }) => Object.values(raw).some((value) => String(value ?? "").trim() !== ""));
  if (rows.length > MAX_HISTORY_ROWS) return { rows: [], error: "too_many_history_rows" };

  return { rows, error: null };
}

/** Same bytes, same fingerprint: how a second copy of one file is recognised. */
export function historyFileHash(csvText: string): string {
  return createHash("sha256").update(csvText.replace(/\r\n/gu, "\n").trim()).digest("hex");
}

/**
 * A day written year first -- 2026-09-25, 2026-9-5 or 2026/09/25 -- as
 * `YYYY-MM-DD`, or null. A day written day first is refused rather than
 * guessed at: 03/04/2026 is two different days depending on whose computer
 * wrote it, and the guide says to write the year first. A date *cell* never
 * reaches here as text; the workbook reader turns it into `YYYY-MM-DD` itself.
 */
export function normaliseDay(value: string): string | null {
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/u.exec(value.trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // Rejects 2026-02-30, which Date would otherwise roll into March.
  return date.toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * The payment column accepts the stored keys and the words people write. A
 * blank is fine -- plenty of old books never said how a sale was paid -- but a
 * word that matches nothing is refused rather than filed under "other", where
 * it would quietly distort the payment breakdown.
 */
const PAYMENT_ALIASES: Record<string, HistoryPaymentMethod> = {
  tunai: "tunai",
  cash: "tunai",
  kas: "tunai",
  kartu_debit: "kartu_debit",
  debit: "kartu_debit",
  debit_card: "kartu_debit",
  kartu_kredit: "kartu_kredit",
  kredit: "kartu_kredit",
  credit: "kartu_kredit",
  credit_card: "kartu_kredit",
  qris: "qris",
  transfer: "transfer",
  transfer_bank: "transfer",
  bank_transfer: "transfer",
  lainnya: "lainnya",
  lain_lain: "lainnya",
  other: "lainnya",
};

export function parsePaymentMethod(raw: string): HistoryPaymentMethod | null | "invalid" {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/gu, "_");
  if (key === "") return null;
  return PAYMENT_ALIASES[key] ?? "invalid";
}

/** Names are matched loosely: case and runs of spaces do not make a different medicine. */
function nameKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

const LIMITS = { receipt: 60, name: 200, cashier: 100 } as const;

/**
 * Checks every row against the current catalogue. Nothing is written.
 *
 * An item code must match; a typo there would otherwise land a line under the
 * wrong medicine or none. A name with no code is matched when exactly one
 * item carries it, and otherwise kept as written -- an old record may mention
 * something the pharmacy no longer stocks, and that is still last year's
 * takings.
 */
export async function validateHistoryRows(
  tx: Database,
  parsed: ParsedHistoryRow[],
  options: { on?: string; timezone?: string; fileHash: string },
): Promise<HistoryPreview> {
  const on = options.on ?? today(options.timezone);
  const errors: HistoryRowError[] = [];
  const validRows: ValidatedHistoryRow[] = [];

  const catalogue = await tx
    .select({
      id: items.id,
      code: items.code,
      genericName: items.genericName,
      brandName: items.brandName,
      strength: items.strength,
    })
    .from(items);

  const byCode = new Map(catalogue.map((item) => [item.code.toUpperCase(), item]));
  // name -> item ids carrying it; more than one id means the name is ambiguous.
  const byName = new Map<string, Set<string>>();
  const addName = (name: string | null | undefined, id: string) => {
    if (!name?.trim()) return;
    const key = nameKey(name);
    byName.set(key, (byName.get(key) ?? new Set()).add(id));
  };
  for (const item of catalogue) {
    addName(item.genericName, item.id);
    addName(item.brandName, item.id);
    if (item.strength) {
      addName(`${item.genericName} ${item.strength}`, item.id);
      if (item.brandName) addName(`${item.brandName} ${item.strength}`, item.id);
    }
  }
  const displayName = (item: (typeof catalogue)[number]) =>
    `${item.genericName}${item.strength ? ` ${item.strength}` : ""}`;

  for (const { row, raw } of parsed) {
    const before = errors.length;
    const fail = (field: string, message: string) => errors.push({ row, field, message });
    const cell = (column: HistoryColumn) => (raw[column] ?? "").trim();

    const rawDay = cell("date");
    const soldOn = normaliseDay(rawDay) ?? "";
    if (!rawDay) fail("date", "required");
    else if (!soldOn) fail("date", "invalid_date");
    else if (soldOn < EARLIEST_HISTORY_DAY) fail("date", "date_too_old");
    // Today belongs to the till. A line dated today would be counted a second
    // time the moment the same sale is rung up there.
    else if (soldOn >= on) fail("date", "date_not_past");

    const receiptNumber = cell("receipt_number") || null;
    if (receiptNumber && receiptNumber.length > LIMITS.receipt) fail("receipt_number", "too_long");

    let itemId: string | null = null;
    let itemName = cell("item_name");
    const rawCode = cell("item_code");
    if (rawCode) {
      const item = byCode.get(normaliseCode(rawCode));
      if (!item) fail("item_code", "unknown_item_code");
      else {
        itemId = item.id;
        if (!itemName) itemName = displayName(item);
      }
    } else if (!itemName) {
      fail("item_name", "item_required");
    } else {
      const matches = byName.get(nameKey(itemName));
      if (matches?.size === 1) itemId = [...matches][0];
    }
    if (itemName.length > LIMITS.name) fail("item_name", "too_long");

    const rawQty = cell("qty");
    const qty = /^\d+$/u.test(rawQty) ? Number(rawQty) : null;
    if (!rawQty) fail("qty", "required");
    else if (qty === null || qty < 1 || !Number.isSafeInteger(qty)) fail("qty", "invalid_qty");

    const money = (column: "unit_price" | "line_total" | "unit_cost") => {
      const value = cell(column);
      if (!value) return null;
      const parsedValue = parseSheetMoney(value);
      if (parsedValue === null || parsedValue < 0) {
        fail(column, "invalid_money");
        return undefined;
      }
      return parsedValue;
    };
    const unitPrice = money("unit_price");
    const lineTotal = money("line_total");
    const unitCost = money("unit_cost");
    if (unitPrice === null && lineTotal === null) fail("line_total", "price_required");

    const paymentMethod = parsePaymentMethod(cell("payment_method"));
    if (paymentMethod === "invalid") fail("payment_method", "invalid_payment_method");

    const cashierName = cell("cashier") || null;
    if (cashierName && cashierName.length > LIMITS.cashier) fail("cashier", "too_long");

    if (errors.length > before || qty === null) continue;
    if (unitPrice === undefined || lineTotal === undefined || unitCost === undefined) continue;
    if (paymentMethod === "invalid") continue;

    // The line total is what was actually charged, so when both are given it
    // wins: an old till may have taken a discount off the line. With only a
    // price, the total is the price times the quantity; with only a total, the
    // price is what each unit came to.
    const total = lineTotal ?? qty * (unitPrice ?? 0);
    if (!Number.isSafeInteger(total)) {
      fail("line_total", "invalid_money");
      continue;
    }

    validRows.push({
      row,
      soldOn,
      receiptNumber,
      itemId,
      itemName,
      qty,
      unitPrice: unitPrice ?? Math.round(total / qty),
      lineTotal: total,
      unitCost,
      paymentMethod,
      cashierName,
    });
  }

  const summary = summarise(validRows);
  return {
    validRows,
    errors,
    totalRows: parsed.length,
    summary,
    duplicateOf: await activeImportWithHash(tx, options.fileHash),
    overlap: await overlappingDays(tx, validRows, options.timezone ?? DEFAULT_TIMEZONE),
    fileHash: options.fileHash,
  };
}

export function summarise(rows: ValidatedHistoryRow[]): HistorySummary {
  let firstDay: string | null = null;
  let lastDay: string | null = null;
  const receipts = new Set<string>();
  let withoutReceipt = 0;

  for (const row of rows) {
    if (firstDay === null || row.soldOn < firstDay) firstDay = row.soldOn;
    if (lastDay === null || row.soldOn > lastDay) lastDay = row.soldOn;
    if (row.receiptNumber) receipts.add(`${row.soldOn}|${row.receiptNumber}`);
    else withoutReceipt += 1;
  }

  return {
    lines: rows.length,
    firstDay,
    lastDay,
    total: rows.reduce((sum, row) => sum + row.lineTotal, 0),
    units: rows.reduce((sum, row) => sum + row.qty, 0),
    linked: rows.filter((row) => row.itemId !== null).length,
    unlinked: rows.filter((row) => row.itemId === null).length,
    costed: rows.filter((row) => row.unitCost !== null).length,
    receipts: receipts.size,
    withoutReceipt,
  };
}

async function activeImportWithHash(tx: Database, fileHash: string) {
  const [existing] = await tx
    .select({ importNumber: historyImports.importNumber, importedAt: historyImports.importedAt })
    .from(historyImports)
    .where(and(eq(historyImports.fileHash, fileHash), eq(historyImports.status, "active")))
    .limit(1);
  return existing ?? null;
}

/**
 * Days in the file that are already counted somewhere.
 *
 * Not refused: a pharmacy that switched over mid-day, or that imports one
 * file per cashier, has a legitimate reason. But each of these days will be
 * counted twice if the file repeats what is already there, so the preview
 * names them before anything is written.
 */
async function overlappingDays(
  tx: Database,
  rows: ValidatedHistoryRow[],
  timezone: string,
): Promise<{ tillDays: string[]; importedDays: string[] }> {
  if (rows.length === 0) return { tillDays: [], importedDays: [] };
  const days = new Set(rows.map((row) => row.soldOn));
  const first = [...days].reduce((a, b) => (a < b ? a : b));
  const last = [...days].reduce((a, b) => (a > b ? a : b));

  const tillRows = await tx
    .select({ day: sql<string>`((${sales.soldAt} at time zone ${timezone})::date)::text` })
    .from(sales)
    .where(
      and(
        eq(sales.status, "completed"),
        sql`((${sales.soldAt} at time zone ${timezone})::date) between ${first} and ${last}`,
      ),
    )
    .groupBy(sql`1`);

  const importedRows = await tx
    .selectDistinct({ day: historySaleLines.soldOn })
    .from(historySaleLines)
    .innerJoin(historyImports, eq(historyImports.id, historySaleLines.importId))
    .where(
      and(
        eq(historyImports.status, "active"),
        sql`${historySaleLines.soldOn} between ${first} and ${last}`,
      ),
    );

  const keep = (list: string[]) => list.filter((day) => days.has(day)).sort();
  return {
    tillDays: keep(tillRows.map((r) => r.day)),
    importedDays: keep(importedRows.map((r) => r.day)),
  };
}

/** `H` + YYMMDD + a four-digit sequence, like every other document number. */
export async function nextHistoryImportNumber(tx: Database, on: string): Promise<string> {
  await lockNumberSeries(tx, "history", on);
  const prefix = `H${on.replaceAll("-", "").slice(2)}`;
  const [last] = await tx
    .select({ number: historyImports.importNumber })
    .from(historyImports)
    .where(sql`${historyImports.importNumber} like ${`${prefix}-%`}`)
    .orderBy(desc(historyImports.importNumber))
    .limit(1);

  const seq = last ? Number(last.number.split("-")[1]) + 1 : 1;
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

/** Inserted in slices, so a year of lines is a few dozen statements, not one enormous one. */
const INSERT_CHUNK = 500;

/**
 * Writes an already-validated file as one import. The caller wraps it in a
 * transaction together with the validation, so a catalogue change between the
 * preview and the commit is caught again rather than trusted.
 */
export async function commitHistoryRows(
  tx: Database,
  input: {
    actorId: string;
    rows: ValidatedHistoryRow[];
    fileHash: string;
    fileName: string | null;
    on?: string;
  },
): Promise<{ importId: string; importNumber: string; summary: HistorySummary }> {
  if (input.rows.length === 0) throw new HistoryImportError("nothing_to_import");

  const summary = summarise(input.rows);
  // Numbered last, immediately before the insert, like every other series.
  const importNumber = await nextHistoryImportNumber(tx, input.on ?? today());

  // Checked again under the series lock. Two people confirming the same file
  // at once both pass the preview's check; the lock queues them, and the
  // second finds the first's import here instead of tripping the unique index
  // and seeing a database error.
  if (await activeImportWithHash(tx, input.fileHash)) {
    throw new HistoryImportError("already_imported");
  }

  const [created] = await tx
    .insert(historyImports)
    .values({
      importNumber,
      fileName: input.fileName?.slice(0, 200) || null,
      fileHash: input.fileHash,
      lineCount: summary.lines,
      firstDay: summary.firstDay!,
      lastDay: summary.lastDay!,
      total: summary.total,
      importedBy: input.actorId,
    })
    .returning({ id: historyImports.id });

  for (let start = 0; start < input.rows.length; start += INSERT_CHUNK) {
    await tx.insert(historySaleLines).values(
      input.rows.slice(start, start + INSERT_CHUNK).map((row) => ({
        importId: created.id,
        sourceRow: row.row,
        soldOn: row.soldOn,
        receiptNumber: row.receiptNumber,
        itemId: row.itemId,
        itemName: row.itemName,
        qty: row.qty,
        unitPrice: row.unitPrice,
        lineTotal: row.lineTotal,
        unitCost: row.unitCost,
        paymentMethod: row.paymentMethod,
        cashierName: row.cashierName,
      })),
    );
  }

  return { importId: created.id, importNumber, summary };
}

/**
 * Takes an import out of every report. The lines stay where they are, with
 * who withdrew them and why, exactly as a voided sale does.
 */
export async function withdrawHistoryImport(
  tx: Database,
  input: { importId: string; actorId: string; reason: string },
) {
  const reason = input.reason.trim();
  if (!reason) throw new HistoryImportError("reason_required");
  // A mangled id from a form is "not found", not a database syntax error.
  if (!isUuid(input.importId)) {
    throw new HistoryImportError("import_not_found");
  }

  const [existing] = await tx
    .select()
    .from(historyImports)
    .where(eq(historyImports.id, input.importId))
    .for("update")
    .limit(1);
  if (!existing) throw new HistoryImportError("import_not_found");
  if (existing.status === "withdrawn") throw new HistoryImportError("already_withdrawn");

  const [updated] = await tx
    .update(historyImports)
    .set({
      status: "withdrawn",
      withdrawnBy: input.actorId,
      withdrawnAt: new Date(),
      withdrawReason: reason,
    })
    .where(eq(historyImports.id, input.importId))
    .returning();

  return { before: existing, after: updated };
}
