import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import {
  historyImports,
  historySaleLines,
  items,
  saleLines,
  settings,
  suppliers,
  taxRates,
  users,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { commitSale } from "@/lib/stock/sale";
import { commitReturn } from "@/lib/stock/return";
import { receiveStock, type Executor } from "@/lib/stock/ledger";
import { addDays, today } from "@/lib/format/date";
import {
  dailyRevenue,
  groupByCategory,
  itemSales,
  marginByItem,
  marginSummary,
  salesByCashier,
  salesByHour,
  salesByPaymentMethod,
  salesSummary,
  apportion,
} from "@/lib/reports/queries";
import { abcClasses, changeBps } from "@/lib/reports/analysis";
import { MAX_RANGE_DAYS, previousRange, resolveRange } from "@/lib/reports/catalogue";
import { isUuid } from "@/lib/format/ids";

/**
 * The sales statement, worked out by hand, with every deduction in play at
 * once: a discount, exclusive PPN, inclusive PPN, a refund, and imported
 * history -- one line of it with no cost, and one withdrawn import that must
 * count for nothing.
 *
 *   A  price 10.000, cost 6.000, taxed      B  price 5.000, cost 2.000, exempt
 *   C  price  1.000, cost   500
 *
 *   Sale 1, no tax:        2 A + 2 B = 30.000, discount 3.000  -> total 27.000 (tunai)
 *   Sale 2, 11% on top:    1 A + 1 B = 15.000, discount 1.500  -> taxable 9.000,
 *                          PPN 990                             -> total 14.490 (qris)
 *   Sale 3, 11% inside:    1 A       = 10.000                  -> PPN 991 inside,
 *                                                                 total 10.000 (transfer)
 *   Return from sale 2:    1 B, refund 5.000 × 14.490/15.000   =  4.830, of which PPN 330
 *
 *   History (active):      3 days ago, receipt N1: 2 A for 18.000, cost 6.000 each; 1 "Obat
 *                          Lama X" for 2.000, no cost (cashier "Lama", tunai)
 *                          2 days ago, no receipt: 5 C at 1.000, cost 500 (qris)
 *   History (withdrawn):   3 days ago: 99.999 of A, which must appear nowhere
 */
let db: TestDb;
let close: () => Promise<void>;
let cashierId: string;
let aId: string;
let bId: string;
let cId: string;

const ex = () => db as unknown as Executor;
const range = () => ({ from: addDays(today(), -7), to: today() });

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();

  [{ id: cashierId }] = await db
    .insert(users)
    .values({
      username: "kasir",
      fullName: "Siti Kasir",
      passwordHash: await hashPassword("a-long-enough-password"),
    })
    .returning({ id: users.id });
  const [{ id: supplierId }] = await db
    .insert(suppliers)
    .values({ name: "PT Sumber" })
    .returning({ id: suppliers.id });

  const make = async (code: string, name: string, price: number, exempt = false) => {
    const [row] = await db
      .insert(items)
      .values({
        code,
        genericName: name,
        form: "tablet",
        unit: "tablet",
        drugClass: "bebas",
        defaultPrice: price,
        isTaxExempt: exempt,
      })
      .returning({ id: items.id });
    return row.id;
  };
  aId = await make("AAA", "Alpha", 10_000);
  bId = await make("BBB", "Beta", 5_000, true);
  cId = await make("CCC", "Gamma", 1_000);

  const stock = (itemId: string, cost: number) =>
    receiveStock(ex(), {
      itemId,
      lotNumber: `L-${itemId.slice(0, 4)}`,
      expiryDate: addDays(today(), 400),
      supplierId,
      receivedDate: today(),
      qty: 100,
      unitCost: cost,
      performedBy: cashierId,
    });
  await stock(aId, 6_000);
  await stock(bId, 2_000);
  await stock(cId, 500);

  await commitSale(ex(), {
    actorId: cashierId,
    lines: [
      { itemId: aId, qty: 2, unitPrice: 10_000 },
      { itemId: bId, qty: 2, unitPrice: 5_000 },
    ],
    discount: 3_000,
    paymentMethod: "tunai",
  });

  await db.insert(taxRates).values({ name: "PPN", rateBps: 1100, effectiveFrom: addDays(today(), -30) });
  await db.update(settings).set({ taxEnabled: true, taxMode: "exclusive" }).where(eq(settings.id, 1));
  const second = await commitSale(ex(), {
    actorId: cashierId,
    lines: [
      { itemId: aId, qty: 1, unitPrice: 10_000 },
      { itemId: bId, qty: 1, unitPrice: 5_000 },
    ],
    discount: 1_500,
    paymentMethod: "qris",
  });
  expect(second.taxAmount).toBe(990);
  expect(second.total).toBe(14_490);

  await db.update(settings).set({ taxMode: "inclusive" }).where(eq(settings.id, 1));
  const third = await commitSale(ex(), {
    actorId: cashierId,
    lines: [{ itemId: aId, qty: 1, unitPrice: 10_000 }],
    paymentMethod: "transfer",
  });
  expect(third.taxAmount).toBe(991);
  await db.update(settings).set({ taxEnabled: false }).where(eq(settings.id, 1));

  const lines = await db.select().from(saleLines).where(eq(saleLines.saleId, second.saleId));
  const beta = lines.find((line) => line.itemId === bId)!;
  const refund = await commitReturn(ex(), {
    saleId: second.saleId,
    actorId: cashierId,
    lines: [{ saleLineId: beta.id, qty: 1 }],
    refundMethod: "tunai",
    reason: "Tidak jadi",
  });
  expect(refund.refundTotal).toBe(4_830);

  const [active] = await db
    .insert(historyImports)
    .values({
      importNumber: "H000000-0001",
      fileHash: "active",
      lineCount: 3,
      firstDay: addDays(today(), -3),
      lastDay: addDays(today(), -2),
      total: 25_000,
      importedBy: cashierId,
    })
    .returning({ id: historyImports.id });
  await db.insert(historySaleLines).values([
    {
      importId: active.id,
      sourceRow: 2,
      soldOn: addDays(today(), -3),
      receiptNumber: "N1",
      itemId: aId,
      itemName: "Alpha",
      qty: 2,
      unitPrice: 9_000,
      lineTotal: 18_000,
      unitCost: 6_000,
      paymentMethod: "tunai",
      cashierName: "Lama",
    },
    {
      importId: active.id,
      sourceRow: 3,
      soldOn: addDays(today(), -3),
      receiptNumber: "N1",
      itemId: null,
      itemName: "Obat Lama X",
      qty: 1,
      unitPrice: 2_000,
      lineTotal: 2_000,
      unitCost: null,
      paymentMethod: "tunai",
      cashierName: "Lama",
    },
    {
      importId: active.id,
      sourceRow: 4,
      soldOn: addDays(today(), -2),
      receiptNumber: null,
      itemId: cId,
      itemName: "Gamma",
      qty: 5,
      unitPrice: 1_000,
      lineTotal: 5_000,
      unitCost: 500,
      paymentMethod: "qris",
      cashierName: null,
    },
  ]);

  const [withdrawn] = await db
    .insert(historyImports)
    .values({
      importNumber: "H000000-0002",
      fileHash: "withdrawn",
      lineCount: 1,
      firstDay: addDays(today(), -3),
      lastDay: addDays(today(), -3),
      total: 99_999,
      importedBy: cashierId,
      status: "withdrawn",
      withdrawnBy: cashierId,
      withdrawnAt: new Date(),
      withdrawReason: "Terimpor dua kali",
    })
    .returning({ id: historyImports.id });
  await db.insert(historySaleLines).values({
    importId: withdrawn.id,
    sourceRow: 2,
    soldOn: addDays(today(), -3),
    receiptNumber: "N9",
    itemId: aId,
    itemName: "Alpha",
    qty: 9,
    unitPrice: 11_111,
    lineTotal: 99_999,
    unitCost: 1,
    paymentMethod: "tunai",
    cashierName: "Lama",
  });
});

afterAll(async () => close());

describe("the sales statement", () => {
  it("adds up line by line, to the rupiah", async () => {
    const s = await salesSummary(ex(), range());

    expect(s.gross).toBe(55_000 + 25_000);
    expect(s.discount).toBe(4_500);
    expect(s.taxIncluded).toBe(991);
    expect(s.refunds).toBe(4_830);
    expect(s.refundTax).toBe(330);
    expect(s.refundsExTax).toBe(4_500);
    expect(s.net).toBe(80_000 - 4_500 - 991 - 4_500);
    expect(s.tax).toBe(990 + 991);
    expect(s.taxNet).toBe(1_981 - 330);
    expect(s.revenue).toBe(27_000 + 14_490 + 10_000 + 25_000);
    expect(s.collected).toBe(76_490 - 4_830);
    // The statement closes: net sales plus the PPN kept is what was kept.
    expect(s.net + s.taxNet).toBe(s.collected);
  });

  it("counts old receipts as transactions, and lines without one only as takings", async () => {
    const s = await salesSummary(ex(), range());

    expect(s.transactions).toBe(3 + 1);
    expect(s.units).toBe(7 + 8);
    expect(s.history).toMatchObject({
      lines: 3,
      revenue: 25_000,
      units: 8,
      receipts: 1,
      withoutReceipt: 1,
      withoutReceiptRevenue: 5_000,
    });
    // (76.490 − the 5.000 that belongs to no basket) / 4 baskets
    expect(s.averageSale).toBe(Math.round(71_490 / 4));
  });

  it("ignores a withdrawn import everywhere", async () => {
    const rows = await itemSales(ex(), range());
    expect(rows.reduce((sum, r) => sum + r.historyRevenue, 0)).toBe(25_000);
    const byCashier = await salesByCashier(ex(), range());
    expect(byCashier.find((r) => r.fromHistory && r.name === "Lama")?.revenue).toBe(20_000);
  });
});

describe("sales per product", () => {
  it("spreads each sale's discount and inclusive PPN over its lines", async () => {
    const rows = await itemSales(ex(), range());
    const alpha = rows.find((r) => r.itemId === aId)!;

    expect(alpha.qtySold).toBe(2 + 1 + 1 + 2);
    expect(alpha.revenue).toBe(20_000 + 10_000 + 10_000 + 18_000);
    expect(alpha.discount).toBe(2_000 + 1_000);
    expect(alpha.taxIncluded).toBe(991);
    expect(alpha.revenueNet).toBe(58_000 - 3_000 - 991);
    expect(alpha.cost).toBe(4 * 6_000 + 2 * 6_000);
    expect(alpha.historyRevenue).toBe(18_000);
  });

  it("takes a refund off without its PPN, and the cost back with the unit", async () => {
    const rows = await itemSales(ex(), range());
    const beta = rows.find((r) => r.itemId === bId)!;

    expect(beta).toMatchObject({
      qtySold: 3,
      qtyReturned: 1,
      qtyNet: 2,
      revenue: 15_000,
      discount: 1_500,
      refunded: 4_500,
      revenueNet: 9_000,
      cost: 3 * 2_000 - 2_000,
    });
  });

  it("keeps an imported name that is not in the catalogue as its own row", async () => {
    const rows = await itemSales(ex(), range());
    const old = rows.find((r) => r.itemId === null)!;

    expect(old).toMatchObject({
      key: "name:obat lama x",
      name: "Obat Lama X",
      code: "",
      revenueNet: 2_000,
      historyUncostedRevenue: 2_000,
    });
  });

  it("adds up to the statement's net sales, and so do the categories", async () => {
    const rows = await itemSales(ex(), range());
    const s = await salesSummary(ex(), range());
    const net = rows.reduce((sum, r) => sum + r.revenueNet, 0);

    expect(net).toBe(s.net);
    expect(groupByCategory(rows).reduce((sum, r) => sum + r.revenue, 0)).toBe(s.net);
  });

  it("ranks products into ABC classes by their share of net sales", async () => {
    const rows = await itemSales(ex(), range());
    const classes = abcClasses(rows);

    // Alpha alone is 77% of net sales, so it opens the A class and Beta, which
    // starts below 80%, joins it; Gamma starts past 90% and is B; the rest C.
    expect(classes.get(aId)).toBe("A");
    expect(classes.get(bId)).toBe("A");
    expect(classes.get(cId)).toBe("B");
    expect(classes.get("name:obat lama x")).toBe("C");
  });
});

describe("margin", () => {
  it("leaves imported lines with no cost out rather than calling them pure profit", async () => {
    const rows = await marginByItem(ex(), range());
    expect(rows.find((r) => r.itemId === null)).toBeUndefined();

    const summary = await marginSummary(ex(), range());
    expect(summary.revenue).toBe(54_009 + 9_000 + 5_000);
    expect(summary.cost).toBe(36_000 + 4_000 + 2_500);
    expect(summary.margin).toBe(68_009 - 42_500);
    expect(summary.uncostedRevenue).toBe(2_000);
  });
});

describe("the breakdowns", () => {
  it("takes refunds off the method they were paid back by", async () => {
    const rows = await salesByPaymentMethod(ex(), range());
    const cash = rows.find((r) => r.method === "tunai")!;

    expect(cash).toEqual({
      method: "tunai",
      transactions: 2,
      revenue: 27_000 + 20_000,
      refunds: 4_830,
      net: 47_000 - 4_830,
    });
    expect(rows.find((r) => r.method === "qris")).toMatchObject({
      transactions: 1,
      revenue: 14_490 + 5_000,
    });
  });

  it("files history under its own day, and counts receipts, not lines", async () => {
    const series = await dailyRevenue(ex(), range());
    const on = (day: string) => series.find((point) => point.day === day)!;

    expect(on(today()).total).toBe(51_490);
    expect(on(addDays(today(), -3))).toMatchObject({ total: 20_000, count: 1 });
    expect(on(addDays(today(), -2))).toMatchObject({ total: 5_000, count: 0 });
  });

  it("buckets the till by hour of the day, all 24 of them", async () => {
    const hours = await salesByHour(ex(), range());
    expect(hours).toHaveLength(24);
    expect(hours.reduce((sum, h) => sum + h.count, 0)).toBe(3);
    expect(hours.reduce((sum, h) => sum + h.total, 0)).toBe(51_490);
  });
});

describe("comparing periods", () => {
  it("compares a rolling window with the same number of days before it", () => {
    expect(previousRange({ from: "2026-08-27", to: "2026-09-25", preset: "30d" })).toEqual({
      from: "2026-07-28",
      to: "2026-08-26",
    });
    expect(previousRange({ from: "2026-09-25", to: "2026-09-25", preset: "today" })).toEqual({
      from: "2026-09-24",
      to: "2026-09-24",
    });
  });

  it("compares calendar months as calendar months", () => {
    const monthToDate = resolveRange({ preset: "month", on: "2026-09-25" });
    expect(previousRange(monthToDate)).toEqual({ from: "2026-08-01", to: "2026-08-25" });

    // March 31st so far against February, which has no 31st.
    const endOfMarch = resolveRange({ preset: "month", on: "2026-03-31" });
    expect(previousRange(endOfMarch)).toEqual({ from: "2026-02-01", to: "2026-02-28" });

    const lastMonth = resolveRange({ preset: "lastMonth", on: "2026-01-10" });
    expect(lastMonth).toMatchObject({ from: "2025-12-01", to: "2025-12-31" });
    expect(previousRange(lastMonth)).toEqual({ from: "2025-11-01", to: "2025-11-30" });
  });

  it("gives no percentage when there is nothing to compare with", () => {
    expect(changeBps(150, 100)).toBe(5_000);
    expect(changeBps(50, 100)).toBe(-5_000);
    expect(changeBps(100, 0)).toBeNull();
  });
});

describe("apportioning whole rupiah", () => {
  it("rounds shares so they add up to the rounded total, each within a rupiah", () => {
    // A Rp 1.000 discount over three equal lines: 333,33 each.
    const shares = [1000 / 3, 1000 / 3, 1000 / 3];
    const whole = apportion(shares);
    expect(whole.reduce((a, b) => a + b, 0)).toBe(1_000);
    whole.forEach((value, i) => expect(Math.abs(value - shares[i])).toBeLessThan(1));

    // Seven tiny shares that each round to zero still add up to their total.
    const tiny = Array.from({ length: 7 }, () => 0.5);
    expect(apportion(tiny).reduce((a, b) => a + b, 0)).toBe(4);
    expect(apportion([])).toEqual([]);
  });
});

describe("what a report link can carry", () => {
  it("falls back to the default period for a date that does not exist, never a server error", () => {
    // Both pass a YYYY-MM-DD pattern; Postgres would refuse them mid-query.
    const range = resolveRange({ from: "2026-02-30", to: "2026-13-45", on: "2026-09-25" });
    expect(range).toEqual({ from: "2026-08-27", to: "2026-09-25", preset: "30d" });
    expect(resolveRange({ from: "1999-12-31", to: "2026-01-01", on: "2026-09-25" }).preset).toBe("30d");
  });

  it("swaps reversed dates and caps a window at three years", () => {
    expect(resolveRange({ from: "2026-09-25", to: "2026-09-01" })).toMatchObject({
      from: "2026-09-01",
      to: "2026-09-25",
    });
    const long = resolveRange({ from: "2001-01-01", to: "2026-09-25" });
    expect(long.to).toBe("2026-09-25");
    expect(long.from).toBe(addDays("2026-09-25", -(MAX_RANGE_DAYS - 1)));
  });

  it("recognises a record id before it reaches the database", () => {
    expect(isUuid("3f1c2b7a-9d4e-4c1b-8a2f-6e5d4c3b2a10")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(["3f1c2b7a-9d4e-4c1b-8a2f-6e5d4c3b2a10"])).toBe(false);
  });
});
