import { desc, eq, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { batches, disposals } from "@/db/schema";
import { applyMovement, LedgerError } from "./ledger";
import { lockNumberSeries } from "./numbering";
import { today } from "@/lib/format/date";

/**
 * Disposal -- writing stock off the shelf.
 *
 * Kept separate from an adjustment on purpose. A disposal is a loss: expired,
 * damaged or recalled medicine physically destroyed. An adjustment is a
 * bookkeeping correction: the shelf and the record disagreed and the record was
 * wrong. Conflating them destroys the expiry-loss report, which is the number
 * that tells the owner whether they are over-ordering.
 *
 * This is also the only thing that finally clears an expired batch. Until stock
 * is disposed, its alert stays on screen and cannot be snoozed -- by design.
 */

export type DisposeRequest = {
  batchId: string;
  qty: number;
  reason: string;
  /** How it was destroyed. Free text; incineration, returned to supplier, etc. */
  method?: string | null;
  actorId: string;
  /** Destruction of drug stock is commonly witnessed by a second person. */
  witnessedBy?: string | null;
  pharmacistId?: string | null;
  notes?: string | null;
};

/** Sequential per day and never reused, like the sale and return numbers. */
export async function nextDisposalNumber(tx: Database, on: string): Promise<string> {
  await lockNumberSeries(tx, "disposal", on);
  const prefix = `D${on.replaceAll("-", "").slice(2)}`; // DYYMMDD
  const [last] = await tx
    .select({ number: disposals.disposalNumber })
    .from(disposals)
    .where(sql`${disposals.disposalNumber} like ${`${prefix}-%`}`)
    .orderBy(desc(disposals.disposalNumber))
    .limit(1);

  const seq = last ? Number(last.number.split("-")[1]) + 1 : 1;
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

/**
 * Writes stock off inside the caller's transaction.
 *
 * The cost value is snapshotted rather than joined at report time: a batch's
 * unit cost is stable today, but the expiry-loss report has to keep telling the
 * truth years from now, and this is what the money was.
 */
export async function disposeStock(tx: Database, request: DisposeRequest) {
  if (!Number.isInteger(request.qty) || request.qty <= 0) {
    throw new LedgerError("zero_movement", "A disposal must have a quantity.");
  }
  if (!request.reason.trim()) {
    throw new LedgerError("reason_required", "A disposal must record why.");
  }

  const [batch] = await tx
    .select({
      id: batches.id,
      qtyRemaining: batches.qtyRemaining,
      unitCost: batches.unitCost,
      status: batches.status,
    })
    .from(batches)
    .where(eq(batches.id, request.batchId))
    .limit(1);

  if (!batch) throw new LedgerError("batch_not_found", "That batch does not exist.");
  if (batch.status === "disposed") {
    throw new LedgerError("batch_not_sellable", "That batch is already disposed.");
  }

  const disposalNumber = await nextDisposalNumber(tx, today());
  const costValue = request.qty * batch.unitCost;

  const [record] = await tx
    .insert(disposals)
    .values({
      disposalNumber,
      batchId: batch.id,
      qty: request.qty,
      costValue,
      reason: request.reason,
      method: request.method ?? null,
      disposedBy: request.actorId,
      witnessedBy: request.witnessedBy ?? null,
      pharmacistId: request.pharmacistId ?? null,
      notes: request.notes ?? null,
    })
    .returning({ id: disposals.id });

  // The ledger does the rest: it locks the batch, refuses to go negative, and
  // insists on a responsible pharmacist for the restricted classes.
  const movement = await applyMovement(tx, {
    batchId: batch.id,
    type: "dispose",
    qtyDelta: -request.qty,
    performedBy: request.actorId,
    reason: request.reason,
    refType: "disposals",
    refId: record.id,
    pharmacistId: request.pharmacistId ?? null,
    // A batch emptied by disposal is disposed, not depleted. Without this it
    // would read as ordinary stock that happened to run out, and the expired
    // batch would lose the only status that says what became of it.
    setStatus: batch.qtyRemaining - request.qty === 0 ? "disposed" : null,
  });

  return {
    disposalId: record.id,
    disposalNumber,
    costValue,
    qtyAfter: movement.qtyAfter,
  };
}
