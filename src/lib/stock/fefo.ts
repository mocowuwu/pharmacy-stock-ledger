import { isExpired } from "@/lib/format/date";

/**
 * First expired, first out.
 *
 * When a cashier adds an item to a sale, stock is taken from the batch that
 * expires soonest. That is what pharmacies actually do, and it is the only
 * allocation rule that reduces waste rather than merely recording it.
 *
 * The cashier can override the batch -- there are real reasons to, such as a
 * patient travelling for three months who should not be handed the box expiring
 * next week -- but an override has to say why, and the reason lands in the
 * ledger.
 */

export type AvailableBatch = {
  id: string;
  lotNumber: string | null;
  expiryDate: string;
  qtyRemaining: number;
  unitCost: number;
  status: string;
};

export type Allocation = {
  batchId: string;
  lotNumber: string | null;
  expiryDate: string;
  qty: number;
  unitCost: number;
};

export type AllocationResult = {
  allocations: Allocation[];
  /** Units that could not be filled. Zero when the request was satisfiable. */
  shortfall: number;
  /** Units available but unusable, for a message that explains rather than just refuses. */
  blockedByExpiry: number;
};

/**
 * Orders batches the way stock should leave the shelf. Ties are broken by lot
 * number so the result is stable: an allocation shown on screen must match the
 * one committed a moment later.
 */
export function fefoOrder(batches: readonly AvailableBatch[]): AvailableBatch[] {
  return [...batches].sort((a, b) => {
    if (a.expiryDate !== b.expiryDate) return a.expiryDate < b.expiryDate ? -1 : 1;
    return (a.lotNumber ?? "").localeCompare(b.lotNumber ?? "");
  });
}

export function isSellable(batch: AvailableBatch, timezone?: string): boolean {
  return (
    batch.status === "active" &&
    batch.qtyRemaining > 0 &&
    !isExpired(batch.expiryDate, timezone)
  );
}

/**
 * Allocates a quantity across batches, earliest expiry first.
 *
 * Expired stock is never allocated, but the units it holds are reported
 * separately: "none left" and "there are 200 on the shelf but they expired last
 * week" are different situations, and the person at the counter needs to know
 * which one they are in.
 */
export function allocateFefo(
  batches: readonly AvailableBatch[],
  requested: number,
  options: { preferBatchId?: string; timezone?: string } = {},
): AllocationResult {
  if (requested <= 0) {
    return { allocations: [], shortfall: 0, blockedByExpiry: 0 };
  }

  const blockedByExpiry = batches
    .filter((b) => b.status === "active" && b.qtyRemaining > 0)
    .filter((b) => isExpired(b.expiryDate, options.timezone))
    .reduce((sum, b) => sum + b.qtyRemaining, 0);

  const sellable = fefoOrder(batches).filter((b) => isSellable(b, options.timezone));

  // An override moves one batch to the front; the rest still follow FEFO, so a
  // sale larger than that batch falls back to the correct order.
  const ordered = options.preferBatchId
    ? [
        ...sellable.filter((b) => b.id === options.preferBatchId),
        ...sellable.filter((b) => b.id !== options.preferBatchId),
      ]
    : sellable;

  const allocations: Allocation[] = [];
  let remaining = requested;

  for (const batch of ordered) {
    if (remaining === 0) break;
    const take = Math.min(remaining, batch.qtyRemaining);
    if (take <= 0) continue;
    allocations.push({
      batchId: batch.id,
      lotNumber: batch.lotNumber,
      expiryDate: batch.expiryDate,
      qty: take,
      unitCost: batch.unitCost,
    });
    remaining -= take;
  }

  return { allocations, shortfall: remaining, blockedByExpiry };
}

/** True when the allocation did not start with the earliest-expiring batch. */
export function isOverride(
  batches: readonly AvailableBatch[],
  allocations: readonly Allocation[],
  timezone?: string,
): boolean {
  if (allocations.length === 0) return false;
  const natural = fefoOrder(batches).filter((b) => isSellable(b, timezone));
  return natural.length > 0 && natural[0].id !== allocations[0].batchId;
}
