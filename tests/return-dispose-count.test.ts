import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import {
  batches,
  categories,
  disposals,
  items,
  returns,
  returnLines,
  saleLines,
  settings,
  stockAdjustments,
  stockCountLines,
  stockCounts,
  stockMovements,
  suppliers,
  users,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { commitSale, reverseSale, SaleError } from "@/lib/stock/sale";
import { commitReturn } from "@/lib/stock/return";
import { disposeStock } from "@/lib/stock/disposal";
import { CountError, openCount, postCount, recordCount } from "@/lib/stock/count";
import { findLedgerDrift, receiveStock, type Executor } from "@/lib/stock/ledger";
import { addDays, today } from "@/lib/format/date";

let db: TestDb;
let close: () => Promise<void>;
let actorId: string;
let supplierId: string;
let categoryId: string;

const ex = () => db as unknown as Executor;

async function makeItem(opts: {
  code: string;
  name: string;
  price?: number;
  drugClass?: "bebas" | "keras";
}) {
  const [item] = await db
    .insert(items)
    .values({
      code: opts.code,
      genericName: opts.name,
      form: "tablet",
      unit: "tablet",
      categoryId,
      drugClass: opts.drugClass ?? "bebas",
      defaultPrice: opts.price ?? 1_000,
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
    performedBy: actorId,
  });
  return batchId;
}

async function batchRow(batchId: string) {
  const [row] = await db.select().from(batches).where(eq(batches.id, batchId));
  return row;
}

/** Every batch's stored quantity must still equal the sum of its movements. */
async function expectNoDrift() {
  expect(await findLedgerDrift(ex())).toHaveLength(0);
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());

  [{ id: actorId }] = await db
    .insert(users)
    .values({
      username: "apoteker",
      fullName: "Dewi Apoteker",
      isPharmacist: true,
      passwordHash: await hashPassword("a-long-enough-password"),
    })
    .returning({ id: users.id });

  [{ id: supplierId }] = await db
    .insert(suppliers)
    .values({ name: "PT Sumber Sehat" })
    .returning({ id: suppliers.id });

  [{ id: categoryId }] = await db
    .insert(categories)
    .values({ name: "Umum" })
    .returning({ id: categories.id });

  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
});

afterAll(async () => close());

beforeEach(async () => {
  await db.update(settings).set({ allowReturnRestock: false }).where(eq(settings.id, 1));
});

describe("returns", () => {
  it("quarantines returned stock instead of putting it back on the shelf", async () => {
    const itemId = await makeItem({ code: "RET-1", name: "Paracetamol", price: 2_000 });
    const batchId = await stock(itemId, "L-1", 100, 300);

    const sale = await commitSale(ex(), {
      actorId,
      lines: [{ itemId, qty: 10, unitPrice: 2_000 }],
      paymentMethod: "tunai",
    });

    const [line] = await db
      .select()
      .from(saleLines)
      .where(eq(saleLines.saleId, sale.saleId));

    const result = await commitReturn(ex(), {
      saleId: sale.saleId,
      actorId,
      lines: [{ saleLineId: line.id, qty: 4 }],
      refundMethod: "tunai",
      reason: "Salah dosis",
    });

    expect(result.refundTotal).toBe(8_000);
    expect(result.restocked).toBe(0);

    // The original batch does not get the units back.
    expect((await batchRow(batchId)).qtyRemaining).toBe(90);

    const [child] = await db
      .select()
      .from(batches)
      .where(eq(batches.parentBatchId, batchId));

    expect(child.status).toBe("quarantined");
    expect(child.qtyRemaining).toBe(4);
    expect(child.lotNumber).toBe("L-1");

    await expectNoDrift();
  });

  it("adds a second return from the same lot to the existing quarantine batch", async () => {
    const itemId = await makeItem({ code: "RET-2", name: "Ibuprofen" });
    const batchId = await stock(itemId, "L-2", 50, 200);

    const sale = await commitSale(ex(), {
      actorId,
      lines: [{ itemId, qty: 20, unitPrice: 1_000 }],
      paymentMethod: "tunai",
    });
    const [line] = await db
      .select()
      .from(saleLines)
      .where(eq(saleLines.saleId, sale.saleId));

    await commitReturn(ex(), {
      saleId: sale.saleId,
      actorId,
      lines: [{ saleLineId: line.id, qty: 3 }],
      refundMethod: "tunai",
      reason: "Rusak",
    });
    await commitReturn(ex(), {
      saleId: sale.saleId,
      actorId,
      lines: [{ saleLineId: line.id, qty: 2 }],
      refundMethod: "tunai",
      reason: "Rusak",
    });

    const children = await db
      .select()
      .from(batches)
      .where(eq(batches.parentBatchId, batchId));

    expect(children).toHaveLength(1);
    expect(children[0].qtyRemaining).toBe(5);
    expect(children[0].qtyReceived).toBe(5);
    await expectNoDrift();
  });

  it("refuses to return more than was sold, counting earlier returns", async () => {
    const itemId = await makeItem({ code: "RET-3", name: "Amoxicillin" });
    await stock(itemId, "L-3", 40, 200);

    const sale = await commitSale(ex(), {
      actorId,
      lines: [{ itemId, qty: 5, unitPrice: 1_000 }],
      paymentMethod: "tunai",
    });
    const [line] = await db
      .select()
      .from(saleLines)
      .where(eq(saleLines.saleId, sale.saleId));

    await commitReturn(ex(), {
      saleId: sale.saleId,
      actorId,
      lines: [{ saleLineId: line.id, qty: 3 }],
      refundMethod: "tunai",
      reason: "Batal",
    });

    await expect(
      commitReturn(ex(), {
        saleId: sale.saleId,
        actorId,
        lines: [{ saleLineId: line.id, qty: 3 }],
        refundMethod: "tunai",
        reason: "Batal",
      }),
    ).rejects.toMatchObject({ code: "return_exceeds_sold" });
  });

  it("caps the total when one sale line is listed twice in a single return", async () => {
    const itemId = await makeItem({ code: "RET-4", name: "Cetirizine" });
    await stock(itemId, "L-4", 30, 200);

    const sale = await commitSale(ex(), {
      actorId,
      lines: [{ itemId, qty: 4, unitPrice: 1_000 }],
      paymentMethod: "tunai",
    });
    const [line] = await db
      .select()
      .from(saleLines)
      .where(eq(saleLines.saleId, sale.saleId));

    // Each entry passes the cap on its own; together they exceed it.
    await expect(
      commitReturn(ex(), {
        saleId: sale.saleId,
        actorId,
        lines: [
          { saleLineId: line.id, qty: 3 },
          { saleLineId: line.id, qty: 3 },
        ],
        refundMethod: "tunai",
        reason: "Batal",
      }),
    ).rejects.toMatchObject({ code: "return_exceeds_sold" });
  });

  it("refunds what was actually paid on a discounted sale, not the list price", async () => {
    const itemId = await makeItem({ code: "RET-5", name: "Vitamin C" });
    await stock(itemId, "L-5", 100, 200);

    // Rp 10.000 of goods sold for Rp 8.000.
    const sale = await commitSale(ex(), {
      actorId,
      lines: [{ itemId, qty: 10, unitPrice: 1_000 }],
      paymentMethod: "tunai",
      discount: 2_000,
    });
    const [line] = await db
      .select()
      .from(saleLines)
      .where(eq(saleLines.saleId, sale.saleId));

    const result = await commitReturn(ex(), {
      saleId: sale.saleId,
      actorId,
      lines: [{ saleLineId: line.id, qty: 5 }],
      refundMethod: "tunai",
      reason: "Salah beli",
    });

    // Half the sale came back, so half of what was paid goes out.
    expect(result.refundTotal).toBe(4_000);
  });

  it("restocks sealed OTC when the setting permits it", async () => {
    await db.update(settings).set({ allowReturnRestock: true }).where(eq(settings.id, 1));

    const itemId = await makeItem({ code: "RET-6", name: "Tolak Angin" });
    const batchId = await stock(itemId, "L-6", 60, 300);

    const sale = await commitSale(ex(), {
      actorId,
      lines: [{ itemId, qty: 6, unitPrice: 1_000 }],
      paymentMethod: "tunai",
    });
    const [line] = await db
      .select()
      .from(saleLines)
      .where(eq(saleLines.saleId, sale.saleId));

    const result = await commitReturn(ex(), {
      saleId: sale.saleId,
      actorId,
      lines: [{ saleLineId: line.id, qty: 6 }],
      refundMethod: "tunai",
      reason: "Segel utuh",
    });

    expect(result.restocked).toBe(1);
    expect((await batchRow(batchId)).qtyRemaining).toBe(60);
    expect(
      await db.select().from(batches).where(eq(batches.parentBatchId, batchId)),
    ).toHaveLength(0);
    await expectNoDrift();
  });

  it("never restocks a restricted class, whatever the setting says", async () => {
    await db.update(settings).set({ allowReturnRestock: true }).where(eq(settings.id, 1));

    const itemId = await makeItem({
      code: "RET-7",
      name: "Amoxicillin Keras",
      drugClass: "keras",
    });
    const batchId = await stock(itemId, "L-7", 40, 300);

    const sale = await commitSale(ex(), {
      actorId,
      actorIsPharmacist: true,
      lines: [{ itemId, qty: 8, unitPrice: 1_000 }],
      paymentMethod: "tunai",
    });
    const [line] = await db
      .select()
      .from(saleLines)
      .where(eq(saleLines.saleId, sale.saleId));

    const result = await commitReturn(ex(), {
      saleId: sale.saleId,
      actorId,
      actorIsPharmacist: true,
      lines: [{ saleLineId: line.id, qty: 8 }],
      refundMethod: "tunai",
      reason: "Dikembalikan pasien",
    });

    expect(result.restocked).toBe(0);
    expect((await batchRow(batchId)).qtyRemaining).toBe(32);

    const [child] = await db
      .select()
      .from(batches)
      .where(eq(batches.parentBatchId, batchId));
    expect(child.status).toBe("quarantined");

    const [record] = await db.select().from(returns).where(eq(returns.id, result.returnId));
    expect(record.pharmacistId).toBe(actorId);
  });

  it("refuses to return against a voided sale", async () => {
    const itemId = await makeItem({ code: "RET-8", name: "Antasida" });
    await stock(itemId, "L-8", 20, 200);

    const sale = await commitSale(ex(), {
      actorId,
      lines: [{ itemId, qty: 2, unitPrice: 1_000 }],
      paymentMethod: "tunai",
    });
    const [line] = await db
      .select()
      .from(saleLines)
      .where(eq(saleLines.saleId, sale.saleId));

    await reverseSale(ex(), { saleId: sale.saleId, actorId, reason: "Salah input" });

    await expect(
      commitReturn(ex(), {
        saleId: sale.saleId,
        actorId,
        lines: [{ saleLineId: line.id, qty: 1 }],
        refundMethod: "tunai",
        reason: "Batal",
      }),
    ).rejects.toMatchObject({ code: "sale_voided" });
  });

  it("refuses to void a sale that has already been returned", async () => {
    const itemId = await makeItem({ code: "RET-9", name: "Salbutamol" });
    await stock(itemId, "L-9", 20, 200);

    const sale = await commitSale(ex(), {
      actorId,
      lines: [{ itemId, qty: 4, unitPrice: 1_000 }],
      paymentMethod: "tunai",
    });
    const [line] = await db
      .select()
      .from(saleLines)
      .where(eq(saleLines.saleId, sale.saleId));

    await commitReturn(ex(), {
      saleId: sale.saleId,
      actorId,
      lines: [{ saleLineId: line.id, qty: 1 }],
      refundMethod: "tunai",
      reason: "Batal sebagian",
    });

    // Voiding would put all four units back on top of the one already returned.
    await expect(
      reverseSale(ex(), { saleId: sale.saleId, actorId, reason: "Salah input" }),
    ).rejects.toBeInstanceOf(SaleError);
  });

  it("writes nothing when a later line in the same return is refused", async () => {
    const itemA = await makeItem({ code: "RET-10", name: "Loratadine" });
    const itemB = await makeItem({ code: "RET-11", name: "Ranitidine" });
    await stock(itemA, "L-10", 20, 200);
    await stock(itemB, "L-11", 20, 200);

    const sale = await commitSale(ex(), {
      actorId,
      lines: [
        { itemId: itemA, qty: 5, unitPrice: 1_000 },
        { itemId: itemB, qty: 5, unitPrice: 1_000 },
      ],
      paymentMethod: "tunai",
    });
    const lines = await db
      .select()
      .from(saleLines)
      .where(eq(saleLines.saleId, sale.saleId));

    const before = await db.select({ n: sql<number>`count(*)::int` }).from(returns);

    await expect(
      commitReturn(ex(), {
        saleId: sale.saleId,
        actorId,
        lines: [
          { saleLineId: lines[0].id, qty: 2 },
          { saleLineId: lines[1].id, qty: 99 }, // more than was sold
        ],
        refundMethod: "tunai",
        reason: "Batal",
      }),
    ).rejects.toMatchObject({ code: "return_exceeds_sold" });

    const after = await db.select({ n: sql<number>`count(*)::int` }).from(returns);
    expect(after[0].n).toBe(before[0].n);
    expect(
      await db.select().from(returnLines).where(eq(returnLines.saleLineId, lines[0].id)),
    ).toHaveLength(0);
  });
});

describe("disposal", () => {
  it("writes stock off, snapshots the cost, and marks an emptied batch disposed", async () => {
    const itemId = await makeItem({ code: "DIS-1", name: "Metformin" });
    const batchId = await stock(itemId, "D-1", 30, 10, 700);

    const result = await disposeStock(ex(), {
      batchId,
      qty: 30,
      reason: "Kedaluwarsa",
      method: "Insinerasi",
      actorId,
    });

    expect(result.costValue).toBe(21_000);

    const batch = await batchRow(batchId);
    expect(batch.qtyRemaining).toBe(0);
    // Not "depleted": the status has to say what became of it.
    expect(batch.status).toBe("disposed");

    const [record] = await db
      .select()
      .from(disposals)
      .where(eq(disposals.id, result.disposalId));
    expect(record.disposalNumber).toMatch(/^D\d{6}-\d{4}$/u);
    expect(record.costValue).toBe(21_000);

    await expectNoDrift();
  });

  it("leaves a partly disposed batch active and sellable", async () => {
    const itemId = await makeItem({ code: "DIS-2", name: "Omeprazole" });
    const batchId = await stock(itemId, "D-2", 50, 300);

    await disposeStock(ex(), {
      batchId,
      qty: 10,
      reason: "Kemasan rusak",
      actorId,
    });

    const batch = await batchRow(batchId);
    expect(batch.qtyRemaining).toBe(40);
    expect(batch.status).toBe("active");
  });

  it("keeps an expired batch expired when only part of it is destroyed", async () => {
    const itemId = await makeItem({ code: "DIS-3", name: "Cefixime" });
    const batchId = await stock(itemId, "D-3", 20, 300);
    await db.update(batches).set({ status: "expired" }).where(eq(batches.id, batchId));

    await disposeStock(ex(), { batchId, qty: 5, reason: "Kedaluwarsa", actorId });

    // Without the sticky rule this would flip back to active and go on sale.
    expect((await batchRow(batchId)).status).toBe("expired");
  });

  it("refuses to destroy more than the batch holds", async () => {
    const itemId = await makeItem({ code: "DIS-4", name: "Ambroxol" });
    const batchId = await stock(itemId, "D-4", 5, 300);

    await expect(
      disposeStock(ex(), { batchId, qty: 6, reason: "Kedaluwarsa", actorId }),
    ).rejects.toMatchObject({ code: "insufficient_stock" });
    expect((await batchRow(batchId)).qtyRemaining).toBe(5);
  });

  it("insists on a reason", async () => {
    const itemId = await makeItem({ code: "DIS-5", name: "Simvastatin" });
    const batchId = await stock(itemId, "D-5", 5, 300);

    await expect(
      disposeStock(ex(), { batchId, qty: 1, reason: "  ", actorId }),
    ).rejects.toMatchObject({ code: "reason_required" });
  });

  it("refuses to destroy a restricted class without a responsible pharmacist", async () => {
    const itemId = await makeItem({
      code: "DIS-6",
      name: "Diazepam",
      drugClass: "keras",
    });
    const batchId = await stock(itemId, "D-6", 10, 300);

    await expect(
      disposeStock(ex(), { batchId, qty: 10, reason: "Kedaluwarsa", actorId }),
    ).rejects.toMatchObject({ code: "pharmacist_required" });

    await expect(
      disposeStock(ex(), {
        batchId,
        qty: 10,
        reason: "Kedaluwarsa",
        actorId,
        pharmacistId: actorId,
      }),
    ).resolves.toMatchObject({ qtyAfter: 0 });
  });
});

describe("stock opname", () => {
  it("snapshots the shelf, posts the differences, and explains each one", async () => {
    const itemId = await makeItem({ code: "SO-1", name: "Dexamethasone" });
    const batchId = await stock(itemId, "S-1", 100, 300);

    const opened = await openCount(ex(), { name: "Opname Agustus", actorId });
    expect(opened.countNumber).toMatch(/^SO\d{6}-\d{4}$/u);

    const [line] = await db
      .select()
      .from(stockCountLines)
      .where(eq(stockCountLines.batchId, batchId));
    expect(line.expectedQty).toBe(100);

    // Three boxes short on the shelf.
    await recordCount(ex(), {
      lineId: line.id,
      countedQty: 97,
      reason: "Selisih fisik",
      actorId,
    });

    const posted = await postCount(ex(), { countId: opened.countId, actorId });
    expect(posted.adjusted).toBe(1);

    expect((await batchRow(batchId)).qtyRemaining).toBe(97);

    const [adjustment] = await db
      .select()
      .from(stockAdjustments)
      .where(eq(stockAdjustments.batchId, batchId));
    expect(adjustment.qtyBefore).toBe(100);
    expect(adjustment.qtyAfter).toBe(97);
    expect(adjustment.countId).toBe(opened.countId);

    const movements = await db
      .select()
      .from(stockMovements)
      .where(eq(stockMovements.batchId, batchId));
    const adjust = movements.find((m) => m.type === "adjust");
    expect(adjust?.qtyDelta).toBe(-3);
    expect(adjust?.reason).toBe("Selisih fisik");

    await expectNoDrift();
  });

  it("refuses to post a variance nobody has explained", async () => {
    const itemId = await makeItem({ code: "SO-2", name: "Furosemide" });
    const batchId = await stock(itemId, "S-2", 40, 300);

    const opened = await openCount(ex(), { name: "Opname tanpa alasan", actorId });
    const [line] = await db
      .select()
      .from(stockCountLines)
      .where(
        sql`${stockCountLines.countId} = ${opened.countId} and ${stockCountLines.batchId} = ${batchId}`,
      );

    await recordCount(ex(), { lineId: line.id, countedQty: 35, actorId });

    await expect(
      postCount(ex(), { countId: opened.countId, actorId }),
    ).rejects.toBeInstanceOf(CountError);
    expect((await batchRow(batchId)).qtyRemaining).toBe(40);
  });

  it("applies the difference the counter found, not the number they wrote down", async () => {
    const itemId = await makeItem({ code: "SO-3", name: "Ranitidine 150" });
    const batchId = await stock(itemId, "S-3", 50, 300);

    const opened = await openCount(ex(), { name: "Opname dengan penjualan", actorId });
    const [line] = await db
      .select()
      .from(stockCountLines)
      .where(
        sql`${stockCountLines.countId} = ${opened.countId} and ${stockCountLines.batchId} = ${batchId}`,
      );

    // Counter finds two missing: 48 on a shelf the system thought held 50.
    await recordCount(ex(), {
      lineId: line.id,
      countedQty: 48,
      reason: "Selisih fisik",
      actorId,
    });

    // Meanwhile the till sells five. Stock should have been frozen; it wasn't.
    await commitSale(ex(), {
      actorId,
      lines: [{ itemId, qty: 5, unitPrice: 1_000 }],
      paymentMethod: "tunai",
    });

    await postCount(ex(), { countId: opened.countId, actorId });

    // 50 − 5 sold − 2 missing. Writing 48 straight onto the batch would have
    // silently un-sold the five.
    expect((await batchRow(batchId)).qtyRemaining).toBe(43);
    await expectNoDrift();
  });

  it("counts quarantined stock, which is physically on a shelf", async () => {
    const itemId = await makeItem({ code: "SO-4", name: "Ketoconazole" });
    const batchId = await stock(itemId, "S-4", 20, 300);

    const sale = await commitSale(ex(), {
      actorId,
      lines: [{ itemId, qty: 5, unitPrice: 1_000 }],
      paymentMethod: "tunai",
    });
    const [saleLine] = await db
      .select()
      .from(saleLines)
      .where(eq(saleLines.saleId, sale.saleId));
    await commitReturn(ex(), {
      saleId: sale.saleId,
      actorId,
      lines: [{ saleLineId: saleLine.id, qty: 5 }],
      refundMethod: "tunai",
      reason: "Dikembalikan",
    });

    const [child] = await db
      .select()
      .from(batches)
      .where(eq(batches.parentBatchId, batchId));

    const opened = await openCount(ex(), { name: "Opname karantina", actorId });
    const lines = await db
      .select()
      .from(stockCountLines)
      .where(eq(stockCountLines.countId, opened.countId));

    expect(lines.map((l) => l.batchId)).toContain(child.id);
  });

  it("scopes a count to one category so the shop need not close", async () => {
    const [other] = await db
      .insert(categories)
      .values({ name: "Alat Kesehatan" })
      .returning({ id: categories.id });

    const inScope = await makeItem({ code: "SO-5", name: "Ranitidin Umum" });
    await stock(inScope, "S-5", 10, 300);

    const [outItem] = await db
      .insert(items)
      .values({
        code: "SO-6",
        genericName: "Masker",
        form: "device",
        unit: "pcs",
        categoryId: other.id,
        drugClass: "alkes",
        defaultPrice: 1_000,
      })
      .returning({ id: items.id });
    await stock(outItem.id, "S-6", 10, 300);

    const opened = await openCount(ex(), {
      name: "Opname Alkes",
      categoryId: other.id,
      actorId,
    });

    const lines = await db
      .select({ itemId: stockCountLines.itemId })
      .from(stockCountLines)
      .where(eq(stockCountLines.countId, opened.countId));

    expect(lines.every((l) => l.itemId === outItem.id)).toBe(true);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("refuses to post a count twice", async () => {
    const itemId = await makeItem({ code: "SO-7", name: "Captopril" });
    await stock(itemId, "S-7", 10, 300);

    const opened = await openCount(ex(), { name: "Opname ganda", actorId });
    await postCount(ex(), { countId: opened.countId, actorId });

    await expect(
      postCount(ex(), { countId: opened.countId, actorId }),
    ).rejects.toMatchObject({ code: "already_posted" });
  });

  it("refuses a count that would drive a batch negative", async () => {
    const itemId = await makeItem({ code: "SO-8", name: "Allopurinol" });
    const batchId = await stock(itemId, "S-8", 10, 300);

    const opened = await openCount(ex(), { name: "Opname negatif", actorId });
    const [line] = await db
      .select()
      .from(stockCountLines)
      .where(
        sql`${stockCountLines.countId} = ${opened.countId} and ${stockCountLines.batchId} = ${batchId}`,
      );

    await recordCount(ex(), { lineId: line.id, countedQty: 0, reason: "Hilang", actorId });
    // Everything sells before the count is posted, so the −10 no longer fits.
    await commitSale(ex(), {
      actorId,
      lines: [{ itemId, qty: 10, unitPrice: 1_000 }],
      paymentMethod: "tunai",
    });

    await expect(
      postCount(ex(), { countId: opened.countId, actorId }),
    ).rejects.toMatchObject({ code: "would_go_negative" });
    expect((await batchRow(batchId)).qtyRemaining).toBe(0);
  });

  it("leaves the count sheet alone once it is posted", async () => {
    const itemId = await makeItem({ code: "SO-9", name: "Bisoprolol" });
    await stock(itemId, "S-9", 10, 300);

    const opened = await openCount(ex(), { name: "Opname terkunci", actorId });
    const [line] = await db
      .select()
      .from(stockCountLines)
      .where(eq(stockCountLines.countId, opened.countId));

    await postCount(ex(), { countId: opened.countId, actorId });
    await expect(
      recordCount(ex(), { lineId: line.id, countedQty: 3, actorId }),
    ).rejects.toMatchObject({ code: "count_closed" });

    const [count] = await db
      .select()
      .from(stockCounts)
      .where(eq(stockCounts.id, opened.countId));
    expect(count.status).toBe("posted");
    expect(count.postedBy).toBe(actorId);
  });
});
