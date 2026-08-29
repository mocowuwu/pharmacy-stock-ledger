import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, ne } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import { alerts, batches, items, settings, suppliers, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { runAlertJob } from "@/lib/alerts/job";
import { disposeStock } from "@/lib/stock/disposal";
import { receiveStock, type Executor } from "@/lib/stock/ledger";
import { addDays, today } from "@/lib/format/date";

let db: TestDb;
let close: () => Promise<void>;
let userId: string;
let supplierId: string;

const ex = () => db as unknown as Executor;

async function makeItem(code: string, reorderPoint = 100) {
  const [row] = await db
    .insert(items)
    .values({
      code,
      genericName: `Item ${code}`,
      form: "tablet",
      unit: "tablet",
      drugClass: "bebas",
      reorderPoint,
      defaultPrice: 1_000,
    })
    .returning({ id: items.id });
  return row.id;
}

async function stock(itemId: string, lot: string, qty: number, days: number) {
  const { batchId } = await receiveStock(ex(), {
    itemId, lotNumber: lot, expiryDate: addDays(today(), days),
    supplierId, receivedDate: today(), qty, unitCost: 1_000,
    performedBy: userId,
  });
  return batchId;
}

const liveTypes = async () => {
  const rows = await db
    .select({ type: alerts.type, status: alerts.status })
    .from(alerts)
    .where(ne(alerts.status, "resolved"));
  return rows.map((r) => r.type).sort();
};

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  [{ id: userId }] = await db.insert(users).values({
    username: "job", fullName: "Job", passwordHash: await hashPassword("a-long-password"),
  }).returning({ id: users.id });
  [{ id: supplierId }] = await db.insert(suppliers)
    .values({ name: "PT Sumber" }).returning({ id: suppliers.id });
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
});

afterAll(async () => { await close(); });

describe("the alert job", () => {
  it("quarantines stock that has passed its expiry date", async () => {
    const itemId = await makeItem("Q1");
    const batchId = await stock(itemId, "Q1-1", 100, 30);
    await db.update(batches).set({ expiryDate: addDays(today(), -1) })
      .where(eq(batches.id, batchId));

    const result = await runAlertJob(db as unknown as Executor);
    expect(result.quarantined).toBeGreaterThanOrEqual(1);

    const [after] = await db
      .select({ status: batches.status }).from(batches).where(eq(batches.id, batchId));
    // The ledger already refuses to sell it; this makes the shelf state agree.
    expect(after.status).toBe("expired");
  });

  it("opens an alert once and refreshes it thereafter", async () => {
    const itemId = await makeItem("R1");
    await stock(itemId, "R1-1", 50, 20); // expiring urgently

    const first = await runAlertJob(db as unknown as Executor);
    expect(first.opened).toBeGreaterThan(0);

    const [before] = await db
      .select({ firstSeenAt: alerts.firstSeenAt })
      .from(alerts)
      .where(eq(alerts.itemId, itemId));

    const second = await runAlertJob(db as unknown as Executor);
    expect(second.opened).toBe(0);
    expect(second.refreshed).toBeGreaterThan(0);

    const [after] = await db
      .select({ firstSeenAt: alerts.firstSeenAt })
      .from(alerts)
      .where(eq(alerts.itemId, itemId));

    // firstSeenAt keeps its meaning: "how long has this been true" is the
    // question the dashboard exists to answer.
    expect(after.firstSeenAt.getTime()).toBe(before.firstSeenAt.getTime());
  });

  it("resolves an alert by itself once the problem is gone", async () => {
    const itemId = await makeItem("S1", 100);
    await runAlertJob(db as unknown as Executor);

    const live = await db
      .select({ type: alerts.type })
      .from(alerts)
      .where(eq(alerts.itemId, itemId));
    expect(live.map((a) => a.type)).toContain("out_of_stock");

    // Receiving stock should close it without anyone ticking anything off.
    await stock(itemId, "S1-1", 500, 400);
    await runAlertJob(db as unknown as Executor);

    const [row] = await db
      .select({ status: alerts.status, resolvedAt: alerts.resolvedAt })
      .from(alerts)
      .where(eq(alerts.itemId, itemId));
    expect(row.status).toBe("resolved");
    expect(row.resolvedAt).not.toBeNull();
  });

  it("does not accumulate duplicates across many runs", async () => {
    const itemId = await makeItem("D1");
    await stock(itemId, "D1-1", 40, 25);

    for (let i = 0; i < 5; i++) await runAlertJob(db as unknown as Executor);

    const rows = await db
      .select({ id: alerts.id })
      .from(alerts)
      .where(eq(alerts.itemId, itemId));
    // One live alert per subject, however often the job runs.
    expect(rows.length).toBeLessThanOrEqual(2); // urgent expiry (+ possibly low stock)
  });

  it("brings a lapsed snooze back into the open list", async () => {
    const itemId = await makeItem("Z1");
    await stock(itemId, "Z1-1", 40, 25);
    await runAlertJob(db as unknown as Executor);

    await db
      .update(alerts)
      .set({ status: "snoozed", snoozedUntil: addDaysDate(-1) })
      .where(eq(alerts.itemId, itemId));

    await runAlertJob(db as unknown as Executor);

    const [row] = await db
      .select({ status: alerts.status, snoozedUntil: alerts.snoozedUntil })
      .from(alerts)
      .where(eq(alerts.itemId, itemId));
    // Snoozing is a delay, not a dismissal.
    expect(row.status).toBe("open");
    expect(row.snoozedUntil).toBeNull();
  });

  it("leaves a snooze that has not lapsed alone", async () => {
    const itemId = await makeItem("Z2");
    await stock(itemId, "Z2-1", 40, 25);
    await runAlertJob(db as unknown as Executor);

    await db
      .update(alerts)
      .set({ status: "snoozed", snoozedUntil: addDaysDate(7) })
      .where(eq(alerts.itemId, itemId));

    await runAlertJob(db as unknown as Executor);

    const [row] = await db
      .select({ status: alerts.status })
      .from(alerts)
      .where(eq(alerts.itemId, itemId));
    expect(row.status).toBe("snoozed");
  });

  it("records the whole picture, not just one rule", async () => {
    await runAlertJob(db as unknown as Executor);
    const types = await liveTypes();
    expect(types.length).toBeGreaterThan(0);
    for (const type of types) {
      expect([
        "expired_stock", "out_of_stock", "expiring_urgent",
        "low_stock", "expiring_notice", "dead_stock",
      ]).toContain(type);
    }
  });

  it("keeps an expired-stock alert on screen until the batch is disposed", async () => {
    const itemId = await makeItem("DISP", 0);
    const batchId = await stock(itemId, "DISP-1", 40, 30);
    await db
      .update(batches)
      .set({ expiryDate: addDays(today(), -1) })
      .where(eq(batches.id, batchId));

    await runAlertJob(db as unknown as Executor);
    const opened = await db
      .select()
      .from(alerts)
      .where(eq(alerts.batchId, batchId));
    expect(opened.some((a) => a.type === "expired_stock" && a.status !== "resolved")).toBe(
      true,
    );

    // Acknowledging does not make it go away -- only clearing the shelf does.
    await runAlertJob(db as unknown as Executor);
    expect(
      (await db.select().from(alerts).where(eq(alerts.batchId, batchId))).some(
        (a) => a.type === "expired_stock" && a.status !== "resolved",
      ),
    ).toBe(true);

    await disposeStock(db as unknown as Executor, {
      batchId,
      qty: 40,
      reason: "Kedaluwarsa",
      actorId: userId,
    });
    await runAlertJob(db as unknown as Executor);

    const after = await db.select().from(alerts).where(eq(alerts.batchId, batchId));
    expect(
      after.every((a) => a.type !== "expired_stock" || a.status === "resolved"),
    ).toBe(true);
  });
});

function addDaysDate(days: number): Date {
  return new Date(Date.now() + days * 86_400_000);
}
