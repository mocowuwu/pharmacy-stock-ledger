/**
 * The offline pass: how long, and how much, the till may sell without the
 * server.
 *
 * The server issues a pass with every snapshot. Offline selling is a backup
 * for an outage, not a way to run the shop off the books, so the pass is
 * deliberately hard to stretch:
 *
 *   - Its age is measured on the phone's monotonic clock
 *     (`elapsedRealtime`), which the date setting cannot move. Winding the
 *     phone's calendar back does not make a stale pass young again.
 *   - The monotonic clock restarts at boot, so a reboot ends the pass
 *     (detected through `bootCount`). Otherwise a restart would reset its age
 *     to zero.
 *   - The wall clock is still watched: if it ever reads well below the highest
 *     time already seen, someone turned it back, and the till locks rather than
 *     guess which clock to believe.
 *   - A count and a rupiah ceiling cap what one pass can sell.
 *
 * "Now", offline, is the pass's issue time plus the monotonic time since it
 * arrived -- server time carried forward by a clock nobody can set. Expiry
 * checks and receipt times use it; the phone's own clock is never trusted.
 */
import type { PassUsage, SnapshotFile } from "../storage-format";

/** How far the wall clock may fall below its high-water mark before it counts as turned back. */
export const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60_000;

export type Clock = {
  /** elapsedRealtime(), ms. */
  elapsed: number;
  bootCount: number;
  /** Date.now(), ms. Only compared against the high-water mark. */
  wall: number;
};

export type PassProblem =
  | "no_snapshot"
  | "rebooted"
  | "expired"
  | "clock_turned_back"
  | "sales_limit"
  | "total_limit";

export type PassCheck =
  | { ok: true; now: number; remainingMs: number }
  | { ok: false; problem: PassProblem };

export function passDurationMs(snapshot: SnapshotFile): number {
  const { issuedAt, expiresAt } = snapshot.data.pass;
  return Date.parse(expiresAt) - Date.parse(issuedAt);
}

/** Server time carried forward on the monotonic clock. Meaningful only while the pass is valid. */
export function offlineNow(snapshot: SnapshotFile, elapsed: number): number {
  return Date.parse(snapshot.data.pass.issuedAt) + (elapsed - snapshot.receivedElapsed);
}

/** Usage under this snapshot's pass; zero when the recorded usage belongs to another pass. */
export function usageFor(snapshot: SnapshotFile, usage: PassUsage | null): PassUsage {
  const passId = snapshot.data.pass.id;
  if (usage && usage.passId === passId) return usage;
  return { passId, sales: 0, total: 0, soldByBatch: {} };
}

export function checkPass(
  snapshot: SnapshotFile | null,
  usage: PassUsage | null,
  clock: Clock,
  wallHighWater: number,
): PassCheck {
  if (!snapshot) return { ok: false, problem: "no_snapshot" };

  if (snapshot.bootCount !== clock.bootCount) return { ok: false, problem: "rebooted" };

  const age = clock.elapsed - snapshot.receivedElapsed;
  const duration = passDurationMs(snapshot);
  // A negative age within one boot is impossible on a working phone; treat it
  // like any other clock that cannot be believed.
  if (age < 0) return { ok: false, problem: "clock_turned_back" };
  if (!(age < duration)) return { ok: false, problem: "expired" };

  if (clock.wall < wallHighWater - CLOCK_ROLLBACK_TOLERANCE_MS) {
    return { ok: false, problem: "clock_turned_back" };
  }

  const used = usageFor(snapshot, usage);
  const { maxSales, maxTotal } = snapshot.data.pass;
  if (used.sales >= maxSales) return { ok: false, problem: "sales_limit" };
  if (used.total > maxTotal) return { ok: false, problem: "total_limit" };

  return { ok: true, now: offlineNow(snapshot, clock.elapsed), remainingMs: duration - age };
}

/**
 * Whether one more sale of `total` fits under the pass. Checked at the moment
 * of completing a sale, on top of `checkPass`, so the last sale cannot carry
 * the pass over its ceiling.
 */
export function saleFitsPass(
  snapshot: SnapshotFile,
  usage: PassUsage | null,
  total: number,
): "ok" | "sales_limit" | "total_limit" {
  const used = usageFor(snapshot, usage);
  const { maxSales, maxTotal } = snapshot.data.pass;
  if (used.sales + 1 > maxSales) return "sales_limit";
  if (used.total + total > maxTotal) return "total_limit";
  return "ok";
}

/** The high-water mark only rises. */
export function raiseHighWater(highWater: number, wall: number): number {
  return Math.max(highWater, wall);
}
