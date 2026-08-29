import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  batches,
  categories,
  items,
  stockCountLines,
  stockCounts,
  users,
} from "@/db/schema";
import { assertPermission } from "./session";
import { recordAudit } from "@/lib/audit";
import {
  cancelCount,
  CountError,
  openCount,
  postCount,
  recordCount,
  type OpenCountRequest,
} from "@/lib/stock/count";

export { CountError };

export type CreateCountRequest = Omit<OpenCountRequest, "actorId">;

export async function startCount(request: CreateCountRequest) {
  const session = await assertPermission("stock.count");
  const db = await getDb();

  const result = await db.transaction(async (tx) =>
    openCount(tx as unknown as typeof db, { ...request, actorId: session.user.id }),
  );

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "stock.count_opened",
    entityType: "stock_counts",
    entityId: result.countId,
    after: { countNumber: result.countNumber, lines: result.lines, ...request },
  });

  return result;
}

export async function listCounts(limit = 50) {
  await assertPermission("stock.count");
  const db = await getDb();

  return db
    .select({
      id: stockCounts.id,
      countNumber: stockCounts.countNumber,
      name: stockCounts.name,
      status: stockCounts.status,
      startedAt: stockCounts.startedAt,
      postedAt: stockCounts.postedAt,
      startedBy: users.fullName,
      categoryName: categories.name,
      lines: sql<number>`(select count(*)::int from ${stockCountLines} where ${stockCountLines.countId} = ${stockCounts.id})`,
      counted: sql<number>`(select count(*)::int from ${stockCountLines} where ${stockCountLines.countId} = ${stockCounts.id} and ${stockCountLines.countedQty} is not null)`,
      variances: sql<number>`(select count(*)::int from ${stockCountLines} where ${stockCountLines.countId} = ${stockCounts.id} and ${stockCountLines.countedQty} is not null and ${stockCountLines.countedQty} <> ${stockCountLines.expectedQty})`,
    })
    .from(stockCounts)
    .innerJoin(users, eq(users.id, stockCounts.startedBy))
    .leftJoin(categories, eq(categories.id, stockCounts.categoryId))
    .orderBy(desc(stockCounts.startedAt))
    .limit(limit);
}

/**
 * One count sheet: every batch in scope, in the order somebody walking the
 * shelves would meet them -- by item, then by expiry.
 */
export async function getCount(countId: string) {
  await assertPermission("stock.count");
  const db = await getDb();

  const [count] = await db
    .select({
      id: stockCounts.id,
      countNumber: stockCounts.countNumber,
      name: stockCounts.name,
      status: stockCounts.status,
      startedAt: stockCounts.startedAt,
      postedAt: stockCounts.postedAt,
      notes: stockCounts.notes,
      startedBy: users.fullName,
      categoryName: categories.name,
    })
    .from(stockCounts)
    .innerJoin(users, eq(users.id, stockCounts.startedBy))
    .leftJoin(categories, eq(categories.id, stockCounts.categoryId))
    .where(eq(stockCounts.id, countId))
    .limit(1);

  if (!count) return null;

  const lines = await db
    .select({
      id: stockCountLines.id,
      batchId: stockCountLines.batchId,
      expectedQty: stockCountLines.expectedQty,
      countedQty: stockCountLines.countedQty,
      reason: stockCountLines.reason,
      lotNumber: batches.lotNumber,
      expiryDate: batches.expiryDate,
      batchStatus: batches.status,
      itemId: items.id,
      code: items.code,
      genericName: items.genericName,
      strength: items.strength,
      unit: items.unit,
      drugClass: items.drugClass,
    })
    .from(stockCountLines)
    .innerJoin(batches, eq(batches.id, stockCountLines.batchId))
    .innerJoin(items, eq(items.id, stockCountLines.itemId))
    .where(eq(stockCountLines.countId, countId))
    .orderBy(asc(items.genericName), asc(batches.expiryDate));

  return { ...count, lines };
}

export async function saveCountLine(input: {
  lineId: string;
  countedQty: number | null;
  reason?: string | null;
}) {
  const session = await assertPermission("stock.count");
  const db = await getDb();

  return db.transaction(async (tx) =>
    recordCount(tx as unknown as typeof db, { ...input, actorId: session.user.id }),
  );
}

/**
 * Posts the count. This is the one action here that moves stock, so it carries
 * the audit entry that names how many batches it corrected.
 */
export async function postStockCount(countId: string) {
  const session = await assertPermission("stock.count");
  await assertPermission("stock.adjust");
  const db = await getDb();

  const result = await db.transaction(async (tx) =>
    postCount(tx as unknown as typeof db, { countId, actorId: session.user.id }),
  );

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "stock.count_posted",
    entityType: "stock_counts",
    entityId: countId,
    after: { adjusted: result.adjusted },
  });

  return result;
}

export async function cancelStockCount(countId: string) {
  const session = await assertPermission("stock.count");
  const db = await getDb();

  const result = await db.transaction(async (tx) =>
    cancelCount(tx as unknown as typeof db, { countId, actorId: session.user.id }),
  );

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "stock.count_cancelled",
    entityType: "stock_counts",
    entityId: countId,
  });

  return result;
}

/** Categories with something countable in them, for the new-count form. */
export async function countableCategories() {
  await assertPermission("stock.count");
  const db = await getDb();

  return db
    .select({
      id: categories.id,
      name: categories.name,
      batches: sql<number>`count(${batches.id})::int`,
    })
    .from(categories)
    .leftJoin(items, eq(items.categoryId, categories.id))
    .leftJoin(
      batches,
      and(eq(batches.itemId, items.id), sql`${batches.status} in ('active','quarantined','expired')`),
    )
    .groupBy(categories.id)
    .orderBy(asc(categories.name));
}
