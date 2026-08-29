import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import {
  batches,
  categories,
  items,
  sales,
  saleLines,
  settings,
  stockMovements,
  suppliers,
  taxRates,
  users,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { commitSale, reverseSale, SaleError } from "@/lib/stock/sale";
import { findLedgerDrift, receiveStock, type Executor } from "@/lib/stock/ledger";
import { addDays, today } from "@/lib/format/date";

let db: TestDb;
let close: () => Promise<void>;
let cashierId: string;
let supplierId: string;

const ex = () => db as unknown as Executor;

async function makeItem(opts: {
  code: string;
  name: string;
  price?: number;
  taxExempt?: boolean;
  drugClass?: "bebas" | "keras";
}) {
  const [item] = await db
    .insert(items)
    .values({
      code: opts.code,
      genericName: opts.name,
      form: "tablet",
      unit: "tablet",
      drugClass: opts.drugClass ?? "bebas",
      defaultPrice: opts.price ?? 1_000,
      isTaxExempt: opts.taxExempt ?? false,
    })
    .returning({ id: items.id });
  return item.id;
}

async function stock(itemId: string, lot: string, qty: number, days: number, cost = 500) {
  const { batchId } = await receiveStock(ex(), {
    itemId,
    lotNumber: lot,
    expiryDate: addDays(today(), days),
    supplierId,
    receivedDate: today(),
    qty,
    unitCost: cost,
    performedBy: cashierId,
  });
  return batchId;
}

async function qtyOf(batchId: string) {
  const [row] = await db
    .select({ q: batches.qtyRemaining })
    .from(batches)
    .where(eq(batches.id, batchId));
  return row.q;
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());

  [{ id: cashierId }] = await db
    .insert(users)
    .values({
      username: "kasir",
      fullName: "Siti Kasir",
      passwordHash: await hashPassword("a-long-enough-password"),
    })
    .returning({ id: users.id });

  [{ id: supplierId }] = await db
    .insert(suppliers)
    .values({ name: "PT Sumber Sehat" })
    .returning({ id: suppliers.id });

  await db.insert(categories).values({ name: "Umum" });
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
});

afterAll(async () => {
  await close();
});

describe("a sale", () => {
  it("takes stock first-expired-first-out and writes the ledger", async () => {
    const itemId = await makeItem({ code: "S1", name: "Paracetamol" });
    const soon = await stock(itemId, "SOON-1", 50, 20);
    const late = await stock(itemId, "LATE-1", 200, 400);

    const result = await db.transaction(async (tx) =>
      commitSale(tx as unknown as Executor, {
        actorId: cashierId,
        lines: [{ itemId, qty: 30, unitPrice: 500 }],
        paymentMethod: "tunai",
        tendered: 20_000,
      }),
    );

    expect(result.total).toBe(15_000);
    expect(result.change).toBe(5_000);
    expect(await qtyOf(soon)).toBe(20);
    expect(await qtyOf(late)).toBe(200);
    expect(await findLedgerDrift(ex())).toHaveLength(0);
  });

  it("splits across batches when the earliest one runs out", async () => {
    const itemId = await makeItem({ code: "S2", name: "Ibuprofen" });
    const soon = await stock(itemId, "SOON-2", 20, 15);
    const late = await stock(itemId, "LATE-2", 100, 300);

    await db.transaction(async (tx) =>
      commitSale(tx as unknown as Executor, {
        actorId: cashierId,
        lines: [{ itemId, qty: 50, unitPrice: 800 }],
        paymentMethod: "qris",
      }),
    );

    expect(await qtyOf(soon)).toBe(0);
    expect(await qtyOf(late)).toBe(70);

    // One sale line per batch: which lot left the building is the whole point
    // of batch tracking.
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      .where(eq(saleLines.itemId, itemId));
    expect(n).toBe(2);
  });

  it("snapshots the cost of each batch it drew from", async () => {
    const itemId = await makeItem({ code: "S3", name: "Cetirizine" });
    await stock(itemId, "CHEAP", 10, 30, 400);
    await stock(itemId, "DEAR", 10, 300, 900);

    const { saleId } = await db.transaction(async (tx) =>
      commitSale(tx as unknown as Executor, {
        actorId: cashierId,
        lines: [{ itemId, qty: 15, unitPrice: 1_000 }],
        paymentMethod: "tunai",
      }),
    );

    const lines = await db
      .select({ cost: saleLines.unitCostSnapshot, qty: saleLines.qty })
      .from(saleLines)
      .where(eq(saleLines.saleId, saleId));
    // Without the snapshot, last month's margin would change when this
    // month's delivery costs more.
    expect(lines.map((l) => l.cost).sort()).toEqual([400, 900]);
  });

  it("numbers sales sequentially and never reuses one", async () => {
    const itemId = await makeItem({ code: "S4", name: "Vitamin C" });
    await stock(itemId, "VC-1", 100, 300);

    const numbers: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await db.transaction(async (tx) =>
        commitSale(tx as unknown as Executor, {
          actorId: cashierId,
          lines: [{ itemId, qty: 1, unitPrice: 700 }],
          paymentMethod: "tunai",
        }),
      );
      numbers.push(r.saleNumber);
    }
    expect(new Set(numbers).size).toBe(3);
    expect([...numbers].sort()).toEqual(numbers);
  });
});

describe("what a sale refuses", () => {
  it("will not sell expired stock even when it is all there is", async () => {
    const itemId = await makeItem({ code: "R1", name: "Amoxicillin" });
    const batchId = await stock(itemId, "EXP-1", 200, 30);
    await db.update(batches).set({ expiryDate: addDays(today(), -1) })
      .where(eq(batches.id, batchId));

    await expect(
      db.transaction(async (tx) =>
        commitSale(tx as unknown as Executor, {
          actorId: cashierId,
          lines: [{ itemId, qty: 1, unitPrice: 2_500 }],
          paymentMethod: "tunai",
        }),
      ),
    ).rejects.toMatchObject({ code: "insufficient_stock" });

    // Still on the shelf, still untouched.
    expect(await qtyOf(batchId)).toBe(200);
  });

  it("refuses to oversell and commits nothing at all", async () => {
    const itemId = await makeItem({ code: "R2", name: "Omeprazole" });
    const batchId = await stock(itemId, "OMP-1", 10, 300);

    const before = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(stockMovements);

    await expect(
      db.transaction(async (tx) =>
        commitSale(tx as unknown as Executor, {
          actorId: cashierId,
          lines: [{ itemId, qty: 25, unitPrice: 1_500 }],
          paymentMethod: "tunai",
        }),
      ),
    ).rejects.toBeInstanceOf(SaleError);

    const after = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(stockMovements);

    expect(await qtyOf(batchId)).toBe(10);
    expect(after[0].n).toBe(before[0].n);
  });

  it("rolls back every line when a later line cannot be filled", async () => {
    // The case that matters: the first item is fine, the second is short, and
    // nothing may be left half-sold.
    const good = await makeItem({ code: "R3", name: "Antasida" });
    const short = await makeItem({ code: "R4", name: "Salbutamol" });
    const goodBatch = await stock(good, "OK-1", 100, 300);
    const shortBatch = await stock(short, "SH-1", 2, 300);

    await expect(
      db.transaction(async (tx) =>
        commitSale(tx as unknown as Executor, {
          actorId: cashierId,
          lines: [
            { itemId: good, qty: 10, unitPrice: 1_000 },
            { itemId: short, qty: 5, unitPrice: 85_000 },
          ],
          paymentMethod: "tunai",
        }),
      ),
    ).rejects.toMatchObject({ code: "insufficient_stock" });

    expect(await qtyOf(goodBatch)).toBe(100);
    expect(await qtyOf(shortBatch)).toBe(2);
  });

  it("requires a reason when the cashier skips the earliest-expiring batch", async () => {
    const itemId = await makeItem({ code: "R5", name: "Metformin" });
    await stock(itemId, "SOON-M", 50, 10);
    const late = await stock(itemId, "LATE-M", 50, 400);

    await expect(
      db.transaction(async (tx) =>
        commitSale(tx as unknown as Executor, {
          actorId: cashierId,
          lines: [{ itemId, qty: 5, unitPrice: 800, preferBatchId: late }],
          paymentMethod: "tunai",
        }),
      ),
    ).rejects.toMatchObject({ code: "override_reason_required" });

    const ok = await db.transaction(async (tx) =>
      commitSale(tx as unknown as Executor, {
        actorId: cashierId,
        lines: [
          {
            itemId, qty: 5, unitPrice: 800, preferBatchId: late,
            overrideReason: "Pasien bepergian tiga bulan",
          },
        ],
        paymentMethod: "tunai",
      }),
    );
    expect(ok.total).toBe(4_000);

    const [line] = await db
      .select({ reason: saleLines.fefoOverrideReason })
      .from(saleLines)
      .where(eq(saleLines.saleId, ok.saleId));
    expect(line.reason).toBe("Pasien bepergian tiga bulan");
  });

  it("rejects a zero or fractional quantity", async () => {
    const itemId = await makeItem({ code: "R6", name: "Oralit" });
    await stock(itemId, "OR-1", 10, 300);
    for (const qty of [0, -3, 1.5]) {
      await expect(
        db.transaction(async (tx) =>
          commitSale(tx as unknown as Executor, {
            actorId: cashierId,
            lines: [{ itemId, qty, unitPrice: 1_000 }],
            paymentMethod: "tunai",
          }),
        ),
      ).rejects.toMatchObject({ code: "invalid_quantity" });
    }
  });
});

describe("voiding a sale", () => {
  it("returns every unit to the batch it came from", async () => {
    const itemId = await makeItem({ code: "V1", name: "Captopril" });
    const soon = await stock(itemId, "V-SOON", 20, 20);
    const late = await stock(itemId, "V-LATE", 100, 300);

    const { saleId } = await db.transaction(async (tx) =>
      commitSale(tx as unknown as Executor, {
        actorId: cashierId,
        lines: [{ itemId, qty: 50, unitPrice: 600 }],
        paymentMethod: "tunai",
      }),
    );
    expect(await qtyOf(soon)).toBe(0);
    expect(await qtyOf(late)).toBe(70);

    await db.transaction(async (tx) =>
      reverseSale(tx as unknown as Executor, {
        saleId, actorId: cashierId, reason: "Salah input jumlah",
      }),
    );

    expect(await qtyOf(soon)).toBe(20);
    expect(await qtyOf(late)).toBe(100);
    expect(await findLedgerDrift(ex())).toHaveLength(0);
  });

  it("keeps the sale rather than deleting it", async () => {
    const itemId = await makeItem({ code: "V2", name: "Glimepiride" });
    await stock(itemId, "V2-1", 30, 300);

    const { saleId } = await db.transaction(async (tx) =>
      commitSale(tx as unknown as Executor, {
        actorId: cashierId,
        lines: [{ itemId, qty: 2, unitPrice: 1_500 }],
        paymentMethod: "kartu_debit",
      }),
    );
    await db.transaction(async (tx) =>
      reverseSale(tx as unknown as Executor, {
        saleId, actorId: cashierId, reason: "Dibatalkan pelanggan",
      }),
    );

    const [sale] = await db.select().from(sales).where(eq(sales.id, saleId));
    // A receipt printed once must remain findable.
    expect(sale.status).toBe("voided");
    expect(sale.voidReason).toBe("Dibatalkan pelanggan");
    expect(sale.voidedBy).toBe(cashierId);
    expect(sale.total).toBe(3_000);
  });

  it("refuses to void twice, so stock is not returned again", async () => {
    const itemId = await makeItem({ code: "V3", name: "Cefixime" });
    await stock(itemId, "V3-1", 30, 300);

    const { saleId } = await db.transaction(async (tx) =>
      commitSale(tx as unknown as Executor, {
        actorId: cashierId,
        lines: [{ itemId, qty: 3, unitPrice: 4_000 }],
        paymentMethod: "tunai",
      }),
    );
    await db.transaction(async (tx) =>
      reverseSale(tx as unknown as Executor, {
        saleId, actorId: cashierId, reason: "Salah barang",
      }),
    );

    await expect(
      db.transaction(async (tx) =>
        reverseSale(tx as unknown as Executor, {
          saleId, actorId: cashierId, reason: "Lagi",
        }),
      ),
    ).rejects.toMatchObject({ code: "already_voided" });
  });

  it("requires a reason", async () => {
    const itemId = await makeItem({ code: "V4", name: "Ambroxol" });
    await stock(itemId, "V4-1", 10, 300);
    const { saleId } = await db.transaction(async (tx) =>
      commitSale(tx as unknown as Executor, {
        actorId: cashierId,
        lines: [{ itemId, qty: 1, unitPrice: 900 }],
        paymentMethod: "tunai",
      }),
    );
    await expect(
      db.transaction(async (tx) =>
        reverseSale(tx as unknown as Executor, {
          saleId, actorId: cashierId, reason: "  ",
        }),
      ),
    ).rejects.toMatchObject({ code: "reason_required" });
  });
});

describe("tax", () => {
  it("adds nothing while tax is switched off", async () => {
    const itemId = await makeItem({ code: "T1", name: "Masker" });
    await stock(itemId, "T1-1", 100, 900);
    const r = await db.transaction(async (tx) =>
      commitSale(tx as unknown as Executor, {
        actorId: cashierId,
        lines: [{ itemId, qty: 10, unitPrice: 1_500 }],
        paymentMethod: "tunai",
      }),
    );
    // A clinic pharmacy below the PKP threshold charges no PPN at all.
    expect(r.taxAmount).toBe(0);
    expect(r.total).toBe(15_000);
  });

  it("adds an exclusive rate on top, and exempts what is exempt", async () => {
    await db.insert(taxRates).values({
      name: "PPN", rateBps: 1100, effectiveFrom: addDays(today(), -30),
    });
    await db.update(settings).set({ taxEnabled: true, taxMode: "exclusive" })
      .where(eq(settings.id, 1));

    const taxed = await makeItem({ code: "T2", name: "Spuit" });
    const exempt = await makeItem({ code: "T3", name: "Obat Generik", taxExempt: true });
    await stock(taxed, "T2-1", 100, 900);
    await stock(exempt, "T3-1", 100, 900);

    const r = await db.transaction(async (tx) =>
      commitSale(tx as unknown as Executor, {
        actorId: cashierId,
        lines: [
          { itemId: taxed, qty: 10, unitPrice: 1_000 },
          { itemId: exempt, qty: 10, unitPrice: 1_000 },
        ],
        paymentMethod: "tunai",
      }),
    );

    expect(r.subtotal).toBe(20_000);
    expect(r.taxAmount).toBe(1_100); // 11% of the taxable half only
    expect(r.total).toBe(21_100);

    await db.update(settings).set({ taxEnabled: false }).where(eq(settings.id, 1));
  });

  it("splits an inclusive rate out of the price so the parts sum to the total", async () => {
    await db.update(settings).set({ taxEnabled: true, taxMode: "inclusive" })
      .where(eq(settings.id, 1));

    const itemId = await makeItem({ code: "T4", name: "Sarung Tangan" });
    await stock(itemId, "T4-1", 100, 900);

    const r = await db.transaction(async (tx) =>
      commitSale(tx as unknown as Executor, {
        actorId: cashierId,
        lines: [{ itemId, qty: 10, unitPrice: 2_000 }],
        paymentMethod: "tunai",
      }),
    );

    expect(r.total).toBe(20_000);
    expect(r.taxAmount).toBe(1_982); // 20000 * 1100 / 11100
    await db.update(settings).set({ taxEnabled: false }).where(eq(settings.id, 1));
  });
});
