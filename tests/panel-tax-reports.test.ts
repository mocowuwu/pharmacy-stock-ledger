import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import { items, settings, suppliers, taxRates, users } from "@/db/schema";
import type { Database } from "@/db/client";
import { commitSale } from "@/lib/stock/sale";
import { receiveStock, type Executor } from "@/lib/stock/ledger";
import { addDays, today } from "@/lib/format/date";
import { buildDigest } from "@/lib/digest/content";
import { panelTakingsByDay } from "@/lib/panel/amounts";
import {
  decidePanelEntry,
  recordPanelEntry,
  voidPanelEntry,
  type PanelInput,
} from "@/lib/panel/entries";
import {
  dailyRevenue,
  groupByCategory,
  itemSales,
  marginSummary,
  salesByCashier,
  salesByPaymentMethod,
  salesSummary,
} from "@/lib/reports/queries";

/**
 * Panel orders with PPN and approval, in the main figures, worked by hand.
 *
 *   Till (11% on top):  2 x Alpha at 10.000 = 20.000, PPN 2.200 -> paid 22.200   cost 6.000 each
 *
 *   Panel, yesterday:
 *     E1  "aaa" Alpha     10 x 8.000 = 80.000, PPN 11% ON TOP  8.800  -> paid 88.800   cost 5.500 each
 *     E2  "xxx" Manual     5 x 4.000 = 20.000, PPN 11% INSIDE  1.982  -> paid 20.000   cost 2.000 each
 *     E3  "xxx" Manual     3 x 1.500 =  4.500, no PPN                 -> paid  4.500   cost 1.000 each
 *   Counting for nothing:
 *     E4  waiting for approval   99 x 9.999
 *     E5  rejected               99 x 9.999
 *     E6  voided                 99 x 9.999
 *
 * Gross 20.000 + 104.500 = 124.500; PPN inside 1.982; net 122.518;
 * PPN 2.200 + 8.800 + 1.982 = 12.982; paid 22.200 + 113.300 = 135.500.
 */
let db: TestDb;
let close: () => Promise<void>;
let clerk: string;
let boss: string;
let alphaId: string;

const ex = () => db as unknown as Executor;
const pdb = () => db as unknown as Database;
const range = () => ({ from: addDays(today(), -7), to: today() });
const yesterday = () => addDays(today(), -1);

const entry = (over: Partial<PanelInput>): PanelInput & { actorId: string } => ({
  entryDate: yesterday(),
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
  actorId: clerk,
  ...over,
});

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  await db.insert(settings).values({ id: 1, taxEnabled: true, taxMode: "exclusive" }).onConflictDoNothing();
  await db.update(settings).set({ taxEnabled: true, taxMode: "exclusive" }).where(eq(settings.id, 1));
  await db.insert(taxRates).values({ name: "PPN", rateBps: 1100, effectiveFrom: addDays(today(), -60) });

  [{ id: clerk }] = await db
    .insert(users)
    .values({ username: "kasir", fullName: "Siti Kasir", passwordHash: "x" })
    .returning({ id: users.id });
  [{ id: boss }] = await db
    .insert(users)
    .values({ username: "bos", fullName: "Bu Bos", passwordHash: "x", isOwner: true })
    .returning({ id: users.id });
  const [{ id: supplierId }] = await db
    .insert(suppliers)
    .values({ name: "PT Sumber" })
    .returning({ id: suppliers.id });
  [{ id: alphaId }] = await db
    .insert(items)
    .values({ code: "AAA", genericName: "Alpha", form: "tablet", unit: "tablet", drugClass: "bebas", defaultPrice: 10_000 })
    .returning({ id: items.id });
  await receiveStock(ex(), {
    itemId: alphaId,
    lotNumber: "L-A",
    expiryDate: addDays(today(), 400),
    supplierId,
    receivedDate: today(),
    qty: 100,
    unitCost: 6_000,
    performedBy: clerk,
  });

  const sale = await commitSale(ex(), {
    actorId: clerk,
    lines: [{ itemId: alphaId, qty: 2, unitPrice: 10_000 }],
    paymentMethod: "tunai",
  });
  expect(sale.taxAmount).toBe(2_200);
  expect(sale.total).toBe(22_200);

  // E1 is written while PPN sits on top; the pharmacy then moves to inclusive
  // pricing, and E2 is written that way. Each keeps what it was written with.
  await recordPanelEntry(pdb(), entry({
    itemCode: "aaa", itemName: "Alpha", qty: 10, unitPrice: 8_000, unitCost: 5_500, taxed: true, orderRef: "SP/E1",
  }));
  await db.update(settings).set({ taxMode: "inclusive" }).where(eq(settings.id, 1));
  await recordPanelEntry(pdb(), entry({
    qty: 5, unitPrice: 4_000, unitCost: 2_000, taxed: true, orderRef: "SP/E2",
  }));
  await recordPanelEntry(pdb(), entry({
    qty: 3, unitPrice: 1_500, unitCost: 1_000, taxed: false, orderRef: "SP/E3",
  }));

  // Waiting, rejected and voided: three ways an order counts for nothing.
  await db.update(settings).set({ panelApprovalRequired: true }).where(eq(settings.id, 1));
  await recordPanelEntry(pdb(), entry({ qty: 99, unitPrice: 9_999, unitCost: 1, orderRef: "SP/E4" }));
  const rejected = await recordPanelEntry(pdb(), entry({ qty: 99, unitPrice: 9_999, unitCost: 1, orderRef: "SP/E5" }));
  await decidePanelEntry(pdb(), { entryId: rejected.id, decision: "reject", note: "No", actorId: boss, actorIsOwner: true });
  await db.update(settings).set({ panelApprovalRequired: false }).where(eq(settings.id, 1));
  const voided = await recordPanelEntry(pdb(), entry({ qty: 99, unitPrice: 9_999, unitCost: 1, orderRef: "SP/E6" }));
  await voidPanelEntry(pdb(), { entryId: voided.id, reason: "Typed twice", actorId: clerk });
});

afterAll(async () => close());

describe("PPN and approval in the sales statement", () => {
  it("follows the till's own statement, and closes to the rupiah", async () => {
    const s = await salesSummary(ex(), range());

    expect(s.gross).toBe(20_000 + 80_000 + 20_000 + 4_500);
    expect(s.taxIncluded).toBe(1_982);
    expect(s.net).toBe(124_500 - 1_982);
    expect(s.tax).toBe(2_200 + 8_800 + 1_982);
    expect(s.taxNet).toBe(12_982);
    expect(s.revenue).toBe(22_200 + 88_800 + 20_000 + 4_500);
    expect(s.collected).toBe(135_500);
    // The statement closes: net sales plus the PPN kept is what was kept.
    expect(s.net + s.taxNet).toBe(s.collected);
  });

  it("reports the panel's own part: what changed hands, its PPN, and nothing that was not approved", async () => {
    const s = await salesSummary(ex(), range());
    expect(s.panel).toEqual({ entries: 3, revenue: 113_300, units: 18, tax: 10_782 });
    // Still not a till basket.
    expect(s.transactions).toBe(1);
    expect(s.averageSale).toBe(22_200);
  });

  it("ties every breakdown to the statement", async () => {
    const s = await salesSummary(ex(), range());
    const rows = await itemSales(ex(), range());

    expect(rows.reduce((sum, row) => sum + row.revenueNet, 0)).toBe(s.net);
    expect(groupByCategory(rows).reduce((sum, row) => sum + row.revenue, 0)).toBe(s.net);
    expect(rows.reduce((sum, row) => sum + row.taxIncluded, 0)).toBe(s.taxIncluded);

    const cashiers = await salesByCashier(ex(), range());
    expect(cashiers.reduce((sum, row) => sum + row.revenue, 0)).toBe(s.revenue);
    expect(cashiers.find((row) => row.fromPanel)).toMatchObject({ revenue: 113_300, transactions: 0 });

    const methods = await salesByPaymentMethod(ex(), range());
    expect(methods.reduce((sum, row) => sum + row.revenue, 0)).toBe(s.revenue);

    const series = await dailyRevenue(ex(), range());
    expect(series.reduce((sum, row) => sum + row.total, 0)).toBe(s.revenue);
  });

  it("takes PPN inside the price out of net sales, per product", async () => {
    const rows = await itemSales(ex(), range());
    const manual = rows.find((row) => row.itemId === null)!;
    // E2 and E3 share a name: 24.500 asked, 1.982 of it PPN inside.
    expect(manual).toMatchObject({ revenue: 24_500, taxIncluded: 1_982, revenueNet: 22_518, cost: 13_000 });
    const alpha = rows.find((row) => row.itemId === alphaId)!;
    // E1's PPN sat on top, so it is not in the price and not taken out of it.
    expect(alpha).toMatchObject({ revenue: 100_000, taxIncluded: 0, revenueNet: 100_000 });
  });

  it("takes margin on what the pharmacy keeps, PPN inside the price excluded", async () => {
    const m = await marginSummary(ex(), range());
    expect(m).toMatchObject({
      revenue: 122_518,
      cost: 12_000 + 55_000 + 10_000 + 3_000,
      margin: 122_518 - 80_000,
    });
  });
});

describe("what counts, in the dashboard and the digest", () => {
  it("gives the dashboard what the Panel took in that day, approved only, PPN on top included", async () => {
    const byDay = await panelTakingsByDay(pdb(), addDays(today(), -3), today());
    expect(byDay.get(yesterday())).toEqual({ paid: 113_300, entries: 3 });
    expect(byDay.size).toBe(1);
  });

  it("puts it in the morning digest as its own line, inside the day's takings", async () => {
    const data = await buildDigest(pdb(), {
      on: yesterday(),
      timezone: "Asia/Jakarta",
      business: "Apotek Contoh",
    });
    expect(data.takings.panel).toBe(113_300);
    expect(data.takings.gross).toBe(113_300);
    expect(data.takings.net).toBe(113_300);
    // A doctor's order is not a basket.
    expect(data.takings.sales).toBe(0);
    // And a day with only Panel takings is not "nothing to report".
    expect(data.quiet).toBe(false);
  });

  it("counts an order once it is approved, and not before", async () => {
    await db.update(settings).set({ panelApprovalRequired: true }).where(eq(settings.id, 1));
    const held = await recordPanelEntry(pdb(), entry({
      entryDate: addDays(today(), -2), qty: 4, unitPrice: 2_500, unitCost: 1_000, orderRef: "SP/later",
    }));
    const before = await panelTakingsByDay(pdb(), addDays(today(), -3), today());
    expect(before.get(addDays(today(), -2))).toBeUndefined();

    await decidePanelEntry(pdb(), { entryId: held.id, decision: "approve", note: "", actorId: boss, actorIsOwner: true });
    const after = await panelTakingsByDay(pdb(), addDays(today(), -3), today());
    expect(after.get(addDays(today(), -2))).toEqual({ paid: 10_000, entries: 1 });
    await db.update(settings).set({ panelApprovalRequired: false }).where(eq(settings.id, 1));
  });
});
