import "server-only";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import { devices, offlineSaleReviews, sales, users } from "@/db/schema";
import { assertPermission } from "./session";
import { recordAudit } from "@/lib/audit";
import { closeOfflineReview, retryOfflineReview } from "@/lib/offline/replay";
import type { OfflineSale } from "@/lib/offline/contract";

/**
 * The review list for offline sales, and the devices screen.
 *
 * Reviewing needs `sales.view_all`: it is the manager's view of every
 * cashier's sales, and the list shows whose they were. Devices belong with
 * accounts, under `users.manage`.
 */

export class OfflineReviewError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "OfflineReviewError";
  }
}

export async function openOfflineReviewCount(): Promise<number> {
  await assertPermission("sales.view_all");
  const db = await getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(offlineSaleReviews)
    .where(isNull(offlineSaleReviews.resolvedAt));
  return row?.n ?? 0;
}

export async function listOfflineReviews(opts: { open: boolean }) {
  await assertPermission("sales.view_all");
  const db = await getDb();
  const resolver = alias(users, "resolver");

  const rows = await db
    .select({
      id: offlineSaleReviews.id,
      kind: offlineSaleReviews.kind,
      offlineNumber: offlineSaleReviews.offlineNumber,
      soldAt: offlineSaleReviews.soldAt,
      reasons: offlineSaleReviews.reasons,
      payload: offlineSaleReviews.payload,
      createdAt: offlineSaleReviews.createdAt,
      resolvedAt: offlineSaleReviews.resolvedAt,
      resolutionNote: offlineSaleReviews.resolutionNote,
      resolvedBy: resolver.fullName,
      cashier: users.fullName,
      device: devices.name,
      saleId: offlineSaleReviews.saleId,
      saleNumber: sales.saleNumber,
    })
    .from(offlineSaleReviews)
    .innerJoin(users, eq(users.id, offlineSaleReviews.cashierId))
    .innerJoin(devices, eq(devices.id, offlineSaleReviews.deviceId))
    .leftJoin(sales, eq(sales.id, offlineSaleReviews.saleId))
    .leftJoin(resolver, eq(resolver.id, offlineSaleReviews.resolvedBy))
    .where(
      opts.open
        ? isNull(offlineSaleReviews.resolvedAt)
        : sql`${offlineSaleReviews.resolvedAt} is not null`,
    )
    .orderBy(desc(offlineSaleReviews.soldAt))
    .limit(200);

  return rows.map((row) => {
    const sale = row.payload as OfflineSale;
    return { ...row, total: sale.total, lineCount: sale.lines.length };
  });
}

export async function retryOfflineReviewAs(reviewId: string, note: string) {
  const session = await assertPermission("sales.view_all");
  if (!note.trim()) throw new OfflineReviewError("reason_required");
  const db = await getDb();

  const result = await retryOfflineReview(db, {
    reviewId,
    actorId: session.user.id,
    note: note.trim(),
  });
  if (!result.ok) throw new OfflineReviewError(result.code);

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "offline_review.posted",
    entityType: "offline_sale_reviews",
    entityId: reviewId,
    after: { saleNumber: result.saleNumber, note: note.trim() },
  });
  return result;
}

export async function closeOfflineReviewAs(reviewId: string, note: string) {
  const session = await assertPermission("sales.view_all");
  if (!note.trim()) throw new OfflineReviewError("reason_required");
  const db = await getDb();

  const closed = await closeOfflineReview(db, {
    reviewId,
    actorId: session.user.id,
    note: note.trim(),
  });
  if (!closed) throw new OfflineReviewError("review_not_open");

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "offline_review.closed",
    entityType: "offline_sale_reviews",
    entityId: reviewId,
    after: { note: note.trim() },
  });
}

/* ---------------------------------------------------------------- devices */

export async function listDevices() {
  await assertPermission("users.manage");
  const db = await getDb();
  const registrar = alias(users, "registrar");

  return db
    .select({
      id: devices.id,
      name: devices.name,
      role: devices.role,
      code: devices.code,
      appVersion: devices.appVersion,
      createdAt: devices.createdAt,
      lastSeenAt: devices.lastSeenAt,
      lastSyncAt: devices.lastSyncAt,
      revokedAt: devices.revokedAt,
      registeredBy: registrar.fullName,
      offlineSales: sql<number>`(select count(*)::int from ${sales} where ${sales.deviceId} = ${devices.id})`,
    })
    .from(devices)
    .innerJoin(registrar, eq(registrar.id, devices.registeredBy))
    .orderBy(desc(devices.lastSeenAt));
}

/**
 * Cuts a device off: its token stops working and it cannot register again
 * under the same id. Its offline sales stay, naming it.
 */
export async function revokeDevice(deviceId: string) {
  const session = await assertPermission("users.manage");
  const db = await getDb();

  const [revoked] = await db
    .update(devices)
    .set({ revokedAt: new Date(), revokedBy: session.user.id })
    .where(and(eq(devices.id, deviceId), isNull(devices.revokedAt)))
    .returning({ id: devices.id, name: devices.name, code: devices.code });
  if (!revoked) return;

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "device.revoked",
    entityType: "devices",
    entityId: deviceId,
    after: { name: revoked.name, code: revoked.code },
  });
}
