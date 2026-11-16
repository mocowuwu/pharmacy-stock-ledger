import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, violatedConstraint, type TestDb } from "./helpers/db";
import { alerts, items, settings, suppliers, users } from "@/db/schema";
import type { Database } from "@/db/client";
import { runAlertJob } from "@/lib/alerts/job";
import { AlertConfigError, readAlertConfig, saveAlertConfig } from "@/lib/alerts/config";
import { DEFAULT_ALERT_RULES, DEFAULT_THRESHOLDS } from "@/lib/alerts/rules";
import { receiveStock, type Executor } from "@/lib/stock/ledger";
import { commitSale } from "@/lib/stock/sale";
import { ALL_PERMISSIONS, PERMISSION_TEMPLATES, SENSITIVE_PERMISSIONS } from "@/lib/auth/permissions";
import { addDays, today } from "@/lib/format/date";

let db: TestDb;
let close: () => Promise<void>;
let userId: string;
let supplierId: string;

const ex = () => db as unknown as Database;

async function makeItem(code: string, reorderPoint: number) {
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
  return row!.id;
}

async function stock(itemId: string, lot: string, qty: number, days = 400) {
  await receiveStock(ex() as unknown as Executor, {
    itemId, lotNumber: lot, expiryDate: addDays(today(), days),
    supplierId, receivedDate: today(), qty, unitCost: 1_000,
    performedBy: userId,
  });
}

const liveFor = async (itemId: string) => {
  const rows = await db
    .select({ type: alerts.type, severity: alerts.severity, context: alerts.context, status: alerts.status })
    .from(alerts)
    .where(eq(alerts.itemId, itemId));
  return rows.filter((row) => row.status !== "resolved");
};

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  [{ id: userId }] = await db
    .insert(users)
    .values({ username: "rules", fullName: "Rules", passwordHash: "x", isOwner: true })
    .returning({ id: users.id });
  [{ id: supplierId }] = await db
    .insert(suppliers)
    .values({ name: "PT Sumber" })
    .returning({ id: suppliers.id });
  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
});

afterAll(async () => { await close(); });

describe("the permission", () => {
  it("exists, is marked sensitive, and is in nobody's starting template", () => {
    expect(ALL_PERMISSIONS).toContain("alerts.configure");
    expect(SENSITIVE_PERMISSIONS).toContain("alerts.configure");
    // The owner hands it out deliberately; a new manager does not get to
    // decide what the pharmacy is warned about by default.
    for (const template of Object.values(PERMISSION_TEMPLATES)) {
      expect(template as readonly string[]).not.toContain("alerts.configure");
    }
  });
});

describe("storing the rules", () => {
  it("an untouched pharmacy is on the defaults", async () => {
    expect(await readAlertConfig(ex())).toEqual({
      thresholds: DEFAULT_THRESHOLDS,
      rules: DEFAULT_ALERT_RULES,
    });
  });

  it("refuses a contradictory set whole, and writes nothing", async () => {
    const err = await saveAlertConfig(ex(), userId, {
      thresholds: { ...DEFAULT_THRESHOLDS, expiringUrgentDays: 200, lowStockDefaultPoint: 25 },
      rules: DEFAULT_ALERT_RULES,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(AlertConfigError);
    expect(err.code).toBe("urgent_window_too_wide");
    // Not even the part that was fine on its own.
    expect((await readAlertConfig(ex())).thresholds.lowStockDefaultPoint).toBe(0);
  });

  it("keeps what was saved, and reports what was there before", async () => {
    const rules = {
      ...DEFAULT_ALERT_RULES,
      dead_stock: { enabled: false, severity: "notice" as const },
      low_stock: { enabled: true, severity: "notice" as const },
    };
    const thresholds = { ...DEFAULT_THRESHOLDS, expiringUrgentDays: 45, expiringNoticeDays: 120 };
    const { before, after } = await saveAlertConfig(ex(), userId, { thresholds, rules });

    expect(before.thresholds.expiringUrgentDays).toBe(30);
    expect(after).toEqual({ thresholds, rules });
    expect(await readAlertConfig(ex())).toEqual({ thresholds, rules });

    const [row] = await db.select().from(settings).where(eq(settings.id, 1));
    expect(row?.updatedBy).toBe(userId);

    await saveAlertConfig(ex(), userId, { thresholds: DEFAULT_THRESHOLDS, rules: DEFAULT_ALERT_RULES });
  });

  it("a row edited by hand still cannot silence a critical rule", async () => {
    await db
      .update(settings)
      .set({ alertRules: { expired_stock: { enabled: false, severity: "notice" } } })
      .where(eq(settings.id, 1));
    expect((await readAlertConfig(ex())).rules).toEqual(DEFAULT_ALERT_RULES);
    await db.update(settings).set({ alertRules: null }).where(eq(settings.id, 1));
  });

  it("the database itself refuses a negative minimum", async () => {
    const name = await violatedConstraint(
      db.update(settings).set({ lowStockDefaultPoint: -1 }).where(eq(settings.id, 1)),
    );
    expect(name).toBe("settings_low_stock_sane");
  });
});

describe("the job follows the rules", () => {
  it("switching a rule off resolves what it had raised, and on brings it back", async () => {
    const itemId = await makeItem("LOW1", 100);
    await stock(itemId, "LOW1-1", 40);

    await runAlertJob(ex());
    expect((await liveFor(itemId)).map((a) => a.type)).toEqual(["low_stock"]);

    await saveAlertConfig(ex(), userId, {
      thresholds: DEFAULT_THRESHOLDS,
      rules: { ...DEFAULT_ALERT_RULES, low_stock: { enabled: false, severity: "warning" } },
    });
    await runAlertJob(ex());
    expect(await liveFor(itemId)).toEqual([]);

    await saveAlertConfig(ex(), userId, {
      thresholds: DEFAULT_THRESHOLDS,
      rules: { ...DEFAULT_ALERT_RULES, low_stock: { enabled: true, severity: "notice" } },
    });
    await runAlertJob(ex());
    expect(await liveFor(itemId)).toMatchObject([{ type: "low_stock", severity: "notice" }]);

    await saveAlertConfig(ex(), userId, { thresholds: DEFAULT_THRESHOLDS, rules: DEFAULT_ALERT_RULES });
  });

  it("re-grades an alert that is already open", async () => {
    const itemId = await makeItem("GRADE1", 100);
    await stock(itemId, "GRADE1-1", 10);
    await runAlertJob(ex());
    expect(await liveFor(itemId)).toMatchObject([{ severity: "warning" }]);

    await saveAlertConfig(ex(), userId, {
      thresholds: DEFAULT_THRESHOLDS,
      rules: { ...DEFAULT_ALERT_RULES, low_stock: { enabled: true, severity: "notice" } },
    });
    await runAlertJob(ex());
    // The same row, refreshed -- not a second alert beside the first.
    expect(await liveFor(itemId)).toMatchObject([{ type: "low_stock", severity: "notice" }]);

    await saveAlertConfig(ex(), userId, { thresholds: DEFAULT_THRESHOLDS, rules: DEFAULT_ALERT_RULES });
  });

  it("uses the default minimum for an item that has none", async () => {
    const itemId = await makeItem("DEF1", 0);
    await stock(itemId, "DEF1-1", 8);

    await runAlertJob(ex());
    expect(await liveFor(itemId)).toEqual([]);

    await saveAlertConfig(ex(), userId, {
      thresholds: { ...DEFAULT_THRESHOLDS, lowStockDefaultPoint: 10 },
      rules: DEFAULT_ALERT_RULES,
    });
    await runAlertJob(ex());
    const live = await liveFor(itemId);
    expect(live.map((a) => a.type)).toEqual(["low_stock"]);
    expect(live[0]!.context).toMatchObject({ onHand: 8, reorderPoint: 10 });

    await saveAlertConfig(ex(), userId, { thresholds: DEFAULT_THRESHOLDS, rules: DEFAULT_ALERT_RULES });
  });

  it("reads the selling rate off the ledger for days of cover", async () => {
    const itemId = await makeItem("FAST1", 5);
    await stock(itemId, "FAST1-1", 100);
    // 60 sold today: two a day over the 30-day window, 40 left = 20 days.
    await db.transaction(async (tx) =>
      commitSale(tx as unknown as Database, {
        actorId: userId,
        lines: [{ itemId, qty: 60, unitPrice: 1_000 }],
        paymentMethod: "tunai",
      }),
    );

    await runAlertJob(ex());
    expect(await liveFor(itemId)).toEqual([]);

    await saveAlertConfig(ex(), userId, {
      thresholds: { ...DEFAULT_THRESHOLDS, lowStockCoverDays: 21 },
      rules: DEFAULT_ALERT_RULES,
    });
    await runAlertJob(ex());
    const live = await liveFor(itemId);
    expect(live.map((a) => a.type)).toEqual(["low_stock"]);
    expect(live[0]!.context).toMatchObject({ onHand: 40, daysOfCover: 20 });

    // Twenty days of stock is not less than twenty.
    await saveAlertConfig(ex(), userId, {
      thresholds: { ...DEFAULT_THRESHOLDS, lowStockCoverDays: 20 },
      rules: DEFAULT_ALERT_RULES,
    });
    await runAlertJob(ex());
    expect(await liveFor(itemId)).toEqual([]);

    await saveAlertConfig(ex(), userId, { thresholds: DEFAULT_THRESHOLDS, rules: DEFAULT_ALERT_RULES });
  });
});
