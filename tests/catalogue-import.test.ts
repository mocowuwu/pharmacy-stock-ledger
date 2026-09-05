import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import { categories, items, suppliers, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { onHand, type Executor } from "@/lib/stock/ledger";
import {
  commitImportRows,
  parseImportCsv,
  validateImportRows,
} from "@/lib/catalogue/import";

let db: TestDb;
let close: () => Promise<void>;
let userId: string;
let categoryId: string;
let supplierName: string;

// Same cast used throughout the suite: the ledger's Executor type is the
// node-postgres database, and PGlite implements the identical surface.
const ex = () => db as unknown as Executor;

beforeAll(async () => {
  ({ db, close } = await createTestDb());

  [{ id: userId }] = await db
    .insert(users)
    .values({
      username: "importer",
      fullName: "Importer",
      passwordHash: await hashPassword("a-long-enough-password"),
    })
    .returning({ id: users.id });

  [{ id: categoryId }] = await db
    .insert(categories)
    .values({ name: "Analgesik" })
    .returning({ id: categories.id });

  const [supplier] = await db
    .insert(suppliers)
    .values({ name: "Saldo Awal", isSystem: true })
    .returning({ id: suppliers.id, name: suppliers.name });
  supplierName = supplier.name;
});

afterAll(async () => {
  await close();
});

const HEADER =
  "code,generic_name,brand_name,form,strength,unit,pack_size,category,drug_class,nie,is_tax_exempt,reorder_point,reorder_qty,default_price,min_shelf_life_days,barcode,notes,lot_number,expiry_date,qty,unit_cost,supplier";

function csvOf(rows: string[]): string {
  return [HEADER, ...rows].join("\n");
}

describe("parseImportCsv", () => {
  it("splits header and body rows", () => {
    const { rows, error } = parseImportCsv(
      csvOf(["PARA001,Paracetamol,,tablet,500 mg,tablet,,,bebas,,,,,,,,,,,,,"]),
    );
    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0].raw.generic_name).toBe("Paracetamol");
  });
});

describe("validateImportRows", () => {
  it("accepts a valid item-only row and matches an existing category by name", async () => {
    const { rows } = parseImportCsv(
      csvOf(["PARA002,Paracetamol,,tablet,500 mg,tablet,,Analgesik,bebas,,,,,5000,,,,,,,,"]),
    );
    const { validRows, errors } = await validateImportRows(ex(), rows);
    expect(errors).toEqual([]);
    expect(validRows).toHaveLength(1);
    expect(validRows[0].defaultPrice).toBe(5000);
    expect(validRows[0].categoryId).toBe(categoryId);
  });

  it("rejects a code that already exists", async () => {
    await db.insert(items).values({
      code: "DUP001",
      genericName: "Duplicate",
      form: "tablet",
      unit: "tablet",
      drugClass: "bebas",
    });

    const { rows } = parseImportCsv(
      csvOf(["DUP001,Another Name,,tablet,,tablet,,,bebas,,,,,,,,,,,,,"]),
    );
    const { errors } = await validateImportRows(ex(), rows);
    expect(errors).toEqual([{ row: 1, field: "code", message: "duplicate_code" }]);
  });

  it("rejects an unknown category rather than creating one", async () => {
    const { rows } = parseImportCsv(
      csvOf(["PARA003,Paracetamol,,tablet,,tablet,,Bukan Kategori,bebas,,,,,,,,,,,,,"]),
    );
    const { errors } = await validateImportRows(ex(), rows);
    expect(errors).toEqual([{ row: 1, field: "category", message: "unknown_category" }]);
  });

  it("rejects a formatted-decimal price the way manual entry would", async () => {
    const { rows } = parseImportCsv(
      csvOf(['PARA004,Paracetamol,,tablet,,tablet,,,bebas,,,,,"15.000,00",,,,,,,,']),
    );
    const { errors } = await validateImportRows(ex(), rows);
    expect(errors).toEqual([{ row: 1, field: "default_price", message: "invalid_money" }]);
  });

  it("requires the batch group together and matches an existing supplier", async () => {
    const { rows } = parseImportCsv(
      csvOf(["PARA005,Paracetamol,,tablet,,tablet,,,bebas,,,,,,,,,,2027-12-31,100,,"]),
    );
    const { errors } = await validateImportRows(ex(), rows);
    expect(errors.some((e) => e.field === "supplier")).toBe(true);
  });

  it("accepts a row with both item and opening-batch fields", async () => {
    const { rows } = parseImportCsv(
      csvOf([
        `PARA006,Paracetamol,,tablet,,tablet,,,bebas,,,,,,,,,LOT-1,2027-12-31,100,9000,${supplierName}`,
      ]),
    );
    const { validRows, errors } = await validateImportRows(ex(), rows);
    expect(errors).toEqual([]);
    expect(validRows[0].batch).toEqual({
      lotNumber: "LOT-1",
      expiryDate: "2027-12-31",
      qty: 100,
      unitCost: 9000,
      supplierId: expect.any(String),
    });
  });
});

describe("commitImportRows", () => {
  it("creates the item and books the opening batch through applyMovement", async () => {
    const { rows } = parseImportCsv(
      csvOf([
        `PARA007,Paracetamol Impor,,tablet,,tablet,,,bebas,,,,,,,,,LOT-2,2027-12-31,50,8000,${supplierName}`,
      ]),
    );
    const { validRows, errors } = await validateImportRows(ex(), rows);
    expect(errors).toEqual([]);

    const { itemIds, batchIds } = await commitImportRows(ex(), userId, validRows);
    expect(itemIds).toHaveLength(1);
    expect(batchIds).toHaveLength(1);

    const [created] = await db.select().from(items).where(eq(items.id, itemIds[0]));
    expect(created.genericName).toBe("Paracetamol Impor");
    expect(await onHand(ex(), itemIds[0])).toBe(50);
  });

  it("leaves an item with no batch data holding zero stock", async () => {
    const { rows } = parseImportCsv(
      csvOf(["PARA008,Paracetamol Katalog Saja,,tablet,,tablet,,,bebas,,,,,,,,,,,,,"]),
    );
    const { validRows } = await validateImportRows(ex(), rows);
    const { itemIds, batchIds } = await commitImportRows(ex(), userId, validRows);
    expect(batchIds).toHaveLength(0);
    expect(await onHand(ex(), itemIds[0])).toBe(0);
  });
});
