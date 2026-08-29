import { describe, expect, it } from "vitest";
import { allocateFefo, fefoOrder, isOverride, type AvailableBatch } from "./fefo";
import { addDays, today } from "@/lib/format/date";

const batch = (
  id: string,
  daysToExpiry: number,
  qty: number,
  extra: Partial<AvailableBatch> = {},
): AvailableBatch => ({
  id,
  lotNumber: id.toUpperCase(),
  expiryDate: addDays(today(), daysToExpiry),
  qtyRemaining: qty,
  unitCost: 1_000,
  status: "active",
  ...extra,
});

describe("fefoOrder", () => {
  it("puts the earliest expiry first regardless of input order", () => {
    const ordered = fefoOrder([batch("c", 300, 10), batch("a", 10, 10), batch("b", 90, 10)]);
    expect(ordered.map((b) => b.id)).toEqual(["a", "b", "c"]);
  });

  it("is stable when two batches share an expiry date", () => {
    // The allocation shown on screen must match the one committed a moment
    // later, so equal dates cannot order arbitrarily.
    const input = [batch("z", 30, 5), batch("a", 30, 5)];
    expect(fefoOrder(input).map((b) => b.id)).toEqual(["a", "z"]);
    expect(fefoOrder([...input].reverse()).map((b) => b.id)).toEqual(["a", "z"]);
  });
});

describe("allocateFefo", () => {
  it("takes from the earliest-expiring batch", () => {
    const result = allocateFefo([batch("late", 300, 100), batch("soon", 20, 100)], 30);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].batchId).toBe("soon");
    expect(result.allocations[0].qty).toBe(30);
    expect(result.shortfall).toBe(0);
  });

  it("splits across batches when one is not enough", () => {
    const result = allocateFefo([batch("soon", 20, 20), batch("late", 300, 100)], 50);
    expect(result.allocations).toEqual([
      expect.objectContaining({ batchId: "soon", qty: 20 }),
      expect.objectContaining({ batchId: "late", qty: 30 }),
    ]);
    expect(result.shortfall).toBe(0);
  });

  it("reports a shortfall rather than over-allocating", () => {
    const result = allocateFefo([batch("only", 100, 10)], 25);
    expect(result.allocations[0].qty).toBe(10);
    expect(result.shortfall).toBe(15);
  });

  it("never allocates expired stock", () => {
    const result = allocateFefo([batch("gone", -1, 500), batch("good", 100, 40)], 20);
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].batchId).toBe("good");
  });

  it("distinguishes 'none left' from 'all of it expired'", () => {
    // These are different situations and the person at the counter needs to
    // know which one they are in.
    const expiredOnly = allocateFefo([batch("gone", -3, 200)], 10);
    expect(expiredOnly.shortfall).toBe(10);
    expect(expiredOnly.blockedByExpiry).toBe(200);

    const nothingAtAll = allocateFefo([], 10);
    expect(nothingAtAll.shortfall).toBe(10);
    expect(nothingAtAll.blockedByExpiry).toBe(0);
  });

  it("sells stock expiring today, which is good all day", () => {
    const result = allocateFefo([batch("today", 0, 10)], 5);
    expect(result.allocations[0].batchId).toBe("today");
  });

  it("skips batches that are not active or already empty", () => {
    const result = allocateFefo(
      [
        batch("quarantined", 100, 50, { status: "quarantined" }),
        batch("empty", 50, 0),
        batch("fine", 200, 30),
      ],
      10,
    );
    expect(result.allocations).toHaveLength(1);
    expect(result.allocations[0].batchId).toBe("fine");
  });

  it("honours an override but falls back to FEFO for the remainder", () => {
    // A patient travelling for three months should not be handed the box
    // expiring next week -- but a sale bigger than that box still follows the
    // correct order for what is left.
    const batches = [batch("soon", 10, 40), batch("late", 300, 100)];
    const result = allocateFefo(batches, 120, { preferBatchId: "late" });
    expect(result.allocations).toEqual([
      expect.objectContaining({ batchId: "late", qty: 100 }),
      expect.objectContaining({ batchId: "soon", qty: 20 }),
    ]);
  });

  it("returns nothing for a non-positive request", () => {
    expect(allocateFefo([batch("a", 100, 10)], 0).allocations).toHaveLength(0);
    expect(allocateFefo([batch("a", 100, 10)], -5).allocations).toHaveLength(0);
  });

  it("carries the cost of each batch, which differs between them", () => {
    const result = allocateFefo(
      [batch("cheap", 10, 5, { unitCost: 800 }), batch("dear", 100, 10, { unitCost: 1_500 })],
      8,
    );
    expect(result.allocations.map((a) => a.unitCost)).toEqual([800, 1_500]);
  });
});

describe("isOverride", () => {
  it("is true only when the earliest-expiring batch was skipped", () => {
    const batches = [batch("soon", 10, 40), batch("late", 300, 100)];
    expect(isOverride(batches, allocateFefo(batches, 10).allocations)).toBe(false);
    expect(
      isOverride(batches, allocateFefo(batches, 10, { preferBatchId: "late" }).allocations),
    ).toBe(true);
  });
});
