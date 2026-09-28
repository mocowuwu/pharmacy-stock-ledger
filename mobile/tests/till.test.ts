import { describe, expect, it } from "vitest";
import { saleTotals } from "@/lib/stock/totals";
import { buildSale, cartTotals, findByCode, itemIndex, offlineNumber, quickCash, usedByBatch, type SaleInput } from "../src/lib/till";
import { cashier, HOUR, ISSUED, snapshot, state } from "./fixtures";

function input(over: Partial<SaleInput> = {}): SaleInput {
  const snap = snapshot();
  return {
    snapshot: snap,
    state: state(),
    queue: { sales: [] },
    cart: [{ itemId: "item-para", qty: 2 }],
    discount: 0,
    paymentMethod: "qris",
    tendered: null,
    notes: null,
    cashier: cashier(),
    now: ISSUED + HOUR,
    elapsed: snap.receivedElapsed + HOUR,
    wall: ISSUED + HOUR,
    clientId: "client-1",
    ...over,
  };
}

describe("the offline till", () => {
  it("numbers offline receipts OFF-<device>-<seq>, never reusing a number", () => {
    expect(offlineNumber("K7Q", 12)).toBe("OFF-K7Q-0012");
    const first = buildSale(input());
    if (!first.ok) throw new Error("expected a sale");
    expect(first.entry.sale.offlineNumber).toBe("OFF-K7Q-0001");
    const second = buildSale(input({ state: first.state, queue: { sales: [first.entry] }, clientId: "c2" }));
    if (!second.ok) throw new Error("expected a sale");
    expect(second.entry.sale.offlineNumber).toBe("OFF-K7Q-0002");
  });

  it("takes stock first-expired-first-out and reports the elapsed time since the pass", () => {
    const sale = buildSale(input({ cart: [{ itemId: "item-para", qty: 7 }] }));
    if (!sale.ok) throw new Error("expected a sale");
    expect(sale.entry.allocations).toEqual([
      { itemId: "item-para", batchId: "b-soon", qty: 5 },
      { itemId: "item-para", batchId: "b-late", qty: 2 },
    ]);
    expect(sale.entry.sale.elapsedMs).toBe(HOUR);
    expect(sale.entry.sale.passId).toBe("pass-1");
  });

  it("refuses expired stock, judged on the pass's day and not the phone's", () => {
    // Offline-now is still 28 Sep: the batch expiring today is sellable, the one
    // that expired yesterday is not -- 3 units, not 13.
    const refused = buildSale(input({ cart: [{ itemId: "item-amox", qty: 4 }] }));
    expect(refused).toEqual({
      ok: false,
      refusal: { code: "short", itemId: "item-amox", available: 3, expired: 10 },
    });
    // A day later by the pass's clock, even the phone thinking it is still the
    // 28th does not help.
    const nextDay = ISSUED + 20 * HOUR;
    const late = buildSale(input({ cart: [{ itemId: "item-amox", qty: 1 }], now: nextDay, wall: ISSUED }));
    expect(late.ok).toBe(false);
  });

  it("never sells more than the snapshot showed minus what this phone already sold", () => {
    const usage = { passId: "pass-1", sales: 1, total: 20_000, soldByBatch: { "b-soon": 5, "b-late": 15 } };
    const result = buildSale(input({ state: state({ usage }), cart: [{ itemId: "item-para", qty: 6 }] }));
    expect(result).toEqual({ ok: false, refusal: { code: "short", itemId: "item-para", available: 5, expired: 0 } });
  });

  it("counts queued sales from an older pass against the new snapshot", () => {
    const old = buildSale(input({ cart: [{ itemId: "item-para", qty: 4 }] }));
    if (!old.ok) throw new Error("expected a sale");
    const fresh = snapshot({ pass: { ...snapshot().data.pass, id: "pass-2" } });
    expect(usedByBatch(fresh, null, { sales: [old.entry] })).toEqual({ "b-soon": 4 });
  });

  it("charges exactly what the server's own arithmetic says", () => {
    const snap = snapshot({ tax: { mode: "exclusive", rateBps: 1_100 } });
    const cart = [
      { itemId: "item-para", qty: 3 },
      { itemId: "item-amox", qty: 1 },
    ];
    expect(cartTotals(snap, cart, 500)).toEqual(
      saleTotals(
        [
          { qty: 3, unitPrice: 1_000, taxExempt: false },
          { qty: 1, unitPrice: 2_500, taxExempt: true },
        ],
        500,
        { mode: "exclusive", rateBps: 1_100 },
      ),
    );
  });

  it("refuses a discount from someone without the permission, and short cash", () => {
    expect(buildSale(input({ discount: 100 }))).toEqual({ ok: false, refusal: { code: "discount_not_allowed" } });
    expect(buildSale(input({ paymentMethod: "tunai", tendered: 1_000 }))).toEqual({
      ok: false,
      refusal: { code: "tendered_short", total: 2_000 },
    });
  });

  it("stops at the pass limits", () => {
    const usage = { passId: "pass-1", sales: 3, total: 0, soldByBatch: {} };
    expect(buildSale(input({ state: state({ usage }) }))).toEqual({ ok: false, refusal: { code: "sales_limit" } });
  });

  it("finds an item by its barcode, including from a GS1 scan", () => {
    const items = snapshot().data.items;
    expect(findByCode(items, "8991234567890")?.id).toBe("item-para");
    expect(findByCode(items, "0108991234567890")?.id).toBe("item-para");
    expect(findByCode(items, "PARA500")?.id).toBe("item-para");
  });
});

describe("the payment sheet's quick amounts", () => {
  it("offers the exact sum, then the next round note in each size", () => {
    expect(quickCash(19_000)).toEqual([19_000, 20_000, 50_000, 100_000]);
    expect(quickCash(2_500)).toEqual([2_500, 5_000, 10_000, 20_000, 50_000]);
    expect(quickCash(41_000)).toEqual([41_000, 45_000, 50_000, 100_000]);
  });

  it("offers nothing nobody pays with, and does not repeat a round amount", () => {
    expect(quickCash(50_000)).toEqual([50_000, 100_000]);
    expect(quickCash(100_000)).toEqual([100_000]);
  });
});

describe("the item index", () => {
  it("is built once per snapshot and finds every item", () => {
    const snap = snapshot();
    const index = itemIndex(snap);
    expect(itemIndex(snap)).toBe(index);
    expect(index.get("item-amox")?.code).toBe("AMOX");
    expect(itemIndex(snapshot())).not.toBe(index);
  });
});
