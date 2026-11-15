/**
 * Selling while the server can be reached.
 *
 * The till is the same screen online and offline; what changes is where the
 * sale goes. Online it goes straight to the server, which books it against
 * the stock as it is now and gives it its real number before the receipt
 * shows -- there is no temporary number to explain to the customer. Only when
 * the server cannot be reached does the sale stay on the phone as an offline
 * sale, under the pass, with its `OFF-…` number.
 *
 * Pure: the network and the files are `services.ts`'s.
 */
import type { PaymentMethod, TillSaleRequest, TillSaleResponse } from "@/lib/offline/contract";
import type { HistoryEntry, PassUsage, Receipt, SnapshotFile, StateFile } from "../storage-format";
import { usageFor } from "./pass";
import { cartTotals, itemIndex, itemName, type CartLine } from "./till";

export type OnlineSaleInput = {
  cart: readonly CartLine[];
  discount: number;
  paymentMethod: PaymentMethod;
  tendered: number | null;
  notes: string | null;
  clientId: string;
};

/** What the till asks the server to book: the copy's prices and the total the cashier is showing. */
export function tillSaleRequest(snapshot: SnapshotFile, input: OnlineSaleInput): TillSaleRequest {
  const byId = itemIndex(snapshot);
  const totals = cartTotals(snapshot, input.cart, input.discount);
  const cash = input.paymentMethod === "tunai";
  return {
    clientId: input.clientId,
    lines: input.cart.map((l) => ({ itemId: l.itemId, qty: l.qty, unitPrice: byId.get(l.itemId)?.price ?? 0 })),
    discount: totals.discount,
    paymentMethod: input.paymentMethod,
    tendered: cash ? input.tendered : null,
    notes: input.notes && input.notes.trim() !== "" ? input.notes.trim() : null,
    total: totals.total,
  };
}

/**
 * The customer's receipt, from what the server booked -- its number, its time,
 * and the lots its FEFO actually took, which need not be the ones the copy
 * showed. Names and units come from the copy; the server's answer carries ids.
 */
export function onlineReceipt(
  snapshot: SnapshotFile,
  response: TillSaleResponse,
  cashierName: string,
  paymentMethod: PaymentMethod,
): Receipt {
  const byId = itemIndex(snapshot);
  const lines: Receipt["lines"] = [];
  for (const booked of response.lines) {
    let line = lines.find((l) => l.itemId === booked.itemId && l.unitPrice === booked.unitPrice);
    if (!line) {
      const item = byId.get(booked.itemId);
      line = {
        itemId: booked.itemId,
        name: item ? itemName(item) : "?",
        qty: 0,
        unit: item?.unit ?? "",
        unitPrice: booked.unitPrice,
        amount: 0,
        drugClass: item?.drugClass ?? "",
        lots: [],
      };
      lines.push(line);
    }
    line.qty += booked.qty;
    line.amount += booked.qty * booked.unitPrice;
    line.lots.push({
      batchId: booked.batchId,
      lotNumber: booked.lotNumber,
      expiryDate: booked.expiryDate,
      qty: booked.qty,
    });
  }
  return {
    offlineNumber: null,
    saleNumber: response.saleNumber,
    soldAt: Date.parse(response.soldAt),
    cashierName,
    lines,
    subtotal: response.subtotal,
    discount: response.discount,
    taxAmount: response.taxAmount,
    taxMode: response.taxMode,
    taxRateBps: response.taxRateBps,
    total: response.total,
    paymentMethod,
    tendered: response.tendered,
    change: response.change,
  };
}

export function onlineHistoryEntry(clientId: string, receipt: Receipt, now: number): HistoryEntry {
  return {
    clientId,
    offlineNumber: null,
    saleNumber: receipt.saleNumber ?? null,
    // A "duplicate" answer is the first attempt's booking; to the cashier it is simply booked.
    status: "posted",
    flags: [],
    syncedAt: now,
    receipt,
  };
}

/**
 * Takes the units an online sale booked off the copy, so the till does not go
 * on offering them -- and, should the server drop out a minute later, does not
 * sell them again offline. They are not offline sales: the pass's count and
 * value limits are left alone. The next snapshot already includes the sale and
 * starts the count afresh.
 */
export function recordOnlineUsage(
  state: StateFile,
  snapshot: SnapshotFile,
  lines: TillSaleResponse["lines"],
): StateFile {
  const usage: PassUsage = usageFor(snapshot, state.usage);
  const soldByBatch = { ...usage.soldByBatch };
  for (const l of lines) soldByBatch[l.batchId] = (soldByBatch[l.batchId] ?? 0) + l.qty;
  return { ...state, usage: { ...usage, soldByBatch } };
}
