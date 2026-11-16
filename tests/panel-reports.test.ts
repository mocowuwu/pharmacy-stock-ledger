import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "./helpers/db";
import { items, settings, suppliers, users } from "@/db/schema";
import type { Database } from "@/db/client";
import { commitSale } from "@/lib/stock/sale";
import { receiveStock, type Executor } from "@/lib/stock/ledger";
import { addDays, today } from "@/lib/format/date";
import { recordPanelEntry, voidPanelEntry, type PanelInput } from "@/lib/panel/entries";
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
} from "@/lib/reports/queries";

/**
 * Panel Apotek money in the main figures, worked out by hand.
 *
 *   Till:   2 x Alpha at 10.000 = 20.000, cost 6.000 each        (tunai)
 *
 *   Panel (in the window):
 *     P1  code "aaa" (Alpha, by case-blind match)  10 x 8.000, cost 5.500  1 day ago
 *     P2  code "xxx", "Obat  Manual"                3 x 1.500, cost 1.000  2 days ago
 *     P3  code "XXX", "obat manual" (same name)     2 x 1.500, cost 1.000  2 days ago
 *   Panel (counting for nothing):
 *     P4  Alpha, 99 x 9.999 -- voided
 *     P5  Alpha, 50 x 1.000 -- 30 days ago, outside the window
 *
 * Panel revenue 80.000 + 4.500 + 3.000 = 87.500; panel cost 55.000 + 3.000 + 2.000 = 60.000.
 */
let db: TestDb;
let close: () => Promise<void>;
let cashierId: string;
let alphaId: string;

const ex = () => db as unknown as Executor;
const range = () => ({ from: addDays(today(), -7), to: today() });

const entry = (over: Partial<PanelInput>): PanelInput & { actorId: string } => ({
  entryDate: today(),
  orderRef: "SP/1",
  itemCode: "xxx",
  itemName: "Manual",
  unit: "tablet",
  qty: 1,
  unitCost: 0,
  unitPrice: 0,
  partnerName: null,
  destination: "dr. Budi",
  notes: null,
  pharmacistId: null,
  actorId: cashierId,
  ...over,
});

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
  [{ id: cashierId }] = await db
    .insert(users)
    .values({ username: "kasir", fullName: "Siti Kasir", passwordHash: "x" })
    .returning({ id: users.id });
  const [{ id: supplierId }] = await db
    .insert(suppliers)
    .values({ name: "PT Sumber" })
    .returning({ id: suppliers.id });

  [{ id: alphaId }] = await db
    .insert(items)
    .values({
      code: "AAA",
      genericName: "Alpha",
      form: "tablet",
      unit: "tablet",
      drugClass: "bebas",
      defaultPrice: 10_000,
    })
    .returning({ id: items.id });
  await receiveStock(ex(), {
    itemId: alphaId,
    lotNumber: "L-A",
    expiryDate: addDays(today(), 400),
    supplierId,
    receivedDate: today(),
    qty: 100,
    unitCost: 6_000,
    performedBy: cashierId,
  });

  await commitSale(ex(), {
    actorId: cashierId,
    lines: [{ itemId: alphaId, qty: 2, unitPrice: 10_000 }],
    paymentMethod: "tunai",
  });

  const pdb = db as unknown as Database;
  await recordPanelEntry(pdb, entry({
    itemCode: "aaa", itemName: "Alpha", qty: 10, unitCost: 5_500, unitPrice: 8_000, entryDate: addDays(today(), -1),
  }));
  await recordPanelEntry(pdb, entry({
    itemCode: "xxx", itemName: "Obat  Manual", qty: 3, unitCost: 1_000, unitPrice: 1_500, entryDate: addDays(today(), -2),
  }));
  await recordPanelEntry(pdb, entry({
    itemCode: "XXX", itemName: "obat manual", qty: 2, unitCost: 1_000, unitPrice: 1_500, entryDate: addDays(today(), -2),
  }));
  const voided = await recordPanelEntry(pdb, entry({
    itemCode: "AAA", itemName: "Alpha", qty: 99, unitCost: 1, unitPrice: 9_999, entryDate: addDays(today(), -1),
  }));
  await voidPanelEntry(pdb, { entryId: voided.id, reason: "Wrong order", actorId: cashierId });
  await recordPanelEntry(pdb, entry({
    itemCode: "AAA", itemName: "Alpha", qty: 50, unitCost: 1, unitPrice: 1_000, entryDate: addDays(today(), -30),
  }));
});

afterAll(async () => close());

describe("the sales statement with Panel entries", () => {
  it("adds their money and units, and still closes to the rupiah", async () => {
    const s = await salesSummary(ex(), range());

    expect(s.panel).toEqual({ entries: 3, revenue: 87_500, units: 15, tax: 0 });
    expect(s.gross).toBe(20_000 + 87_500);
    expect(s.revenue).toBe(107_500);
    expect(s.net).toBe(107_500);
    expect(s.collected).toBe(107_500);
    expect(s.units).toBe(2 + 15);
    // The statement closes: net sales plus the PPN kept is what was kept.
    expect(s.net + s.taxNet).toBe(s.collected);
  });

  it("is not a till basket: no transaction, and the average sale stays the till's", async () => {
    const s = await salesSummary(ex(), range());
    expect(s.transactions).toBe(1);
    // Averaging a doctor's order in would make every ordinary sale look small.
    expect(s.averageSale).toBe(20_000);
  });

  it("leaves out a voided entry and one outside the window", async () => {
    // 99 x 9.999 (voided) and 50 x 1.000 (30 days ago) would add 1.038.901 and 50.000.
    const s = await salesSummary(ex(), range());
    expect(s.panel.revenue).toBe(87_500);
    const wide = await salesSummary(ex(), { from: addDays(today(), -40), to: today() });
    expect(wide.panel.revenue).toBe(87_500 + 50_000);
  });

  it("copes with a window that holds only Panel entries", async () => {
    const day = addDays(today(), -1);
    const s = await salesSummary(ex(), { from: day, to: day });
    expect(s.revenue).toBe(80_000);
    expect(s.transactions).toBe(0);
    expect(s.averageSale).toBe(0);
  });
});

describe("the breakdowns with Panel entries", () => {
  it("files each entry under its own day, with no transactions", async () => {
    const series = await dailyRevenue(ex(), range());
    const at = (offset: number) => series.find((row) => row.day === addDays(today(), offset))!;

    expect(at(-1)).toMatchObject({ total: 80_000, count: 0 });
    expect(at(-2)).toMatchObject({ total: 7_500, count: 0 });
    expect(at(0)).toMatchObject({ total: 20_000, count: 1 });
    expect(series.reduce((sum, row) => sum + row.total, 0)).toBe(107_500);
  });

  it("joins an entry to the catalogue item its code names, whatever the case", async () => {
    const rows = await itemSales(ex(), range());
    const alpha = rows.find((row) => row.itemId === alphaId)!;

    expect(alpha.qtySold).toBe(2 + 10);
    expect(alpha.revenue).toBe(20_000 + 80_000);
    expect(alpha.panelRevenue).toBe(80_000);
    // Cost is the till's snapshot plus the entry's own unit cost.
    expect(alpha.cost).toBe(2 * 6_000 + 10 * 5_500);
  });

  it("groups an entry the catalogue does not know by its name as written", async () => {
    const rows = await itemSales(ex(), range());
    const manual = rows.filter((row) => row.itemId === null);

    // "Obat  Manual" and "obat manual" are one row, as two unlinked history lines would be.
    expect(manual).toHaveLength(1);
    expect(manual[0].key).toBe("name:obat manual");
    expect(manual[0]).toMatchObject({ qtySold: 5, revenue: 7_500, cost: 5_000, panelRevenue: 7_500 });
    expect(manual[0].categoryName).toBeNull();
  });

  it("adds up: products, categories and the statement agree on net sales", async () => {
    const rows = await itemSales(ex(), range());
    const s = await salesSummary(ex(), range());

    expect(rows.reduce((sum, row) => sum + row.revenueNet, 0)).toBe(s.net);
    expect(groupByCategory(rows).reduce((sum, row) => sum + row.revenue, 0)).toBe(s.net);
  });

  it("puts the money in the cashier and payment tables without inventing baskets", async () => {
    const s = await salesSummary(ex(), range());

    const cashiers = await salesByCashier(ex(), range());
    const panelRow = cashiers.find((row) => row.fromPanel)!;
    expect(panelRow).toMatchObject({ revenue: 87_500, transactions: 0, fromHistory: false, cashierId: null });
    expect(cashiers.find((row) => row.cashierId === cashierId)).toMatchObject({ revenue: 20_000, transactions: 1 });
    expect(cashiers.reduce((sum, row) => sum + row.revenue, 0)).toBe(s.revenue);
    expect(cashiers.reduce((sum, row) => sum + row.transactions, 0)).toBe(s.transactions);

    const methods = await salesByPaymentMethod(ex(), range());
    expect(methods.find((row) => row.method === "unrecorded")).toMatchObject({ revenue: 87_500, transactions: 0 });
    expect(methods.find((row) => row.method === "tunai")).toMatchObject({ revenue: 20_000, transactions: 1 });
    expect(methods.reduce((sum, row) => sum + row.revenue, 0)).toBe(s.revenue);
  });

  it("keeps the hour of day to the till, which has a clock", async () => {
    const hours = await salesByHour(ex(), range());
    expect(hours.reduce((sum, row) => sum + row.total, 0)).toBe(20_000);
  });
});

describe("margin with Panel entries", () => {
  it("takes their cost from the entry, so margin moves with what was really paid", async () => {
    const rows = await marginByItem(ex(), range());
    const alpha = rows.find((row) => row.itemId === alphaId)!;
    expect(alpha.marginRevenue).toBe(100_000);
    expect(alpha.cost).toBe(12_000 + 55_000);
    expect(alpha.margin).toBe(100_000 - 67_000);

    const summary = await marginSummary(ex(), range());
    expect(summary).toMatchObject({ revenue: 107_500, cost: 72_000, margin: 35_500 });
    expect(summary.uncostedRevenue).toBe(0);
  });

  it("is unmoved by a later delivery at a different price", async () => {
    // The entry's cost is its own snapshot. A dearer batch arriving afterwards
    // must not change what an order already booked cost.
    const before = await marginSummary(ex(), range());
    const [{ id: supplierId }] = await db.select({ id: suppliers.id }).from(suppliers).limit(1);
    await receiveStock(ex(), {
      itemId: alphaId,
      lotNumber: "L-B",
      expiryDate: addDays(today(), 400),
      supplierId,
      receivedDate: today(),
      qty: 10,
      unitCost: 99_000,
      performedBy: cashierId,
    });
    expect(await marginSummary(ex(), range())).toEqual(before);
  });
});
