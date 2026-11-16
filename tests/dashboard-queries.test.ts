import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import { batches, items, sales, settings, suppliers, users } from "@/db/schema";
import type { Database } from "@/db/client";
import { runAlertJob } from "@/lib/alerts/job";
import { DEFAULT_ALERT_RULES, DEFAULT_THRESHOLDS } from "@/lib/alerts/rules";
import {
  expiryBand,
  expiryCalendar,
  stockHealth,
  tillTakingsOn,
  trailingRange,
} from "@/lib/dashboard/queries";
import { receiveStock, type Executor } from "@/lib/stock/ledger";
import { commitSale, reverseSale } from "@/lib/stock/sale";
import { addDays, DEFAULT_TIMEZONE, today } from "@/lib/format/date";

let db: TestDb;
let close: () => Promise<void>;
let userId: string;
let supplierId: string;

const ex = () => db as unknown as Database;
const ON = today();

async function makeItem(code: string, reorderPoint = 0) {
  const [row] = await db
    .insert(items)
    .values({
      code, genericName: `Item ${code}`, form: "tablet", unit: "tablet",
      drugClass: "bebas", reorderPoint, defaultPrice: 1_000,
    })
    .returning({ id: items.id });
  return row!.id;
}

async function stock(itemId: string, lot: string, qty: number, days: number) {
  const { batchId } = await receiveStock(ex() as unknown as Executor, {
    itemId, lotNumber: lot, expiryDate: addDays(ON, Math.max(days, 1)),
    supplierId, receivedDate: ON, qty, unitCost: 1_000, performedBy: userId,
  });
  // Receiving refuses stock that is already past its date, so a batch that
  // has since expired on the shelf is made by moving its date afterwards.
  if (days < 1) {
    await db.update(batches).set({ expiryDate: addDays(ON, days) }).where(eq(batches.id, batchId));
  }
  return batchId;
}

const calendar = (rules = DEFAULT_ALERT_RULES) =>
  expiryCalendar(ex(), { on: ON, thresholds: DEFAULT_THRESHOLDS, rules });

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  [{ id: userId }] = await db
    .insert(users)
    .values({ username: "dash", fullName: "Dash", passwordHash: "x", isOwner: true })
    .returning({ id: users.id });
  [{ id: supplierId }] = await db
    .insert(suppliers)
    .values({ name: "PT Sumber" })
    .returning({ id: suppliers.id });
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
});

afterAll(async () => { await close(); });

describe("expiry bands", () => {
  const windows = { urgent: 30, notice: 90 };

  it("cuts at the pharmacy's windows, boundaries included", () => {
    expect(expiryBand(-1, windows)).toBe("expired");
    // Expiring today is still sellable today.
    expect(expiryBand(0, windows)).toBe("urgent");
    expect(expiryBand(30, windows)).toBe("urgent");
    expect(expiryBand(31, windows)).toBe("notice");
    expect(expiryBand(90, windows)).toBe("notice");
    expect(expiryBand(91, windows)).toBe("later");
  });

  it("a switched-off window hands its days to the next band out", () => {
    expect(expiryBand(10, { urgent: 0, notice: 90 })).toBe("notice");
    expect(expiryBand(10, { urgent: 0, notice: 0 })).toBe("later");
  });
});

describe("the expiry calendar", () => {
  it("counts batches by month and band, and nothing that holds no stock", async () => {
    const a = await makeItem("CAL-A");
    const b = await makeItem("CAL-B");
    await stock(a, "A-expired", 10, -5);
    await stock(a, "A-urgent", 20, 10);
    await stock(b, "B-notice", 30, 60);
    await stock(b, "B-later", 40, 200);
    await stock(b, "B-far", 50, 900);

    // Sold out entirely: a depleted batch is not on any shelf.
    const emptied = await makeItem("CAL-C");
    await stock(emptied, "C-gone", 5, 15);
    await db.transaction(async (tx) =>
      commitSale(tx as unknown as Database, {
        actorId: userId,
        lines: [{ itemId: emptied, qty: 5, unitPrice: 1_000 }],
        paymentMethod: "tunai",
      }),
    );

    const result = await calendar();
    expect(result.windows).toEqual({ urgent: 30, notice: 90 });
    expect(result.months).toHaveLength(13);
    expect(result.months[0]).toMatchObject({ key: "expired", units: 10 });
    expect(result.months[0]!.batches.expired).toBe(1);
    expect(result.months[1]!.key).toBe(ON.slice(0, 7));

    const month = (days: number) => result.months.find((m) => m.key === addDays(ON, days).slice(0, 7))!;
    expect(month(10).batches.urgent).toBe(1);
    expect(month(60).batches.notice).toBe(1);
    expect(month(200).batches.later).toBe(1);
    // Every batch is in exactly one place.
    const shown = result.months.reduce(
      (sum, m) => sum + m.batches.expired + m.batches.urgent + m.batches.notice + m.batches.later,
      0,
    );
    expect(shown).toBe(4);
    expect(result.beyond).toEqual({ batches: 1, units: 50 });
  });

  it("recolours rather than hides when a rule is switched off", async () => {
    const result = await calendar({
      ...DEFAULT_ALERT_RULES,
      expiring_urgent: { enabled: false, severity: "warning" },
    });
    expect(result.windows).toEqual({ urgent: 0, notice: 90 });
    const month = result.months.find((m) => m.key === addDays(ON, 10).slice(0, 7))!;
    expect(month.batches.urgent).toBe(0);
    expect(month.batches.notice).toBeGreaterThanOrEqual(1);
  });

  it("leaves archived items out, as the alert rules do", async () => {
    const archived = await makeItem("CAL-ARCH");
    await stock(archived, "ARCH-1", 10, 12);
    const before = await calendar();
    await db.update(items).set({ status: "archived" }).where(eq(items.id, archived));
    const after = await calendar();

    const key = addDays(ON, 12).slice(0, 7);
    const urgent = (r: typeof before) => r.months.find((m) => m.key === key)!.batches.urgent;
    expect(urgent(after)).toBe(urgent(before) - 1);
  });
});

describe("stock health", () => {
  it("counts what the alert job found, so the two cannot disagree", async () => {
    const low = await makeItem("H-LOW", 50);
    await stock(low, "H-LOW-1", 20, 400);
    await makeItem("H-OUT", 10); // never stocked
    await runAlertJob(ex());

    const health = await stockHealth(ex());
    const [{ n }] = await db
      .select({ n: db.$count(items, eq(items.status, "active")) })
      .from(settings);
    expect(health.items).toBe(n);
    expect(health.low).toBeGreaterThanOrEqual(1);
    expect(health.out).toBeGreaterThanOrEqual(1);
    expect(health.healthy + health.low + health.out).toBe(health.items);
  });
});

describe("the till's takings for one day", () => {
  it("leaves voided sales out and stops at the clock it is given", async () => {
    const itemId = await makeItem("TILL-1");
    await stock(itemId, "TILL-1-1", 100, 400);

    const before = await tillTakingsOn(ex(), { day: ON, timezone: DEFAULT_TIMEZONE });

    const ring = (qty: number) =>
      db.transaction(async (tx) =>
        commitSale(tx as unknown as Database, {
          actorId: userId,
          lines: [{ itemId, qty, unitPrice: 1_000 }],
          paymentMethod: "tunai",
        }),
      );
    await ring(3);
    const { saleId } = await ring(4);
    await db.transaction(async (tx) =>
      reverseSale(tx as unknown as Database, { saleId, actorId: userId, reason: "salah input" }),
    );

    const after = await tillTakingsOn(ex(), { day: ON, timezone: DEFAULT_TIMEZONE });
    expect(after.gross - before.gross).toBe(3_000);
    expect(after.count - before.count).toBe(1);
    expect(after.net).toBe(after.gross - after.refunds);

    // An hour ago none of today's sales in this test had been rung up.
    const [first] = await db.select({ soldAt: sales.soldAt }).from(sales).orderBy(sales.soldAt).limit(1);
    const earlier = await tillTakingsOn(ex(), {
      day: ON,
      timezone: DEFAULT_TIMEZONE,
      until: new Date(first!.soldAt.getTime() - 1_000),
    });
    expect(earlier).toEqual({ gross: 0, refunds: 0, net: 0, count: 0 });
  });
});

describe("the trailing window", () => {
  it("is thirty days long, today included", () => {
    expect(trailingRange("2026-11-16", 30)).toEqual({ from: "2026-10-18", to: "2026-11-16" });
  });
});
