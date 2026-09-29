/**
 * The offline till's rules, as pure functions over the stored files.
 *
 * Everything that decides money or stock is imported from the server's own
 * modules -- `saleTotals`, `allocateFefo`, `parseScan` -- rather than rewritten
 * here. A customer handed an offline receipt must be charged exactly what the
 * server books when the sale is replayed, and two copies of the arithmetic
 * would drift the first time either was touched.
 */
import type {
  OfflineSale,
  PaymentMethod,
  SnapshotItem,
} from "@/lib/offline/contract";
import {
  allocateFefo,
  isSellable,
  type AllocationResult,
  type AvailableBatch,
} from "@/lib/stock/fefo";
import { saleTotals, type SaleTotals } from "@/lib/stock/totals";
import { dayOf } from "@/lib/format/date";
import { gtinVariants, parseScan } from "@/lib/stock/gs1";
import type {
  PassUsage,
  QueueEntry,
  QueueFile,
  Receipt,
  SnapshotFile,
  StateFile,
  StoredUser,
} from "../storage-format";
import { raiseHighWater, saleFitsPass, usageFor } from "./pass";
import { hasPermission } from "./signin";

/** Today in the pharmacy's timezone at offline-now -- never the phone's date. */
export function offlineToday(now: number, timezone: string): string {
  return dayOf(new Date(now), timezone);
}

/**
 * Same rule as the server's `isExpired`: stock is good through the whole of
 * its expiry date. Taken against offline-now's day rather than `today()`,
 * which reads the phone's clock.
 */
export function isExpiredOn(expiryDate: string, today: string): boolean {
  return expiryDate < today;
}

/**
 * Units this device has already taken from each batch that the snapshot does
 * not know about:
 *
 *   - everything sold under the current pass, synced or not -- the snapshot
 *     was taken before any of it;
 *   - sales still waiting in the queue from an older pass -- the server had
 *     not seen them when it built this snapshot.
 *
 * A sale that reached the server but whose answer was lost is counted twice
 * until it syncs. That errs toward selling less than the shelf holds, never
 * more.
 */
export function usedByBatch(
  snapshot: SnapshotFile,
  usage: PassUsage | null,
  queue: QueueFile,
): Record<string, number> {
  const passId = snapshot.data.pass.id;
  const used: Record<string, number> = { ...usageFor(snapshot, usage).soldByBatch };
  for (const entry of queue.sales) {
    if (entry.sale.passId === passId) continue;
    for (const a of entry.allocations) used[a.batchId] = (used[a.batchId] ?? 0) + a.qty;
  }
  return used;
}

/**
 * The item's batches as FEFO sees them. Expiry is judged on offline-now's day
 * -- the pass's clock -- and never on the phone's own date, which is whatever
 * someone set it to: a phone a day fast would refuse good stock, one a day
 * slow would sell expired stock. Every check below passes that day as `asOf`.
 */
export function batchesFor(
  item: SnapshotItem,
  used: Record<string, number>,
  today: string,
): AvailableBatch[] {
  return item.batches.map((b) => ({
    id: b.id,
    lotNumber: b.lotNumber,
    expiryDate: b.expiryDate,
    qtyRemaining: Math.max(0, b.qty - (used[b.id] ?? 0)),
    unitCost: 0,
    status: isExpiredOn(b.expiryDate, today) ? "expired" : "active",
  }));
}

export type ItemStock = {
  /** Units that can be sold now. */
  sellable: number;
  /** Units on the shelf that have expired: refused, and said so. */
  expired: number;
};

export function stockOf(
  item: SnapshotItem,
  used: Record<string, number>,
  today: string,
  timezone: string,
): ItemStock {
  const batches = batchesFor(item, used, today);
  const sellable = batches
    .filter((b) => isSellable(b, timezone, today))
    .reduce((sum, b) => sum + b.qtyRemaining, 0);
  const expired = batches
    .filter((b) => b.status === "expired")
    .reduce((sum, b) => sum + b.qtyRemaining, 0);
  return { sellable, expired };
}

export function allocateItem(
  item: SnapshotItem,
  qty: number,
  used: Record<string, number>,
  today: string,
  timezone: string,
): AllocationResult {
  return allocateFefo(batchesFor(item, used, today), qty, { timezone, asOf: today });
}

/* ------------------------------------------------------------------ search */

const indexes = new WeakMap<SnapshotFile, Map<string, SnapshotItem>>();

/** Items by id, built once per snapshot rather than on every keystroke. */
export function itemIndex(snapshot: SnapshotFile): Map<string, SnapshotItem> {
  let index = indexes.get(snapshot);
  if (!index) {
    index = new Map(snapshot.data.items.map((i) => [i.id, i]));
    indexes.set(snapshot, index);
  }
  return index;
}

function normal(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().normalize("NFKD");
}

/** Resolves a scanned or typed barcode, GS1 or plain, against item barcodes and codes. */
export function findByCode(items: readonly SnapshotItem[], raw: string): SnapshotItem | null {
  const scan = parseScan(raw);
  const code =
    scan.kind === "gs1" ? scan.gtin : scan.kind === "plain" ? scan.code : raw.trim();
  if (!code) return null;
  const wanted = new Set(gtinVariants(code));
  const trimmed = raw.trim().toLowerCase();
  for (const item of items) {
    if (item.code.toLowerCase() === trimmed) return item;
    for (const barcode of item.barcodes) {
      if (barcode === code) return item;
      if (gtinVariants(barcode).some((v) => wanted.has(v))) return item;
    }
  }
  return null;
}

export const MIN_QUERY = 2;

export function searchItems(
  items: readonly SnapshotItem[],
  query: string,
  limit = 30,
): SnapshotItem[] {
  const q = normal(query.trim());
  if (q.length < MIN_QUERY) return [];
  const exact = /^[\d\x1d\]]/u.test(query.trim()) ? findByCode(items, query) : null;
  const matches = items.filter(
    (i) =>
      normal(i.genericName).includes(q) ||
      normal(i.brandName).includes(q) ||
      normal(i.code).includes(q),
  );
  const out = exact ? [exact, ...matches.filter((m) => m.id !== exact.id)] : matches;
  return out.slice(0, limit);
}

export function itemName(item: SnapshotItem): string {
  const base = item.brandName ? `${item.brandName} (${item.genericName})` : item.genericName;
  return item.strength ? `${base} ${item.strength}` : base;
}

/* -------------------------------------------------------------- the sale */

export function offlineNumber(deviceCode: string, seq: number): string {
  return `OFF-${deviceCode}-${String(seq).padStart(4, "0")}`;
}

export type CartLine = { itemId: string; qty: number };

export function cartTotals(
  snapshot: SnapshotFile,
  cart: readonly CartLine[],
  discount: number,
): SaleTotals {
  const byId = itemIndex(snapshot);
  return saleTotals(
    cart.flatMap((l) => {
      const item = byId.get(l.itemId);
      return item ? [{ qty: l.qty, unitPrice: item.price, taxExempt: item.isTaxExempt }] : [];
    }),
    discount,
    snapshot.data.tax,
  );
}

export type SaleInput = {
  snapshot: SnapshotFile;
  state: StateFile;
  queue: QueueFile;
  cart: readonly CartLine[];
  discount: number;
  paymentMethod: PaymentMethod;
  /** Cash only; null otherwise. */
  tendered: number | null;
  notes: string | null;
  cashier: StoredUser;
  /** Offline-now, epoch ms. */
  now: number;
  /** elapsedRealtime() at the sale. */
  elapsed: number;
  /** Date.now() at the sale; informational only. */
  wall: number;
  clientId: string;
};

export type SaleRefusal =
  | { code: "empty" }
  | { code: "bad_qty"; itemId: string }
  | { code: "unknown_item"; itemId: string }
  | { code: "short"; itemId: string; available: number; expired: number }
  | { code: "discount_not_allowed" }
  | { code: "tendered_short"; total: number }
  | { code: "sales_limit" }
  | { code: "total_limit" };

export type SaleOutcome =
  | { ok: true; entry: QueueEntry; state: StateFile }
  | { ok: false; refusal: SaleRefusal };

/**
 * Builds the sale and the state that follows it, or says why not. Pure: the
 * caller writes `state` and then the queue before showing the receipt.
 */
export function buildSale(input: SaleInput): SaleOutcome {
  const { snapshot, state, queue, cart, cashier, now } = input;
  const data = snapshot.data;
  const tz = data.settings.timezone;
  const today = offlineToday(now, tz);
  const byId = itemIndex(snapshot);

  if (cart.length === 0) return { ok: false, refusal: { code: "empty" } };
  if (input.discount > 0 && !hasPermission(cashier, "sales.discount")) {
    return { ok: false, refusal: { code: "discount_not_allowed" } };
  }

  const used = usedByBatch(snapshot, state.usage, queue);
  const allocations: QueueEntry["allocations"] = [];
  const receiptLines: Receipt["lines"] = [];

  for (const line of cart) {
    const item = byId.get(line.itemId);
    if (!item) return { ok: false, refusal: { code: "unknown_item", itemId: line.itemId } };
    if (!Number.isSafeInteger(line.qty) || line.qty <= 0) {
      return { ok: false, refusal: { code: "bad_qty", itemId: line.itemId } };
    }
    const result = allocateItem(item, line.qty, used, today, tz);
    if (result.shortfall > 0) {
      const stock = stockOf(item, used, today, tz);
      return {
        ok: false,
        refusal: { code: "short", itemId: item.id, available: stock.sellable, expired: stock.expired },
      };
    }
    for (const a of result.allocations) {
      allocations.push({ itemId: item.id, batchId: a.batchId, qty: a.qty });
      used[a.batchId] = (used[a.batchId] ?? 0) + a.qty;
    }
    receiptLines.push({
      itemId: item.id,
      name: itemName(item),
      qty: line.qty,
      unit: item.unit,
      unitPrice: item.price,
      amount: line.qty * item.price,
      drugClass: item.drugClass,
      lots: result.allocations.map((a) => ({
        batchId: a.batchId,
        lotNumber: a.lotNumber,
        expiryDate: a.expiryDate,
        qty: a.qty,
      })),
    });
  }

  const totals = cartTotals(snapshot, cart, input.discount);

  const fits = saleFitsPass(snapshot, state.usage, totals.total);
  if (fits !== "ok") return { ok: false, refusal: { code: fits } };

  const cash = input.paymentMethod === "tunai";
  const tendered = cash ? input.tendered : null;
  if (cash && (tendered == null || tendered < totals.total)) {
    return { ok: false, refusal: { code: "tendered_short", total: totals.total } };
  }

  const seq = state.seq + 1;
  const deviceCode = data.device.code;
  const number = offlineNumber(deviceCode, seq);

  const sale: OfflineSale = {
    clientId: input.clientId,
    offlineNumber: number,
    passId: data.pass.id,
    elapsedMs: input.elapsed - snapshot.receivedElapsed,
    deviceTime: new Date(input.wall).toISOString(),
    cashierId: cashier.id,
    lines: cart.map((l) => ({ itemId: l.itemId, qty: l.qty, unitPrice: byId.get(l.itemId)!.price })),
    discount: totals.discount,
    paymentMethod: input.paymentMethod,
    tendered,
    notes: input.notes && input.notes.trim() !== "" ? input.notes.trim() : null,
    total: totals.total,
  };

  const receipt: Receipt = {
    offlineNumber: number,
    soldAt: now,
    cashierName: cashier.fullName,
    lines: receiptLines,
    subtotal: totals.subtotal,
    discount: totals.discount,
    taxAmount: totals.taxAmount,
    taxMode: data.tax?.mode ?? null,
    taxRateBps: data.tax?.rateBps ?? null,
    total: totals.total,
    paymentMethod: input.paymentMethod,
    tendered,
    change: tendered != null ? tendered - totals.total : null,
  };

  const usage = usageFor(snapshot, state.usage);
  const soldByBatch = { ...usage.soldByBatch };
  for (const a of allocations) soldByBatch[a.batchId] = (soldByBatch[a.batchId] ?? 0) + a.qty;

  const nextState: StateFile = {
    ...state,
    seq,
    wallHighWater: raiseHighWater(state.wallHighWater, input.wall),
    usage: {
      passId: usage.passId,
      sales: usage.sales + 1,
      total: usage.total + totals.total,
      soldByBatch,
    },
  };

  return { ok: true, entry: { sale, allocations, receipt }, state: nextState };
}

/**
 * Amounts a customer is likely to hand over for `total`: the exact sum, then
 * the total rounded up to what notes make naturally -- the next 5.000,
 * 10.000, 50.000 and 100.000, and a single 20.000 note for a small sale.
 * Rounding to multiples of 20.000 would offer 60.000 for a 50.000 sale, which
 * nobody hands over. Five at most, smallest first.
 */
export function quickCash(total: number): number[] {
  const out = new Set<number>([total]);
  for (const step of [5_000, 10_000, 50_000, 100_000]) {
    const next = Math.ceil(total / step) * step;
    if (next > total) out.add(next);
  }
  if (total < 20_000) out.add(20_000);
  return [...out].sort((a, b) => a - b).slice(0, 5);
}
