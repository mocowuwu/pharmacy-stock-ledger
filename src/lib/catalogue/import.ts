import Papa from "papaparse";
import { ilike } from "drizzle-orm";
import type { Executor } from "@/lib/stock/ledger";
import { receiveStock } from "@/lib/stock/ledger";
import { categories, itemBarcodes, items, suppliers } from "@/db/schema";
import { DOSAGE_FORMS, DRUG_CLASSES, type DosageForm, type DrugClass } from "./enums";
import { codePrefix, nextCode, normaliseCode } from "./code";
import { parseMoney } from "@/lib/format/money";
import { isExpired, today } from "@/lib/format/date";

/**
 * Bulk import from a spreadsheet.
 *
 * No permission check in this file -- that is `src/lib/dal/import.ts`'s job,
 * same split as `src/lib/stock/*`. This module only knows how to read a CSV
 * and turn valid rows into the same writes a person would make by hand: an
 * item, optionally a barcode, optionally an opening batch through
 * `receiveStock` (so `applyMovement` stays the only writer of
 * `batches.qty_remaining`).
 */

export const IMPORT_COLUMNS = [
  "code",
  "generic_name",
  "brand_name",
  "form",
  "strength",
  "unit",
  "pack_size",
  "category",
  "drug_class",
  "nie",
  "is_tax_exempt",
  "reorder_point",
  "reorder_qty",
  "default_price",
  "min_shelf_life_days",
  "barcode",
  "notes",
  "lot_number",
  "expiry_date",
  "qty",
  "unit_cost",
  "supplier",
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

/** Sane upper bound: this is a single clinic's catalogue, not a data pipeline. */
export const MAX_IMPORT_ROWS = 2000;

export type ParsedRow = {
  /** 1-based, matching what a spreadsheet program shows, header row excluded. */
  row: number;
  raw: Record<string, string>;
};

export type RowError = { row: number; field: string; message: string };

export type ValidatedItemRow = {
  row: number;
  code: string | null;
  genericName: string;
  brandName: string | null;
  form: DosageForm;
  strength: string | null;
  unit: string;
  packSize: number | null;
  categoryId: string | null;
  drugClass: DrugClass;
  nie: string | null;
  isTaxExempt: boolean;
  reorderPoint: number;
  reorderQty: number | null;
  defaultPrice: number;
  minShelfLifeDays: number | null;
  barcode: string | null;
  notes: string | null;
  batch: {
    lotNumber: string | null;
    expiryDate: string;
    qty: number;
    unitCost: number;
    supplierId: string;
  } | null;
};

export type ImportPreview = {
  validRows: ValidatedItemRow[];
  errors: RowError[];
  totalRows: number;
};

/** Splits raw CSV text into rows keyed by the fixed header contract. */
export function parseImportCsv(csvText: string): { rows: ParsedRow[]; error: string | null } {
  const result = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  if (result.errors.length > 0) {
    return { rows: [], error: "unreadable_file" };
  }
  if (result.data.length > MAX_IMPORT_ROWS) {
    return { rows: [], error: "too_many_rows" };
  }

  const rows = result.data.map((raw, index) => ({ row: index + 1, raw }));
  return { rows, error: null };
}

const truthy = new Set(["1", "true", "yes", "ya", "y"]);

function optionalInt(raw: string | undefined, min = 0): number | null | "invalid" {
  const v = (raw ?? "").trim();
  if (v === "") return null;
  if (!/^\d+$/u.test(v)) return "invalid";
  const n = Number(v);
  if (n < min) return "invalid";
  return n;
}

/**
 * Validates every parsed row against the current catalogue. Takes an executor
 * rather than a session, same split as `src/lib/stock/*`: this is testable
 * against a real database with no session to fake.
 */
export async function validateImportRows(
  tx: Executor,
  parsed: ParsedRow[],
): Promise<ImportPreview> {
  const errors: RowError[] = [];
  const validRows: ValidatedItemRow[] = [];

  const existingItems = await tx
    .select({ code: items.code })
    .from(items);
  const existingCodes = new Set(existingItems.map((r) => r.code.toLowerCase()));

  const allCategories = await tx.select({ id: categories.id, name: categories.name }).from(categories);
  const categoryByName = new Map(allCategories.map((c) => [c.name.toLowerCase(), c.id]));

  const allSuppliers = await tx.select({ id: suppliers.id, name: suppliers.name }).from(suppliers);
  const supplierByName = new Map(allSuppliers.map((s) => [s.name.toLowerCase(), s.id]));

  const existingBarcodes = await tx.select({ barcode: itemBarcodes.barcode }).from(itemBarcodes);
  const takenBarcodes = new Set(existingBarcodes.map((r) => r.barcode));

  // Codes and barcodes must also be unique within the file itself, not only
  // against what is already in the database.
  const codesInFile = new Map<string, number>();
  const barcodesInFile = new Map<string, number>();

  for (const { row, raw } of parsed) {
    const fail = (field: string, message: string) => errors.push({ row, field, message });
    let hasError = false;
    const before = errors.length;

    const genericName = (raw.generic_name ?? "").trim();
    if (!genericName) fail("generic_name", "required");

    const form = (raw.form ?? "").trim() as DosageForm;
    if (!DOSAGE_FORMS.includes(form)) fail("form", "invalid_form");

    const unit = (raw.unit ?? "").trim();
    if (!unit) fail("unit", "required");

    const drugClass = (raw.drug_class ?? "").trim() as DrugClass;
    if (!DRUG_CLASSES.includes(drugClass)) fail("drug_class", "invalid_drug_class");

    let code: string | null = null;
    const rawCode = (raw.code ?? "").trim();
    if (rawCode) {
      code = normaliseCode(rawCode);
      const key = code.toLowerCase();
      if (existingCodes.has(key) || codesInFile.has(key)) {
        fail("code", "duplicate_code");
      } else {
        codesInFile.set(key, row);
      }
    }

    let categoryId: string | null = null;
    const rawCategory = (raw.category ?? "").trim();
    if (rawCategory) {
      categoryId = categoryByName.get(rawCategory.toLowerCase()) ?? null;
      if (!categoryId) fail("category", "unknown_category");
    }

    const packSize = optionalInt(raw.pack_size, 1);
    if (packSize === "invalid") fail("pack_size", "invalid_number");
    const reorderPointRaw = optionalInt(raw.reorder_point, 0);
    if (reorderPointRaw === "invalid") fail("reorder_point", "invalid_number");
    const reorderQty = optionalInt(raw.reorder_qty, 1);
    if (reorderQty === "invalid") fail("reorder_qty", "invalid_number");
    const minShelfLifeDays = optionalInt(raw.min_shelf_life_days, 0);
    if (minShelfLifeDays === "invalid") fail("min_shelf_life_days", "invalid_number");

    let defaultPrice = 0;
    const rawPrice = (raw.default_price ?? "").trim();
    if (rawPrice) {
      const parsed = parseMoney(rawPrice);
      if (parsed === null || parsed < 0) fail("default_price", "invalid_money");
      else defaultPrice = parsed;
    }

    let barcode: string | null = null;
    const rawBarcode = (raw.barcode ?? "").trim();
    if (rawBarcode) {
      if (takenBarcodes.has(rawBarcode) || barcodesInFile.has(rawBarcode)) {
        fail("barcode", "duplicate_barcode");
      } else {
        barcode = rawBarcode;
        barcodesInFile.set(rawBarcode, row);
      }
    }

    // Batch fields: any one present means the whole group is expected.
    const hasBatchInput = [
      raw.lot_number,
      raw.expiry_date,
      raw.qty,
      raw.unit_cost,
      raw.supplier,
    ].some((v) => (v ?? "").trim() !== "");

    let batch: ValidatedItemRow["batch"] = null;
    if (hasBatchInput) {
      const expiryDate = (raw.expiry_date ?? "").trim();
      const validExpiry = /^\d{4}-\d{2}-\d{2}$/u.test(expiryDate);
      if (!validExpiry) {
        fail("expiry_date", "invalid_date");
      } else if (isExpired(expiryDate)) {
        fail("expiry_date", "already_expired");
      }

      const qtyRaw = optionalInt(raw.qty, 1);
      if (qtyRaw === "invalid" || qtyRaw === null) fail("qty", "invalid_number");

      let unitCost = 0;
      const rawCost = (raw.unit_cost ?? "").trim();
      const parsedCost = rawCost ? parseMoney(rawCost) : 0;
      if (parsedCost === null || parsedCost < 0) fail("unit_cost", "invalid_money");
      else unitCost = parsedCost;

      const rawSupplier = (raw.supplier ?? "").trim();
      const supplierId = rawSupplier ? (supplierByName.get(rawSupplier.toLowerCase()) ?? null) : null;
      if (!rawSupplier) fail("supplier", "required");
      else if (!supplierId) fail("supplier", "unknown_supplier");

      if (validExpiry && !isExpired(expiryDate) && qtyRaw !== "invalid" && qtyRaw !== null && supplierId) {
        batch = {
          lotNumber: (raw.lot_number ?? "").trim() || null,
          expiryDate,
          qty: qtyRaw,
          unitCost,
          supplierId,
        };
      }
    }

    hasError = errors.length > before;
    if (hasError) continue;

    validRows.push({
      row,
      code,
      genericName,
      brandName: (raw.brand_name ?? "").trim() || null,
      form,
      strength: (raw.strength ?? "").trim() || null,
      unit,
      packSize: packSize === "invalid" ? null : packSize,
      categoryId,
      drugClass,
      nie: (raw.nie ?? "").trim() || null,
      isTaxExempt: truthy.has((raw.is_tax_exempt ?? "").trim().toLowerCase()),
      reorderPoint: reorderPointRaw === "invalid" || reorderPointRaw === null ? 0 : reorderPointRaw,
      reorderQty: reorderQty === "invalid" ? null : reorderQty,
      defaultPrice,
      minShelfLifeDays: minShelfLifeDays === "invalid" ? null : minShelfLifeDays,
      barcode,
      notes: (raw.notes ?? "").trim() || null,
      batch,
    });
  }

  return { validRows, errors, totalRows: parsed.length };
}

/** Allocates a code for a row that left it blank, the same way manual entry does. */
async function allocateCode(tx: Executor, genericName: string): Promise<string> {
  const prefix = codePrefix(genericName);
  const existing = await tx
    .select({ code: items.code })
    .from(items)
    .where(ilike(items.code, `${prefix}%`));
  return nextCode(prefix, existing.map((r) => r.code));
}

export type CommitResult = {
  itemIds: string[];
  batchIds: string[];
};

/**
 * Writes the valid rows. Caller wraps this in one transaction so a failure
 * partway through (a race on a code, most likely) takes every row in this
 * commit back together rather than leaving the catalogue half-imported.
 */
export async function commitImportRows(
  tx: Executor,
  actorId: string,
  rows: ValidatedItemRow[],
): Promise<CommitResult> {
  const itemIds: string[] = [];
  const batchIds: string[] = [];

  for (const row of rows) {
    const code = row.code ?? (await allocateCode(tx, row.genericName));

    const [created] = await tx
      .insert(items)
      .values({
        code,
        genericName: row.genericName,
        brandName: row.brandName,
        form: row.form,
        strength: row.strength,
        unit: row.unit,
        packSize: row.packSize,
        categoryId: row.categoryId,
        drugClass: row.drugClass,
        nie: row.nie,
        isTaxExempt: row.isTaxExempt,
        reorderPoint: row.reorderPoint,
        reorderQty: row.reorderQty,
        defaultPrice: row.defaultPrice,
        minShelfLifeDays: row.minShelfLifeDays,
        notes: row.notes,
        createdBy: actorId,
      })
      .returning();
    itemIds.push(created.id);

    if (row.barcode) {
      await tx.insert(itemBarcodes).values({
        itemId: created.id,
        barcode: row.barcode,
        packSize: null,
        note: null,
      });
    }

    if (row.batch) {
      const { batchId } = await receiveStock(tx, {
        itemId: created.id,
        lotNumber: row.batch.lotNumber,
        expiryDate: row.batch.expiryDate,
        supplierId: row.batch.supplierId,
        receivedDate: today(),
        qty: row.batch.qty,
        unitCost: row.batch.unitCost,
        performedBy: actorId,
        type: "opening",
      });
      batchIds.push(batchId);
    }
  }

  return { itemIds, batchIds };
}
