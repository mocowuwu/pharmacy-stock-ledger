import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  batches,
  items,
  stockAdjustments,
  stockCountLines,
  stockCounts,
} from "@/db/schema";
import { applyMovement, LedgerError } from "./ledger";
import { today } from "@/lib/format/date";

/**
 * Stock opname -- the physical count.
 *
 * Two jobs, one mechanism: the recurring count that keeps the record honest,
 * and the go-live count that establishes opening stock in the first place.
 *
 * A count is a snapshot plus a decision. Opening it writes down what the system
 * believed at that moment, per batch; counting fills in what was actually on
 * the shelf; posting turns each difference into an adjustment through the
 * ledger, with a reason attached to every one. Nothing is ever silently
 * corrected -- if the shelf and the record disagree, the ledger says so and
 * says why.
 */

export class CountError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "CountError";
  }
}

export async function nextCountNumber(tx: Database, on: string): Promise<string> {
  const prefix = `SO${on.replaceAll("-", "").slice(2)}`; // SOYYMMDD
  const [last] = await tx
    .select({ number: stockCounts.countNumber })
    .from(stockCounts)
    .where(sql`${stockCounts.countNumber} like ${`${prefix}-%`}`)
    .orderBy(desc(stockCounts.countNumber))
    .limit(1);

  const seq = last ? Number(last.number.split("-")[1]) + 1 : 1;
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

export type OpenCountRequest = {
  name: string;
  /** Counting one category at a time is far less disruptive than closing. */
  categoryId?: string | null;
  actorId: string;
  notes?: string | null;
};

/**
 * Opens a count and snapshots the shelf as the system currently believes it.
 *
 * Depleted and disposed batches are left out -- there is nothing to count --
 * but quarantined and expired batches are included. Those units are physically
 * present and a count that ignored them would report a variance against stock
 * sitting right there on the quarantine shelf.
 */
export async function openCount(tx: Database, request: OpenCountRequest) {
  if (!request.name.trim()) throw new CountError("name_required");

  const countNumber = await nextCountNumber(tx, today());

  const [count] = await tx
    .insert(stockCounts)
    .values({
      countNumber,
      name: request.name.trim(),
      categoryId: request.categoryId ?? null,
      status: "counting",
      startedBy: request.actorId,
      notes: request.notes ?? null,
    })
    .returning({ id: stockCounts.id });

  const countable = await tx
    .select({
      batchId: batches.id,
      itemId: batches.itemId,
      qtyRemaining: batches.qtyRemaining,
    })
    .from(batches)
    .innerJoin(items, eq(items.id, batches.itemId))
    .where(
      and(
        inArray(batches.status, ["active", "quarantined", "expired"]),
        request.categoryId ? eq(items.categoryId, request.categoryId) : undefined,
      ),
    );

  if (countable.length > 0) {
    await tx.insert(stockCountLines).values(
      countable.map((row) => ({
        countId: count.id,
        batchId: row.batchId,
        itemId: row.itemId,
        expectedQty: row.qtyRemaining,
      })),
    );
  }

  return { countId: count.id, countNumber, lines: countable.length };
}

/**
 * Records what was on the shelf for one line.
 *
 * A variance needs a reason before the count can be posted, but not before it
 * can be typed -- the person holding the boxes should not have to stop and
 * explain each one mid-aisle.
 */
export async function recordCount(
  tx: Database,
  input: { lineId: string; countedQty: number | null; reason?: string | null; actorId: string },
) {
  if (input.countedQty != null && (!Number.isInteger(input.countedQty) || input.countedQty < 0)) {
    throw new CountError("invalid_quantity");
  }

  const [line] = await tx
    .select({ id: stockCountLines.id, countId: stockCountLines.countId })
    .from(stockCountLines)
    .where(eq(stockCountLines.id, input.lineId))
    .limit(1);
  if (!line) throw new CountError("line_not_found");

  const [count] = await tx
    .select({ status: stockCounts.status })
    .from(stockCounts)
    .where(eq(stockCounts.id, line.countId))
    .limit(1);
  if (count?.status !== "counting" && count?.status !== "review") {
    throw new CountError("count_closed");
  }

  await tx
    .update(stockCountLines)
    .set({
      countedQty: input.countedQty,
      reason: input.reason?.trim() || null,
      countedBy: input.countedQty == null ? null : input.actorId,
      countedAt: input.countedQty == null ? null : new Date(),
    })
    .where(eq(stockCountLines.id, input.lineId));

  return { lineId: input.lineId };
}

/** The lines that differ from what the system expected, with their reasons. */
export async function variances(tx: Database, countId: string) {
  return tx
    .select({
      lineId: stockCountLines.id,
      batchId: stockCountLines.batchId,
      itemId: stockCountLines.itemId,
      expectedQty: stockCountLines.expectedQty,
      countedQty: stockCountLines.countedQty,
      reason: stockCountLines.reason,
    })
    .from(stockCountLines)
    .where(
      and(
        eq(stockCountLines.countId, countId),
        isNotNull(stockCountLines.countedQty),
        ne(stockCountLines.countedQty, stockCountLines.expectedQty),
      ),
    );
}

/**
 * Posts the count: every variance becomes an adjustment through the ledger.
 *
 * The adjustment is the *difference* the counter found, not an assignment of
 * the counted number onto the batch. That distinction matters if anything moved
 * between the sheet being printed and the count being posted: applying the
 * difference leaves a sale that happened in the meantime intact, whereas
 * writing the counted figure straight onto the batch would quietly erase it.
 * Stock is meant to be frozen during a count and then the two are identical --
 * this is what happens when it wasn't.
 */
export async function postCount(
  tx: Database,
  input: { countId: string; actorId: string },
) {
  const [count] = await tx
    .select()
    .from(stockCounts)
    .where(eq(stockCounts.id, input.countId))
    .for("update")
    .limit(1);

  if (!count) throw new CountError("count_not_found");
  if (count.status === "posted") throw new CountError("already_posted");
  if (count.status === "cancelled") throw new CountError("count_cancelled");

  const lines = await variances(tx, input.countId);

  const unexplained = lines.filter((line) => !line.reason?.trim());
  if (unexplained.length > 0) {
    throw new CountError("reason_required", { lines: unexplained.length });
  }

  for (const line of lines) {
    const delta = (line.countedQty ?? 0) - line.expectedQty;
    if (delta === 0) continue;

    const [batch] = await tx
      .select({ qtyRemaining: batches.qtyRemaining })
      .from(batches)
      .where(eq(batches.id, line.batchId))
      .limit(1);
    if (!batch) throw new CountError("batch_not_found");

    // The database check constraint would refuse this anyway; catching it here
    // names the item instead of failing the whole post with a constraint error.
    if (batch.qtyRemaining + delta < 0) {
      throw new CountError("would_go_negative", {
        batchId: line.batchId,
        onHand: batch.qtyRemaining,
        delta,
      });
    }

    await tx.insert(stockAdjustments).values({
      batchId: line.batchId,
      qtyBefore: batch.qtyRemaining,
      qtyAfter: batch.qtyRemaining + delta,
      reason: line.reason!,
      countId: input.countId,
      performedBy: input.actorId,
    });

    await applyMovement(tx, {
      batchId: line.batchId,
      type: "adjust",
      qtyDelta: delta,
      performedBy: input.actorId,
      reason: line.reason!,
      refType: "stock_counts",
      refId: input.countId,
    });
  }

  await tx
    .update(stockCounts)
    .set({ status: "posted", postedBy: input.actorId, postedAt: new Date() })
    .where(eq(stockCounts.id, input.countId));

  return { countId: input.countId, adjusted: lines.length };
}

export async function cancelCount(
  tx: Database,
  input: { countId: string; actorId: string },
) {
  const [count] = await tx
    .select({ status: stockCounts.status })
    .from(stockCounts)
    .where(eq(stockCounts.id, input.countId))
    .limit(1);

  if (!count) throw new CountError("count_not_found");
  // A posted count has moved stock. Cancelling it would mean unpicking
  // adjustments that are already in the ledger, which is not a cancellation --
  // it is another count.
  if (count.status === "posted") throw new CountError("already_posted");

  await tx
    .update(stockCounts)
    .set({ status: "cancelled" })
    .where(eq(stockCounts.id, input.countId));

  return { countId: input.countId };
}

/** Raised when a movement is refused mid-post, so the caller can name the item. */
export { LedgerError };
