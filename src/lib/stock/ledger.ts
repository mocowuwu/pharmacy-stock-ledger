import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db";
import { batches, items, stockMovements } from "@/db/schema";
import { isExpired } from "@/lib/format/date";
import { RESTRICTED_DRUG_CLASSES } from "@/lib/catalogue/enums";

/**
 * The ledger.
 *
 * No `server-only` guard: the scheduled alert job and the data scripts run as
 * plain Node processes and legitimately need it. The data access layer above
 * carries the guard, and nothing in the UI imports this module directly.
 *
 * Every change to a batch quantity in this system goes through `applyMovement`.
 * Nothing else may write `batches.qty_remaining` -- that is the rule the whole
 * design rests on, because it is what makes the ledger able to explain the
 * stock figure rather than merely accompany it.
 *
 * The order inside is deliberate: lock the batch, write the movement, then move
 * the quantity. If anything fails, the transaction takes all three back
 * together, so there is never a movement without its effect or an effect
 * without its movement.
 */

/** Accepts either the database or an open transaction. */
export type Executor = Database;

export type MovementType =
  | "opening"
  | "receive"
  | "sale"
  | "sale_void"
  | "return"
  | "adjust"
  | "dispose";

export type MovementInput = {
  batchId: string;
  type: MovementType;
  /** Signed. Positive in, negative out, never zero. */
  qtyDelta: number;
  performedBy: string;
  reason?: string | null;
  refType?: string | null;
  refId?: string | null;
  pharmacistId?: string | null;
  /**
   * Forces the batch's status after the movement, for the cases where the new
   * status is a decision rather than a consequence of the quantity -- a fully
   * written-off batch becomes `disposed`, not `depleted`.
   *
   * It lives here rather than in a follow-up UPDATE at the call site so that
   * every rule about batch status stays in one file, next to the sticky-status
   * logic it has to cooperate with.
   *
   * Only the three terminal statuses can be forced. Nothing may push a batch
   * back to `active` this way -- that is exactly the hole the sticky-status
   * rule exists to close.
   */
  setStatus?: TerminalStatus | null;
};

/** The statuses that are a decision. None of them can be reversed by a movement. */
export type TerminalStatus = "quarantined" | "expired" | "disposed";

export class LedgerError extends Error {
  constructor(readonly code: LedgerErrorCode, message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

export type LedgerErrorCode =
  | "batch_not_found"
  | "zero_movement"
  | "insufficient_stock"
  | "batch_not_sellable"
  | "batch_expired"
  | "reason_required"
  | "pharmacist_required";

/** Movements that take stock out for a reason other than disposal. */
const OUTWARD_REQUIRING_SELLABLE = new Set<MovementType>(["sale"]);

/** Movements whose reason is not self-evident from the type. */
const REASON_REQUIRED = new Set<MovementType>(["adjust", "dispose"]);

export async function applyMovement(
  tx: Executor,
  input: MovementInput,
): Promise<{ batchId: string; qtyAfter: number; movementId: string }> {
  if (input.qtyDelta === 0) {
    throw new LedgerError("zero_movement", "A movement must change the quantity.");
  }
  if (REASON_REQUIRED.has(input.type) && !input.reason?.trim()) {
    throw new LedgerError(
      "reason_required",
      `A ${input.type} movement must record why.`,
    );
  }

  // Lock the batch for the rest of the transaction. Two cashiers reaching for
  // the last box must produce one sale and one clear error, not a negative
  // quantity -- this is what serialises them.
  const [batch] = await tx
    .select({
      id: batches.id,
      itemId: batches.itemId,
      qtyRemaining: batches.qtyRemaining,
      status: batches.status,
      expiryDate: batches.expiryDate,
      drugClass: items.drugClass,
    })
    .from(batches)
    .innerJoin(items, eq(items.id, batches.itemId))
    .where(eq(batches.id, input.batchId))
    .for("update", { of: batches })
    .limit(1);

  if (!batch) {
    throw new LedgerError("batch_not_found", "That batch does not exist.");
  }

  const outward = input.qtyDelta < 0;

  if (outward) {
    if (batch.qtyRemaining + input.qtyDelta < 0) {
      throw new LedgerError(
        "insufficient_stock",
        `Only ${batch.qtyRemaining} left in this batch.`,
      );
    }

    if (OUTWARD_REQUIRING_SELLABLE.has(input.type)) {
      if (batch.status !== "active") {
        throw new LedgerError("batch_not_sellable", "This batch is not sellable.");
      }
      // The single most valuable rule in the system, and it is checked here --
      // at the ledger -- so no screen or API path can route around it.
      if (isExpired(batch.expiryDate)) {
        throw new LedgerError("batch_expired", "This batch has expired.");
      }
    }
  }

  if (
    (RESTRICTED_DRUG_CLASSES as readonly string[]).includes(batch.drugClass) &&
    input.type === "dispose" &&
    !input.pharmacistId
  ) {
    throw new LedgerError(
      "pharmacist_required",
      "Disposing this class requires a responsible pharmacist.",
    );
  }

  const [movement] = await tx
    .insert(stockMovements)
    .values({
      batchId: batch.id,
      itemId: batch.itemId,
      type: input.type,
      qtyDelta: input.qtyDelta,
      reason: input.reason ?? null,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      performedBy: input.performedBy,
      pharmacistId: input.pharmacistId ?? null,
    })
    .returning({ id: stockMovements.id });

  const qtyAfter = batch.qtyRemaining + input.qtyDelta;

  // Status follows quantity: a batch that reaches zero is depleted, and one
  // that receives stock again becomes active.
  //
  // Disposed, quarantined and expired batches keep their status. The first two
  // are decisions rather than consequences; the third matters most -- without
  // it, disposing part of an expired batch would flip the remainder back to
  // active and put expired stock back on sale.
  const STICKY = ["disposed", "quarantined", "expired"] as const;
  const nextStatus =
    input.setStatus ??
    ((STICKY as readonly string[]).includes(batch.status)
      ? batch.status
      : qtyAfter === 0
        ? "depleted"
        : "active");

  await tx
    .update(batches)
    .set({ qtyRemaining: qtyAfter, status: nextStatus, updatedAt: new Date() })
    .where(eq(batches.id, batch.id));

  return { batchId: batch.id, qtyAfter, movementId: movement.id };
}

/**
 * On-hand for an item: the sum of what its sellable batches still hold.
 * Never stored, always derived -- an editable quantity column is the single
 * failure that makes an inventory system stop being trustworthy.
 */
export async function onHand(tx: Executor, itemId: string): Promise<number> {
  const [row] = await tx
    .select({ total: sql<number>`coalesce(sum(${batches.qtyRemaining}), 0)::int` })
    .from(batches)
    .where(and(eq(batches.itemId, itemId), eq(batches.status, "active")));
  return row?.total ?? 0;
}

/**
 * Checks that a batch's stored quantity still equals the sum of its movements.
 *
 * This is the invariant the whole design rests on. It is asserted in tests
 * against randomised sequences, and run by the nightly job so a drift is found
 * by the system rather than by a confused person holding a stock sheet.
 */
export async function reconcileBatch(
  tx: Executor,
  batchId: string,
): Promise<{ stored: number; ledger: number; agrees: boolean }> {
  const [batch] = await tx
    .select({ stored: batches.qtyRemaining })
    .from(batches)
    .where(eq(batches.id, batchId));

  const [sum] = await tx
    .select({
      ledger: sql<number>`coalesce(sum(${stockMovements.qtyDelta}), 0)::int`,
    })
    .from(stockMovements)
    .where(eq(stockMovements.batchId, batchId));

  const stored = batch?.stored ?? 0;
  const ledger = sum?.ledger ?? 0;
  return { stored, ledger, agrees: stored === ledger };
}

/** Every batch whose stored quantity disagrees with its ledger. Should be empty. */
export async function findLedgerDrift(tx: Executor) {
  return tx
    .select({
      batchId: batches.id,
      itemId: batches.itemId,
      stored: batches.qtyRemaining,
      ledger: sql<number>`coalesce(sum(${stockMovements.qtyDelta}), 0)::int`,
    })
    .from(batches)
    .leftJoin(stockMovements, eq(stockMovements.batchId, batches.id))
    .groupBy(batches.id)
    .having(
      sql`${batches.qtyRemaining} <> coalesce(sum(${stockMovements.qtyDelta}), 0)`,
    );
}

export type ReceiveInput = {
  itemId: string;
  lotNumber: string | null;
  expiryDate: string;
  supplierId: string;
  receivedDate: string;
  qty: number;
  unitCost: number;
  performedBy: string;
  /** `opening` for the go-live count, `receive` for an ordinary delivery. */
  type?: "receive" | "opening";
  isLegacy?: boolean;
  notes?: string | null;
};

/**
 * Books stock in.
 *
 * The batch is created holding nothing and then filled by a movement, rather
 * than created with a quantity already on it. That ordering is what makes the
 * ledger able to account for every unit a batch has ever held -- including the
 * first ones -- instead of starting its story after the delivery.
 */
export async function receiveStock(
  tx: Executor,
  input: ReceiveInput,
): Promise<{ batchId: string; movementId: string }> {
  if (input.qty <= 0) {
    throw new LedgerError("zero_movement", "A delivery must have a quantity.");
  }
  if (isExpired(input.expiryDate)) {
    throw new LedgerError("batch_expired", "That stock has already expired.");
  }

  const [batch] = await tx
    .insert(batches)
    .values({
      itemId: input.itemId,
      lotNumber: input.lotNumber,
      expiryDate: input.expiryDate,
      supplierId: input.supplierId,
      receivedDate: input.receivedDate,
      qtyReceived: input.qty,
      qtyRemaining: 0,
      unitCost: input.unitCost,
      isLegacy: input.isLegacy ?? false,
      notes: input.notes ?? null,
      receivedBy: input.performedBy,
    })
    .returning({ id: batches.id });

  const movement = await applyMovement(tx, {
    batchId: batch.id,
    type: input.type ?? "receive",
    qtyDelta: input.qty,
    performedBy: input.performedBy,
  });

  return { batchId: batch.id, movementId: movement.movementId };
}
