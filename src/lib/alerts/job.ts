import { and, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { alerts, batches, items, settings, stockMovements } from "@/db/schema";
import { today } from "@/lib/format/date";
import {
  computeAlerts,
  DEFAULT_THRESHOLDS,
  type ComputedAlert,
} from "./rules";

/**
 * The alert job.
 *
 * Runs nightly and after any movement that could change the picture. It does
 * three things in order: quarantines stock that has passed its expiry date,
 * works out what should be on the dashboard, and reconciles that against what
 * is already there.
 *
 * Alerts are persisted rather than recomputed on every page load, because the
 * useful questions are historical: how long has this been out of stock, who
 * acknowledged it, when. A query could answer the first half of that and none
 * of the second.
 */

/** Key for matching a computed alert against a stored one. */
const keyOf = (a: { type: string; itemId: string; batchId: string | null }) =>
  `${a.type}|${a.itemId}|${a.batchId ?? "-"}`;

export type AlertJobResult = {
  quarantined: number;
  opened: number;
  refreshed: number;
  resolved: number;
  total: number;
};

/**
 * Marks batches whose expiry date has passed. This is the auto-quarantine: the
 * ledger already refuses to sell expired stock, and this makes the shelf state
 * match that refusal so nothing appears sellable when it is not.
 */
export async function quarantineExpired(db: Database, on: string): Promise<number> {
  const updated = await db
    .update(batches)
    .set({ status: "expired", updatedAt: new Date() })
    .where(
      and(
        eq(batches.status, "active"),
        lt(batches.expiryDate, on),
        gt(batches.qtyRemaining, 0),
      ),
    )
    .returning({ id: batches.id });
  return updated.length;
}

export async function runAlertJob(
  db: Database,
  options: { on?: string } = {},
): Promise<AlertJobResult> {
  const on = options.on ?? today();

  const quarantined = await quarantineExpired(db, on);

  const [config] = await db.select().from(settings).where(eq(settings.id, 1));
  const thresholds = config
    ? {
        expiringUrgentDays: config.expiringUrgentDays,
        expiringNoticeDays: config.expiringNoticeDays,
        deadStockNoSaleDays: config.deadStockNoSaleDays,
        deadStockExpiryDays: config.deadStockExpiryDays,
      }
    : DEFAULT_THRESHOLDS;

  const itemRows = await db
    .select({
      id: items.id,
      reorderPoint: items.reorderPoint,
      reorderQty: items.reorderQty,
      status: items.status,
    })
    .from(items);

  const batchRows = await db
    .select({
      id: batches.id,
      itemId: batches.itemId,
      expiryDate: batches.expiryDate,
      qtyRemaining: batches.qtyRemaining,
      unitCost: batches.unitCost,
      status: batches.status,
    })
    .from(batches);

  // Last sale per item, taken from the ledger rather than from sales, so a
  // voided sale does not count as movement.
  const lastSales = await db
    .select({
      itemId: stockMovements.itemId,
      lastSoldAt: sql<string>`max(${stockMovements.createdAt})::date`,
    })
    .from(stockMovements)
    .where(eq(stockMovements.type, "sale"))
    .groupBy(stockMovements.itemId);

  const lastSoldByItem = new Map(lastSales.map((r) => [r.itemId, r.lastSoldAt]));

  const computed = computeAlerts({
    today: on,
    items: itemRows.map((i) => ({ ...i, lastSoldOn: lastSoldByItem.get(i.id) ?? null })),
    batches: batchRows,
    thresholds,
  });

  const existing = await db
    .select({
      id: alerts.id,
      type: alerts.type,
      itemId: alerts.itemId,
      batchId: alerts.batchId,
      status: alerts.status,
      snoozedUntil: alerts.snoozedUntil,
    })
    .from(alerts)
    .where(ne(alerts.status, "resolved"));

  const existingByKey = new Map(existing.map((row) => [keyOf(row), row]));
  const now = new Date();

  let opened = 0;
  let refreshed = 0;

  for (const alert of computed) {
    const match = existingByKey.get(keyOf(alert));

    if (!match) {
      await db.insert(alerts).values({
        type: alert.type,
        severity: alert.severity,
        itemId: alert.itemId,
        batchId: alert.batchId,
        context: alert.context,
        firstSeenAt: now,
        lastSeenAt: now,
      });
      opened += 1;
      continue;
    }

    // An expired snooze returns the alert to the open list rather than leaving
    // it hidden: snoozing is a delay, not a dismissal.
    const snoozeLapsed =
      match.status === "snoozed" && match.snoozedUntil !== null && match.snoozedUntil <= now;

    await db
      .update(alerts)
      .set({
        lastSeenAt: now,
        severity: alert.severity,
        context: alert.context,
        ...(snoozeLapsed ? { status: "open" as const, snoozedUntil: null } : {}),
      })
      .where(eq(alerts.id, match.id));

    refreshed += 1;
    existingByKey.delete(keyOf(alert));
  }

  // Whatever is left was true yesterday and is not true now. Resolving is
  // automatic: receive stock and the out-of-stock alert closes itself, with the
  // moment recorded. Nobody ticks anything off.
  const stale = [...existingByKey.values()].map((row) => row.id);
  if (stale.length > 0) {
    await db
      .update(alerts)
      .set({ status: "resolved", resolvedAt: now })
      .where(inArray(alerts.id, stale));
  }

  return {
    quarantined,
    opened,
    refreshed,
    resolved: stale.length,
    total: computed.length,
  };
}

/** Open alerts that are not currently snoozed, newest problem first. */
export function liveAlertFilter() {
  return and(
    ne(alerts.status, "resolved"),
    sql`(${alerts.status} <> 'snoozed' or ${alerts.snoozedUntil} is null or ${alerts.snoozedUntil} <= now())`,
  );
}

export type { ComputedAlert };
