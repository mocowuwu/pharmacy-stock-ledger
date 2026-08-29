import { describe, expect, it } from "vitest";
import {
  canSnooze,
  computeAlerts,
  countBySeverity,
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
