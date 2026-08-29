import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, violatedConstraint, type TestDb } from "./helpers/db";
import {
  batches,
  categories,
  items,
  sales,
  stockMovements,
  suppliers,
  users,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";

let db: TestDb;
let close: () => Promise<void>;
let userId: string;
let itemId: string;
let supplierId: string;
let batchId: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());

  [{ id: userId }] = await db
    .insert(users)
    .values({
      username: "clerk",
      fullName: "Clerk",
      passwordHash: await hashPassword("a-long-enough-password"),
    })
    .returning({ id: users.id });

  [{ id: supplierId }] = await db
    .insert(suppliers)
    .values({ name: "PT Sumber Sehat" })
    .returning({ id: suppliers.id });

  const [category] = await db
    .insert(categories)
    .values({ name: "Antibiotik" })
    .returning({ id: categories.id });

  [{ id: itemId }] = await db
    .insert(items)
    .values({
      code: "AMX500",
      genericName: "Amoxicillin",
      form: "capsule",
      unit: "kapsul",
      drugClass: "keras",
      categoryId: category.id,
      defaultPrice: 2_500,
      reorderPoint: 100,
    })
    .returning({ id: items.id });

  [{ id: batchId }] = await db
    .insert(batches)
    .values({
      itemId,
      lotNumber: "LOT-A1",
      expiryDate: "2027-03-31",
      supplierId,
      receivedDate: "2026-08-01",
      qtyReceived: 500,
      qtyRemaining: 500,
      unitCost: 1_200,
      receivedBy: userId,
    })
    .returning({ id: batches.id });
});

afterAll(async () => {
  await close();
});

/**
 * These are the guards that make the design hold even if application logic is
 * wrong. Each test drives the database directly, bypassing every service, to
 * prove the constraint itself refuses -- not a check somewhere above it.
 */
describe("database guards", () => {
  it("refuses to drive a batch negative", async () => {
    const violation = await violatedConstraint(
      db.update(batches).set({ qtyRemaining: -1 }),
    );
    expect(violation).toBe("batches_qty_remaining_non_negative");
  });

  it("refuses a batch received with no quantity", async () => {
    const violation = await violatedConstraint(
      db.insert(batches).values({
        itemId,
        lotNumber: "LOT-EMPTY",
        expiryDate: "2027-03-31",
        supplierId,
        receivedDate: "2026-08-01",
        qtyReceived: 0,
        qtyRemaining: 0,
        receivedBy: userId,
      }),
    );
    expect(violation).toBe("batches_qty_received_positive");
  });

  it("refuses a ledger row that moves nothing", async () => {
    const violation = await violatedConstraint(
      db.insert(stockMovements).values({
        batchId,
        itemId,
        type: "adjust",
        qtyDelta: 0,
        performedBy: userId,
      }),
    );
    expect(violation).toBe("stock_movements_delta_non_zero");
  });

  it("refuses a voided sale that does not say who or why", async () => {
    const violation = await violatedConstraint(
      db.insert(sales).values({
        saleNumber: "S-0001",
        cashierId: userId,
        subtotal: 5_000,
        total: 5_000,
        paymentMethod: "tunai",
        status: "voided",
      }),
    );
    expect(violation).toBe("sales_void_is_explained");
  });

  it("accepts a voided sale that is fully explained", async () => {
    await expect(
      db.insert(sales).values({
        saleNumber: "S-0002",
        cashierId: userId,
        subtotal: 5_000,
        total: 5_000,
        paymentMethod: "tunai",
        status: "voided",
        voidedBy: userId,
        voidReason: "Salah input jumlah",
        voidedAt: new Date(),
      }),
    ).resolves.toBeDefined();
  });

  it("refuses a second batch with the same lot from the same supplier", async () => {
    const violation = await violatedConstraint(
      db.insert(batches).values({
        itemId,
        lotNumber: "LOT-A1",
        expiryDate: "2027-03-31",
        supplierId,
        receivedDate: "2026-08-02",
        qtyReceived: 100,
        qtyRemaining: 100,
        receivedBy: userId,
      }),
    );
    expect(violation).toBe("batches_item_lot_supplier_idx");
  });

  it("allows a quarantined child batch to reuse the lot number", async () => {
    // Returned stock becomes a child of the lot it came back from, which is
    // what keeps it tracked without making it sellable again.
    await expect(
      db.insert(batches).values({
        itemId,
        lotNumber: "LOT-A1",
        expiryDate: "2027-03-31",
        supplierId,
        receivedDate: "2026-08-03",
        qtyReceived: 10,
        qtyRemaining: 10,
        receivedBy: userId,
        parentBatchId: batchId,
        status: "quarantined",
      }),
    ).resolves.toBeDefined();
  });

  it("keeps money columns exact past the 32-bit ceiling", async () => {
    // Rp 2,147,483,647 is where an INT column would have silently wrapped.
    const big = 9_500_000_000;
    const [row] = await db
      .insert(sales)
      .values({
        saleNumber: "S-BIG",
        cashierId: userId,
        subtotal: big,
        total: big,
        paymentMethod: "transfer",
      })
      .returning({ total: sales.total });
    expect(row.total).toBe(big);
  });
});
