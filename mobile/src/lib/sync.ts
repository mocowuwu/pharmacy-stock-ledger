/**
 * Moving offline sales to the server.
 *
 * The queue is sent oldest first, in small batches, and each sale leaves the
 * queue only once the server has answered for it -- posted, sent for review,
 * or recognised as a duplicate. The server dedupes on `clientId`, so a
 * connection that drops after the server booked a batch but before the answer
 * arrived costs nothing: the next attempt resends it and is told "duplicate".
 */
import type { SyncResult } from "@/lib/offline/contract";
import { HISTORY_LIMIT, type HistoryFile, type QueueFile } from "../storage-format";

export const SYNC_BATCH = 20;

/**
 * Removes answered sales from the queue and files them in the history,
 * newest first. Results for sales no longer in the queue are ignored; sales
 * with no result stay queued, in order.
 */
export function applySyncResults(
  queue: QueueFile,
  history: HistoryFile,
  results: readonly SyncResult[],
  now: number,
): { queue: QueueFile; history: HistoryFile; answered: number } {
  const byId = new Map(results.map((r) => [r.clientId, r]));
  const remaining: QueueFile["sales"] = [];
  const done: HistoryFile["sales"] = [];
  for (const entry of queue.sales) {
    const result = byId.get(entry.sale.clientId);
    if (!result) {
      remaining.push(entry);
      continue;
    }
    done.push({
      clientId: entry.sale.clientId,
      offlineNumber: entry.sale.offlineNumber,
      saleNumber: result.saleNumber ?? null,
      status: result.status,
      flags: [...result.flags],
      syncedAt: now,
      receipt: entry.receipt,
    });
  }
  // `done` is oldest first; the history reads newest first.
  const sales = [...done.reverse(), ...history.sales].slice(0, HISTORY_LIMIT);
  return { queue: { sales: remaining }, history: { sales }, answered: done.length };
}
