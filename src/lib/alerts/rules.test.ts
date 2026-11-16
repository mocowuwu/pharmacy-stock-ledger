import { describe, expect, it } from "vitest";
import {
  canSnooze,
  computeAlerts,
  countBySeverity,
  daysOfCover,
  DEFAULT_ALERT_RULES,
  DEFAULT_THRESHOLDS,
  refusalToSaveAlertRules,
  resolveAlertRules,
  type AlertRules,
  type BatchSnapshot,
  type ItemSnapshot,
} from "./rules";
import { addDays } from "@/lib/format/date";

const TODAY = "2026-08-29";

const item = (over: Partial<ItemSnapshot> = {}): ItemSnapshot => ({
  id: "item-1",
  reorderPoint: 100,
  reorderQty: 500,
  status: "active",
  lastSoldOn: addDays(TODAY, -3),
  ...over,
});

const batch = (over: Partial<BatchSnapshot> = {}): BatchSnapshot => ({
  id: "batch-1",
  itemId: "item-1",
  expiryDate: addDays(TODAY, 365),
  qtyRemaining: 500,
  unitCost: 1_000,
  status: "active",
  ...over,
});

const run = (items: ItemSnapshot[], batches: BatchSnapshot[]) =>
  computeAlerts({ today: TODAY, items, batches });

const types = (items: ItemSnapshot[], batches: BatchSnapshot[]) =>
  run(items, batches).map((a) => a.type).sort();

describe("healthy stock", () => {
  it("raises nothing when there is plenty, well in date", () => {
    expect(run([item()], [batch()])).toEqual([]);
  });

  it("ignores archived items entirely", () => {
    // Alerting about something nobody intends to sell is just noise.
    expect(run([item({ status: "archived" })], [batch({ qtyRemaining: 0 })])).toEqual([]);
  });
});

describe("out of stock", () => {
  it("fires when nothing sellable is left", () => {
    const alerts = run([item()], [batch({ qtyRemaining: 0, status: "depleted" })]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: "out_of_stock", severity: "critical" });
  });

  it("fires when an item has no batches at all", () => {
    expect(types([item()], [])).toEqual(["out_of_stock"]);
  });

  it("says how much unsellable stock is sitting on the shelf", () => {
    // "None left" and "200 that expired last week" need different actions.
    const alerts = run(
      [item()],
      [batch({ expiryDate: addDays(TODAY, -7), qtyRemaining: 200 })],
    );
    const outOfStock = alerts.find((a) => a.type === "out_of_stock");
    expect(outOfStock?.context.expiredUnits).toBe(200);
  });

  it("does not also raise low stock, which would be the same news twice", () => {
    expect(types([item()], [batch({ qtyRemaining: 0, status: "depleted" })]))
      .toEqual(["out_of_stock"]);
  });
});

describe("low stock", () => {
  it("fires at the reorder point, not below it", () => {
    expect(types([item({ reorderPoint: 100 })], [batch({ qtyRemaining: 100 })]))
      .toEqual(["low_stock"]);
    expect(types([item({ reorderPoint: 100 })], [batch({ qtyRemaining: 101 })]))
      .toEqual([]);
  });

  it("counts every sellable batch together", () => {
    const alerts = run(
      [item({ reorderPoint: 100 })],
      [
        batch({ id: "a", qtyRemaining: 40 }),
        batch({ id: "b", qtyRemaining: 55 }),
      ],
    );
    expect(alerts[0].context.onHand).toBe(95);
  });

  it("does not count expired units towards the total", () => {
    const alerts = run(
      [item({ reorderPoint: 100 })],
      [
        batch({ id: "good", qtyRemaining: 50 }),
        batch({ id: "gone", qtyRemaining: 500, expiryDate: addDays(TODAY, -1) }),
      ],
    );
    const low = alerts.find((a) => a.type === "low_stock");
    expect(low?.context.onHand).toBe(50);
  });
});

describe("expiry", () => {
  it("treats stock as good through the whole of its expiry date", () => {
    expect(types([item()], [batch({ expiryDate: TODAY })])).toEqual(["expiring_urgent"]);
    expect(types([item()], [batch({ expiryDate: addDays(TODAY, -1) })]))
      .toEqual(["expired_stock", "out_of_stock"]);
  });

  it("uses 30 and 90 days as the two warning bands", () => {
    expect(types([item()], [batch({ expiryDate: addDays(TODAY, 30) })]))
      .toEqual(["expiring_urgent"]);
    expect(types([item()], [batch({ expiryDate: addDays(TODAY, 31) })]))
      .toEqual(["expiring_notice"]);
    expect(types([item()], [batch({ expiryDate: addDays(TODAY, 90) })]))
      .toEqual(["expiring_notice"]);
    expect(types([item()], [batch({ expiryDate: addDays(TODAY, 91) })])).toEqual([]);
  });

  it("does not warn about a batch that has already expired", () => {
    // Expired is the loudest thing that can be said; repeating it as a warning
    // only adds noise.
    const alerts = run([item()], [batch({ expiryDate: addDays(TODAY, -5) })]);
    expect(alerts.map((a) => a.type)).not.toContain("expiring_urgent");
    expect(alerts.find((a) => a.type === "expired_stock")?.context.daysExpired).toBe(5);
  });

  it("reports the money tied up in expired stock", () => {
    const alerts = run(
      [item()],
      [batch({ expiryDate: addDays(TODAY, -1), qtyRemaining: 120, unitCost: 2_500 })],
    );
    expect(alerts.find((a) => a.type === "expired_stock")?.context.valueAtCost)
      .toBe(300_000);
  });

  it("still reports expired stock that has been quarantined", () => {
    const alerts = run(
      [item()],
      [batch({ expiryDate: addDays(TODAY, -2), status: "expired" })],
    );
    expect(alerts.map((a) => a.type)).toContain("expired_stock");
  });

  it("says nothing about stock already disposed of", () => {
    expect(
      types([item()], [batch({ expiryDate: addDays(TODAY, -30), status: "disposed" })]),
    ).toEqual(["out_of_stock"]);
  });
});

describe("dead stock", () => {
  it("fires for stock that is not moving and is running out of shelf life", () => {
    expect(
      types(
        [item({ lastSoldOn: addDays(TODAY, -120) })],
        [batch({ expiryDate: addDays(TODAY, 150) })],
      ),
    ).toEqual(["dead_stock"]);
  });

  it("does not fire for stock that is still selling", () => {
    expect(
      types(
        [item({ lastSoldOn: addDays(TODAY, -10) })],
        [batch({ expiryDate: addDays(TODAY, 150) })],
      ),
    ).toEqual([]);
  });

  it("fires for stock that has never sold at all", () => {
    expect(
      types([item({ lastSoldOn: null })], [batch({ expiryDate: addDays(TODAY, 150) })]),
    ).toEqual(["dead_stock"]);
  });

  it("stays quiet when an expiry alert already covers the same batch", () => {
    // Three rows about one box trains people to skim the list, and the expiry
    // warning already says "move this".
    expect(
      types(
        [item({ lastSoldOn: addDays(TODAY, -200) })],
        [batch({ expiryDate: addDays(TODAY, 20) })],
      ),
    ).toEqual(["expiring_urgent"]);

    expect(
      types(
        [item({ lastSoldOn: addDays(TODAY, -200) })],
        [batch({ expiryDate: addDays(TODAY, 75) })],
      ),
    ).toEqual(["expiring_notice"]);
  });

  it("occupies the band between the expiry warnings and a healthy shelf life", () => {
    // Past 90 days nothing else is flagging it, but there is still time to
    // discount it, move it, or return it under supplier terms.
    expect(
      types(
        [item({ lastSoldOn: addDays(TODAY, -200) })],
        [batch({ expiryDate: addDays(TODAY, 120) })],
      ),
    ).toEqual(["dead_stock"]);
  });

  it("does not fire for stock with plenty of life left", () => {
    expect(
      types(
        [item({ lastSoldOn: addDays(TODAY, -300) })],
        [batch({ expiryDate: addDays(TODAY, 400) })],
      ),
    ).toEqual([]);
  });
});

describe("thresholds", () => {
  it("respects configured day bands", () => {
    const alerts = computeAlerts({
      today: TODAY,
      items: [item()],
      batches: [batch({ expiryDate: addDays(TODAY, 45) })],
      thresholds: { expiringUrgentDays: 60 },
    });
    expect(alerts[0].type).toBe("expiring_urgent");
  });
});

describe("severity", () => {
  it("counts by severity for the dashboard tiles", () => {
    const alerts = run(
      [item({ id: "a", reorderPoint: 100 }), item({ id: "b" })],
      [
        batch({ id: "1", itemId: "a", qtyRemaining: 50 }),
        batch({ id: "2", itemId: "b", expiryDate: addDays(TODAY, -1) }),
      ],
    );
    const counts = countBySeverity(alerts);
    expect(counts.critical).toBeGreaterThan(0);
    expect(counts.warning).toBeGreaterThan(0);
  });

  it("refuses to let a critical alert be snoozed", () => {
    // Expired stock stays on screen until it is off the shelf.
    expect(canSnooze("expired_stock")).toBe(false);
    expect(canSnooze("out_of_stock")).toBe(false);
    expect(canSnooze("low_stock")).toBe(true);
    expect(canSnooze("expiring_notice")).toBe(true);
  });
});

describe("the pharmacy's own rules", () => {
  const withRules = (
    rules: Partial<AlertRules>,
    items: ItemSnapshot[],
    batches: BatchSnapshot[],
    thresholds = {},
  ) => computeAlerts({ today: TODAY, items, batches, rules, thresholds });

  const off = { enabled: false, severity: "warning" } as const;

  it("a switched-off rule raises nothing", () => {
    const alerts = withRules({ low_stock: off }, [item()], [batch({ qtyRemaining: 50 })]);
    expect(alerts).toEqual([]);
  });

  it("hands a batch to the next rule out rather than dropping it", () => {
    // Ten days from expiry with "expiring urgently" off is still inside the
    // notice window, and still worth a line.
    const alerts = withRules(
      { expiring_urgent: off },
      [item()],
      [batch({ expiryDate: addDays(TODAY, 10) })],
    );
    expect(alerts.map((a) => a.type)).toEqual(["expiring_notice"]);
  });

  it("lets dead stock speak for a batch no expiry rule flagged", () => {
    const idle = item({ lastSoldOn: addDays(TODAY, -200) });
    const soon = batch({ expiryDate: addDays(TODAY, 60) });
    expect(withRules({}, [idle], [soon]).map((a) => a.type)).toEqual(["expiring_notice"]);
    expect(withRules({ expiring_notice: off }, [idle], [soon]).map((a) => a.type)).toEqual([
      "dead_stock",
    ]);
  });

  it("grades an alert the way the rule is graded", () => {
    const alerts = withRules(
      { low_stock: { enabled: true, severity: "notice" } },
      [item()],
      [batch({ qtyRemaining: 50 })],
    );
    expect(alerts[0]).toMatchObject({ type: "low_stock", severity: "notice" });
  });

  it("cannot switch off, soften or reach the two critical rules", () => {
    const stored = {
      expired_stock: { enabled: false, severity: "notice" },
      out_of_stock: { enabled: false, severity: "notice" },
      low_stock: { enabled: true, severity: "critical" },
    };
    const rules = resolveAlertRules(stored);
    // Unknown keys are dropped and a critical grade is not one a rule may carry.
    expect(Object.keys(rules).sort()).toEqual(Object.keys(DEFAULT_ALERT_RULES).sort());
    expect(rules.low_stock.severity).toBe("warning");

    const alerts = computeAlerts({
      today: TODAY,
      items: [item({ id: "empty" }), item({ id: "old" })],
      batches: [batch({ itemId: "old", expiryDate: addDays(TODAY, -1) })],
      rules: stored as unknown as AlertRules,
    });
    expect(alerts.filter((a) => a.type === "expired_stock")).toHaveLength(1);
    expect(alerts.filter((a) => a.type === "out_of_stock")).toHaveLength(2);
    expect(alerts.every((a) => a.severity === "critical")).toBe(true);
    expect(canSnooze("expired_stock")).toBe(false);
    expect(canSnooze("out_of_stock")).toBe(false);
  });

  it("reads garbage as the defaults", () => {
    expect(resolveAlertRules(null)).toEqual(DEFAULT_ALERT_RULES);
    expect(resolveAlertRules("off")).toEqual(DEFAULT_ALERT_RULES);
    expect(resolveAlertRules([{ enabled: false }])).toEqual(DEFAULT_ALERT_RULES);
    expect(resolveAlertRules({ low_stock: { enabled: "no" } })).toEqual(DEFAULT_ALERT_RULES);
  });
});

describe("what counts as low", () => {
  it("an item with no minimum of its own is never low by default", () => {
    expect(types([item({ reorderPoint: 0 })], [batch({ qtyRemaining: 3 })])).toEqual([]);
  });

  it("falls back to the default minimum, and only for items without one", () => {
    const thresholds = { lowStockDefaultPoint: 10 };
    const low = (reorderPoint: number, qty: number) =>
      computeAlerts({
        today: TODAY,
        items: [item({ reorderPoint })],
        batches: [batch({ qtyRemaining: qty })],
        thresholds,
      }).map((a) => a.type);

    expect(low(0, 10)).toEqual(["low_stock"]);
    expect(low(0, 11)).toEqual([]);
    // Its own minimum wins, even a lower one.
    expect(low(5, 8)).toEqual([]);
  });

  it("flags a fast seller before it reaches its minimum", () => {
    const fast = item({ reorderPoint: 20, soldRecently: 300 }); // 10 a day
    const alerts = computeAlerts({
      today: TODAY,
      items: [fast],
      batches: [batch({ qtyRemaining: 60 })], // six days' worth
      thresholds: { lowStockCoverDays: 7 },
    });
    expect(alerts[0]).toMatchObject({ type: "low_stock" });
    expect(alerts[0].context).toMatchObject({ onHand: 60, daysOfCover: 6 });
  });

  it("the cover boundary is exact: seven days of stock is not less than seven", () => {
    const run7 = (qty: number) =>
      computeAlerts({
        today: TODAY,
        items: [item({ reorderPoint: 0, soldRecently: 300 })],
        batches: [batch({ qtyRemaining: qty })],
        thresholds: { lowStockCoverDays: 7 },
      });
    expect(run7(70)).toEqual([]);
    expect(run7(69).map((a) => a.type)).toEqual(["low_stock"]);
  });

  it("an item that is not selling has no rate to run out at", () => {
    expect(daysOfCover(5, 0)).toBeNull();
    const alerts = computeAlerts({
      today: TODAY,
      items: [item({ reorderPoint: 0, soldRecently: 0 })],
      batches: [batch({ qtyRemaining: 1 })],
      thresholds: { lowStockCoverDays: 30 },
    });
    expect(alerts).toEqual([]);
  });

  it("says nothing about cover when the minimum is what raised it", () => {
    const alerts = computeAlerts({
      today: TODAY,
      items: [item({ reorderPoint: 100, soldRecently: 30 })],
      batches: [batch({ qtyRemaining: 90 })],
      thresholds: { lowStockCoverDays: 7 },
    });
    expect(alerts[0].context.daysOfCover).toBeNull();
  });
});

describe("saving the rules", () => {
  const good = { thresholds: DEFAULT_THRESHOLDS, rules: DEFAULT_ALERT_RULES };
  const withT = (over: object) => ({ ...good, thresholds: { ...DEFAULT_THRESHOLDS, ...over } });

  it("accepts the defaults", () => {
    expect(refusalToSaveAlertRules(good)).toBeNull();
  });

  it("refuses an urgent window as wide as the notice window", () => {
    // Otherwise the urgent alert fires after the gentle one, which reads as
    // the system being broken rather than as a setting being wrong.
    expect(refusalToSaveAlertRules(withT({ expiringUrgentDays: 120 }))).toBe("urgent_window_too_wide");
    expect(refusalToSaveAlertRules(withT({ expiringUrgentDays: 90 }))).toBe("urgent_window_too_wide");
  });

  it("refuses windows that are not whole days", () => {
    expect(refusalToSaveAlertRules(withT({ expiringUrgentDays: 0 }))).toBe("invalid_days");
    expect(refusalToSaveAlertRules(withT({ deadStockExpiryDays: 7.5 }))).toBe("invalid_days");
  });

  it("refuses a dead-stock horizon that could never fire", () => {
    expect(refusalToSaveAlertRules(withT({ deadStockExpiryDays: 90 }))).toBe(
      "dead_stock_window_too_narrow",
    );
    // With the rule off, or the notice rule off, the same number is fine.
    const off = { enabled: false, severity: "notice" } as const;
    expect(
      refusalToSaveAlertRules({
        thresholds: { ...DEFAULT_THRESHOLDS, deadStockExpiryDays: 90 },
        rules: { ...DEFAULT_ALERT_RULES, dead_stock: off },
      }),
    ).toBeNull();
    expect(
      refusalToSaveAlertRules({
        thresholds: { ...DEFAULT_THRESHOLDS, deadStockExpiryDays: 90 },
        rules: { ...DEFAULT_ALERT_RULES, expiring_notice: off },
      }),
    ).toBeNull();
  });

  it("refuses a negative minimum and an absurd cover", () => {
    expect(refusalToSaveAlertRules(withT({ lowStockDefaultPoint: -1 }))).toBe("invalid_low_stock_point");
    expect(refusalToSaveAlertRules(withT({ lowStockCoverDays: 366 }))).toBe("invalid_cover_days");
    expect(refusalToSaveAlertRules(withT({ lowStockCoverDays: 1.5 }))).toBe("invalid_cover_days");
  });

  it("refuses a critical grade, a missing rule and a rule that does not exist", () => {
    const rules = (over: object) => ({ ...good, rules: { ...DEFAULT_ALERT_RULES, ...over } });
    expect(refusalToSaveAlertRules(rules({ low_stock: { enabled: true, severity: "critical" } }))).toBe(
      "invalid_alert_rule",
    );
    expect(refusalToSaveAlertRules(rules({ expired_stock: { enabled: false, severity: "notice" } }))).toBe(
      "invalid_alert_rule",
    );
    const three = Object.fromEntries(
      Object.entries(DEFAULT_ALERT_RULES).filter(([type]) => type !== "dead_stock"),
    );
    expect(refusalToSaveAlertRules({ ...good, rules: three })).toBe("invalid_alert_rule");
    expect(refusalToSaveAlertRules({ ...good, rules: null })).toBe("invalid_alert_rule");
  });
});
