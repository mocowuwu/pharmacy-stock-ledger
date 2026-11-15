import { describe, expect, it } from "vitest";
import type { TillSaleResponse } from "@/lib/offline/contract";
import { onlineHistoryEntry, onlineReceipt, recordOnlineUsage, tillSaleRequest } from "../src/lib/online";
import { checkPass } from "../src/lib/pass";
import { usedByBatch } from "../src/lib/till";
import { snapshot, state } from "./fixtures";

const booked: TillSaleResponse = {
  status: "posted",
  saleNumber: "260928-0042",
  soldAt: "2026-09-28T02:15:00.000Z",
  subtotal: 7_000,
  discount: 0,
  taxAmount: 0,
  taxMode: null,
  taxRateBps: null,
  total: 7_000,
  tendered: 10_000,
  change: 3_000,
  lines: [
    { itemId: "item-para", batchId: "b-soon", lotNumber: "SOON", expiryDate: "2026-12-31", qty: 5, unitPrice: 1_000 },
    { itemId: "item-para", batchId: "b-late", lotNumber: "LATE", expiryDate: "2027-12-31", qty: 2, unitPrice: 1_000 },
  ],
};

describe("the online till", () => {
  it("asks for the copy's prices and the total the cashier is showing", () => {
    const req = tillSaleRequest(snapshot(), {
      cart: [{ itemId: "item-para", qty: 2 }, { itemId: "item-amox", qty: 1 }],
      discount: 0,
      paymentMethod: "qris",
      tendered: 50_000,
      notes: "  ",
      clientId: "client-9",
    });
    expect(req.lines).toEqual([
      { itemId: "item-para", qty: 2, unitPrice: 1_000 },
      { itemId: "item-amox", qty: 1, unitPrice: 2_500 },
    ]);
    // Not cash: nothing tendered. A blank note is no note.
    expect(req.tendered).toBe(null);
    expect(req.notes).toBe(null);
    expect(req.clientId).toBe("client-9");
  });

  it("prints the server's number and the lots it actually took, with no offline number", () => {
    const receipt = onlineReceipt(snapshot(), booked, "Siti Kasir", "tunai");
    expect(receipt.offlineNumber).toBe(null);
    expect(receipt.saleNumber).toBe("260928-0042");
    expect(receipt.soldAt).toBe(Date.parse(booked.soldAt));
    expect(receipt.lines).toHaveLength(1);
    expect(receipt.lines[0]).toMatchObject({ itemId: "item-para", qty: 7, amount: 7_000 });
    expect(receipt.lines[0].lots.map((l) => [l.lotNumber, l.qty])).toEqual([
      ["SOON", 5],
      ["LATE", 2],
    ]);
    expect(receipt.change).toBe(3_000);

    const entry = onlineHistoryEntry("client-9", receipt, 1);
    expect(entry).toMatchObject({ offlineNumber: null, saleNumber: "260928-0042", status: "posted" });
  });

  it("takes what it sold off the copy without spending the offline pass", () => {
    const snap = snapshot();
    const after = recordOnlineUsage(state(), snap, booked.lines);
    expect(usedByBatch(snap, after.usage, { sales: [] })).toEqual({ "b-soon": 5, "b-late": 2 });
    expect(after.usage).toMatchObject({ sales: 0, total: 0 });

    // A pass that allows one offline sale still allows it after online ones.
    const tight = snapshot({ pass: { ...snap.data.pass, maxSales: 1 } });
    const used = recordOnlineUsage(recordOnlineUsage(state(), tight, booked.lines), tight, booked.lines);
    const clock = { elapsed: tight.receivedElapsed + 1_000, bootCount: tight.bootCount, wall: tight.receivedWall + 1_000 };
    expect(checkPass(tight, used.usage, clock, 0).ok).toBe(true);
  });
});
