import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import {
  batches,
  categories,
  items,
  saleLines,
  settings,
  suppliers,
  users,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { commitSale, reverseSale } from "@/lib/stock/sale";
import { commitReturn } from "@/lib/stock/return";
import { disposeStock } from "@/lib/stock/disposal";
import { receiveStock, type Executor } from "@/lib/stock/ledger";
import { addDays, today } from "@/lib/format/date";
import {
  dailyRevenue,
  disposalReasons,
  expiryLoss,
  expiryLossByMonth,
  marginByItem,
  marginSummary,
  movementLedger,
  movementTotalsByItem,
  salesByCashier,
  salesByCategory,
  salesByItem,
  salesByPaymentMethod,
  salesSummary,
  supplierHistory,
  valuationByCategory,
  valuationByExpiry,
} from "@/lib/reports/queries";

/**
 * One fixture with an answer worked out by hand, so every assertion below is a
 * number somebody could check on paper rather than a shape.
 *
 *   Paracetamol  sold 10 @ Rp 1.000, cost Rp 400  -> revenue 10.000, cost 4.000
 *   Amoxicillin  sold  5 @ Rp 2.000, cost Rp 900  -> revenue 10.000, cost 4.500
 *                then 2 returned                  -> refund 4.000, cost back 1.800
 *   Vitamin C    sold  4 @ Rp 5.000  then VOIDED   -> counts for nothing
 *   Ibuprofen    20 units disposed @ cost Rp 700   -> written off 14.000
 */
let db: TestDb;
let close: () => Promise<void>;
let cashierId: string;
let otherCashierId: string;
let supplierId: string;
let slowSupplierId: string;
let analgesicId: string;
let antibioticId: string;

const ex = () => db as unknown as Executor;
const range = () => ({ from: addDays(today(), -7), to: today() });

let paracetamolId: string;
let amoxicillinId: string;
let vitaminId: string;
let ibuprofenId: string;
let ibuprofenBatchId: string;
let amoxicillinSaleLineId: string;

async function makeItem(opts: {
  code: string;
  name: string;
  categoryId: string;
  price: number;
}) {
  const [item] = await db
    .insert(items)
    .values({
      code: opts.code,
      genericName: opts.name,
      form: "tablet",
      unit: "tablet",
      categoryId: opts.categoryId,
      drugClass: "bebas",
      defaultPrice: opts.price,
    })
    .returning({ id: items.id });
  return item.id;
}

async function stock(itemId: string, lot: string, qty: number, cost: number, supplier = supplierId) {
  const { batchId } = await receiveStock(ex(), {
    itemId,
    lotNumber: lot,
    expiryDate: addDays(today(), 300),
    supplierId: supplier,
    receivedDate: today(),
    qty,
    unitCost: cost,
    performedBy: cashierId,
  });
  return batchId;
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

  [{ id: otherCashierId }] = await db
    .insert(users)
    .values({
      username: "manajer",
      fullName: "Budi Manajer",
      passwordHash: await hashPassword("a-long-enough-password"),
    })
    .returning({ id: users.id });

  [{ id: supplierId }] = await db
    .insert(suppliers)
    .values({ name: "PT Sumber Sehat" })
    .returning({ id: suppliers.id });

  [{ id: slowSupplierId }] = await db
    .insert(suppliers)
    .values({ name: "PT Kirim Lambat" })
    .returning({ id: suppliers.id });

  [{ id: analgesicId }] = await db
    .insert(categories)
    .values({ name: "Analgesik" })
    .returning({ id: categories.id });
  [{ id: antibioticId }] = await db
    .insert(categories)
    .values({ name: "Antibiotik" })
    .returning({ id: categories.id });

  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();

  paracetamolId = await makeItem({
    code: "PARA",
    name: "Paracetamol",
    categoryId: analgesicId,
    price: 1_000,
  });
  amoxicillinId = await makeItem({
    code: "AMOX",
    name: "Amoxicillin",
    categoryId: antibioticId,
    price: 2_000,
  });
  vitaminId = await makeItem({
    code: "VITC",
    name: "Vitamin C",
    categoryId: analgesicId,
    price: 5_000,
  });
  ibuprofenId = await makeItem({
    code: "IBUP",
    name: "Ibuprofen",
    categoryId: analgesicId,
    price: 800,
  });

  await stock(paracetamolId, "P-1", 500, 400);
  await stock(amoxicillinId, "A-1", 200, 900);
  await stock(vitaminId, "V-1", 100, 2_000);
  // Delivered by the slow supplier, and destined for the bin.
  ibuprofenBatchId = await stock(ibuprofenId, "I-1", 20, 700, slowSupplierId);

  await commitSale(ex(), {
    actorId: cashierId,
    lines: [{ itemId: paracetamolId, qty: 10, unitPrice: 1_000 }],
    paymentMethod: "tunai",
  });

  const amoxSale = await commitSale(ex(), {
    actorId: otherCashierId,
    lines: [{ itemId: amoxicillinId, qty: 5, unitPrice: 2_000 }],
    paymentMethod: "qris",
  });
  [{ id: amoxicillinSaleLineId }] = await db
    .select({ id: saleLines.id })
    .from(saleLines)
    .where(eq(saleLines.saleId, amoxSale.saleId));

  await commitReturn(ex(), {
    saleId: amoxSale.saleId,
    actorId: cashierId,
    lines: [{ saleLineId: amoxicillinSaleLineId, qty: 2 }],
    refundMethod: "tunai",
    reason: "Salah dosis",
  });

  const voided = await commitSale(ex(), {
    actorId: cashierId,
    lines: [{ itemId: vitaminId, qty: 4, unitPrice: 5_000 }],
    paymentMethod: "tunai",
  });
  await reverseSale(ex(), {
    saleId: voided.saleId,
    actorId: cashierId,
    reason: "Salah input",
  });

  await disposeStock(ex(), {
    batchId: ibuprofenBatchId,
    qty: 20,
    reason: "Kedaluwarsa",
    actorId: cashierId,
  });
});

afterAll(async () => close());

describe("sales reporting", () => {
  it("nets refunds off revenue and reports them separately", async () => {
    const summary = await salesSummary(ex(), range());

    // 10.000 paracetamol + 10.000 amoxicillin. The voided 20.000 is not here.
    expect(summary.revenue).toBe(20_000);
    expect(summary.refunds).toBe(4_000);
    expect(summary.net).toBe(16_000);
    expect(summary.transactions).toBe(2);
    expect(summary.voided).toBe(1);
    expect(summary.returns).toBe(1);
  });

  it("leaves a voided sale out of every figure", async () => {
    const byItem = await salesByItem(ex(), range());
    expect(byItem.find((row) => row.code === "VITC")).toBeUndefined();

    const byCategory = await salesByCategory(ex(), range());
    const analgesic = byCategory.find((row) => row.name === "Analgesik");
    // Only the paracetamol; the voided Rp 20.000 of vitamin C is in the same
    // category and must not appear.
    expect(analgesic?.revenue).toBe(10_000);
  });

  it("deducts returned units from the item that came back", async () => {
    const rows = await salesByItem(ex(), range());
    const amox = rows.find((row) => row.code === "AMOX");

    expect(amox?.qtySold).toBe(5);
    expect(amox?.qtyReturned).toBe(2);
    expect(amox?.qtyNet).toBe(3);
    expect(amox?.revenue).toBe(10_000);
    expect(amox?.revenueNet).toBe(6_000);
  });

  it("splits the takings by cashier and by payment method", async () => {
    const byCashier = await salesByCashier(ex(), range());
    expect(byCashier.find((r) => r.name === "Siti Kasir")?.revenue).toBe(10_000);
    expect(byCashier.find((r) => r.name === "Budi Manajer")?.revenue).toBe(10_000);

    const byMethod = await salesByPaymentMethod(ex(), range());
    expect(byMethod.find((r) => r.method === "qris")?.revenue).toBe(10_000);
    expect(byMethod.find((r) => r.method === "tunai")?.revenue).toBe(10_000);
  });

  it("returns one point per day, including days with no trade", async () => {
    const series = await dailyRevenue(ex(), range());

    expect(series).toHaveLength(8);
    expect(series.at(-1)?.day).toBe(today());
    expect(series.at(-1)?.total).toBe(20_000);
    // A quiet day is a zero, not a gap -- a line that skipped it would slope
    // through and imply trade that did not happen.
    expect(series[0].total).toBe(0);
  });
});

describe("margin", () => {
  it("prices cost of goods from the snapshot on the sale line", async () => {
    const before = await marginSummary(ex(), range());

    // Paracetamol 10 × 400 = 4.000; amoxicillin 5 × 900 = 4.500 less 2 × 900
    // returned = 2.700. Revenue 20.000 less the 4.000 refund = 16.000.
    expect(before.revenue).toBe(16_000);
    expect(before.cost).toBe(6_700);
    expect(before.margin).toBe(9_300);

    // The next delivery costs half as much. Last week's margin must not move.
    await db
      .update(batches)
      .set({ unitCost: 200 })
      .where(eq(batches.itemId, paracetamolId));

    const after = await marginSummary(ex(), range());
    expect(after).toEqual(before);
  });

  it("reports margin per item as basis points, never a float", async () => {
    const rows = await marginByItem(ex(), range());
    const para = rows.find((row) => row.code === "PARA");

    expect(para?.revenue).toBe(10_000);
    expect(para?.cost).toBe(4_000);
    expect(para?.margin).toBe(6_000);
    expect(para?.marginBps).toBe(6_000); // 60.00%
    expect(Number.isInteger(para?.marginBps)).toBe(true);
  });

  it("takes back the cost of a returned unit, not just its price", async () => {
    const rows = await marginByItem(ex(), range());
    const amox = rows.find((row) => row.code === "AMOX");

    expect(amox?.revenue).toBe(6_000); // 10.000 − 4.000 refunded
    expect(amox?.cost).toBe(2_700); // 4.500 − 1.800 back on the shelf
    expect(amox?.margin).toBe(3_300);
  });
});

describe("valuation", () => {
  it("values only what is actually sellable, at what it cost", async () => {
    const rows = await valuationByCategory(ex());
    const antibiotik = rows.find((row) => row.name === "Antibiotik");

    // 200 received less 5 sold = 195 on hand at Rp 900. The two returned units
    // sit in a quarantined batch and are deliberately not counted as sellable.
    expect(antibiotik?.units).toBe(195);
    expect(antibiotik?.value).toBe(195 * 900);
  });

  it("arranges the same money by how long there is to sell it", async () => {
    const buckets = await valuationByExpiry(ex(), today());

    // Everything in the fixture expires in 300 days except the disposed batch,
    // which no longer holds anything.
    expect(buckets.within30.value).toBe(0);
    expect(buckets.beyond.units).toBeGreaterThan(0);
    expect(buckets.expired.value).toBe(0);
  });
});

describe("expiry loss", () => {
  it("reports the write-off at the cost snapshotted when it was destroyed", async () => {
    const rows = await expiryLoss(ex(), range());
    const ibuprofen = rows.find((row) => row.code === "IBUP");

    expect(ibuprofen?.qty).toBe(20);
    expect(ibuprofen?.value).toBe(14_000);
    expect(ibuprofen?.events).toBe(1);
  });

  it("groups write-offs by month and by stated reason", async () => {
    const months = await expiryLossByMonth(ex(), range());
    expect(months.reduce((sum, m) => sum + m.value, 0)).toBe(14_000);
    expect(months[0].month).toMatch(/^\d{4}-\d{2}$/u);

    const reasons = await disposalReasons(ex(), range());
    expect(reasons.find((r) => r.reason === "Kedaluwarsa")?.value).toBe(14_000);
  });
});

describe("supplier history", () => {
  it("shows what each supplier delivered and how much of it was binned", async () => {
    const rows = await supplierHistory(ex(), range());

    const good = rows.find((row) => row.name === "PT Sumber Sehat");
    expect(good?.disposedValue).toBe(0);
    expect(good?.disposalBps).toBe(0);

    // Everything this one sent was written off. That is the column worth
    // having: cheap stock that expires before it sells is not cheap.
    const slow = rows.find((row) => row.name === "PT Kirim Lambat");
    expect(slow?.value).toBe(14_000);
    expect(slow?.disposedValue).toBe(14_000);
    expect(slow?.disposalBps).toBe(10_000); // 100%
  });

  it("does not count a returned batch as a delivery", async () => {
    const rows = await supplierHistory(ex(), range());
    const supplier = rows.find((row) => row.name === "PT Sumber Sehat");

    // Three batches were received from them. The two amoxicillin units that
    // came back created a fourth batch carrying their supplier and lot, but
    // nobody delivered it, and counting it would make the pharmacy's own
    // returns look like supplier shipments.
    expect(supplier?.deliveries).toBe(3);
    expect(supplier?.units).toBe(500 + 200 + 100);
  });
});

describe("date windows", () => {
  it("excludes anything outside the range", async () => {
    const lastMonth = { from: addDays(today(), -60), to: addDays(today(), -31) };
    const summary = await salesSummary(ex(), lastMonth);

    expect(summary.revenue).toBe(0);
    expect(summary.transactions).toBe(0);
    expect(await expiryLoss(ex(), lastMonth)).toHaveLength(0);
    expect(await salesByItem(ex(), lastMonth)).toHaveLength(0);
  });
});

/**
 * The movement ledger, per item.
 *
 * Worked out from the same fixture, by hand:
 *
 *   Paracetamol  received 500, sold 10              -> in 500, out 10,  net 490
 *   Amoxicillin  received 200, sold 5, 2 returned   -> in 202, out 5,   net 197
 *                (the 2 come back as a quarantined child batch, so they are a
 *                 movement in, not a smaller movement out)
 *   Vitamin C    received 100, sold 4, sale voided  -> in 104, out 4,   net 100
 *   Ibuprofen    received 20, all 20 disposed       -> in 20,  out 20,  net 0
 */
describe("movement reporting", () => {
  it("splits each item's signed deltas into units in and units out", async () => {
    const rows = await movementTotalsByItem(ex(), range());
    const find = (id: string) => rows.find((row) => row.itemId === id)!;

    expect(find(paracetamolId)).toMatchObject({ qtyIn: 500, qtyOut: 10, net: 490 });
    expect(find(amoxicillinId)).toMatchObject({ qtyIn: 202, qtyOut: 5, net: 197 });
    expect(find(vitaminId)).toMatchObject({ qtyIn: 104, qtyOut: 4, net: 100 });
    expect(find(ibuprofenId)).toMatchObject({ qtyIn: 20, qtyOut: 20, net: 0 });
  });

  it("keeps a voided sale as stock coming back in, not as a sale that shrank", async () => {
    const rows = await movementTotalsByItem(ex(), range());
    const vitamin = rows.find((row) => row.itemId === vitaminId)!;

    const sale = vitamin.byType.find((bucket) => bucket.type === "sale")!;
    const undone = vitamin.byType.find((bucket) => bucket.type === "sale_void")!;

    expect(sale).toMatchObject({ qtyOut: 4, qtyIn: 0 });
    expect(undone).toMatchObject({ qtyIn: 4, qtyOut: 0 });
  });

  it("names the person and the document behind every movement", async () => {
    const { rows } = await movementLedger(ex(), { ...range(), itemId: ibuprofenId });

    const disposal = rows.find((row) => row.type === "dispose")!;
    expect(disposal.qtyDelta).toBe(-20);
    expect(disposal.performedBy).toBe("Siti Kasir");
    expect(disposal.document).toMatch(/^D\d{6}-\d{4}$/u);
    expect(disposal.reason).toBe("Kedaluwarsa");

    // Receiving has no document of its own; the lot number is what identifies it.
    const received = rows.find((row) => row.type === "receive")!;
    expect(received).toMatchObject({ qtyDelta: 20, lotNumber: "I-1", document: null });
  });

  it("says when the list is capped instead of letting it look like a quiet period", async () => {
    const capped = await movementLedger(ex(), { ...range(), limit: 2 });
    expect(capped.rows).toHaveLength(2);
    expect(capped.truncated).toBe(true);

    // The totals are not capped with it: they come from the aggregate query.
    const totals = await movementTotalsByItem(ex(), range());
    expect(totals.reduce((sum, row) => sum + row.events, 0)).toBeGreaterThan(2);

    const uncapped = await movementLedger(ex(), { ...range(), limit: null });
    expect(uncapped.truncated).toBe(false);
    expect(uncapped.rows.length).toBeGreaterThan(2);
  });

  it("counts nothing outside the window", async () => {
    const past = { from: addDays(today(), -30), to: addDays(today(), -10) };
    expect(await movementTotalsByItem(ex(), past)).toEqual([]);
    expect((await movementLedger(ex(), past)).rows).toEqual([]);
  });
});
