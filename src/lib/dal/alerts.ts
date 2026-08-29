import "server-only";

import { and, asc, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { alerts, batches, items, users } from "@/db/schema";
import { assertPermission } from "./session";
import { recordAudit } from "@/lib/audit";
import { runAlertJob } from "@/lib/alerts/job";
import { canSnooze, type AlertSeverity, type AlertType } from "@/lib/alerts/rules";

/** Alerts that should be on screen now: open, or snoozed past their snooze. */
const LIVE = sql`${alerts.status} <> 'resolved' and (${alerts.status} <> 'snoozed' or ${alerts.snoozedUntil} is null or ${alerts.snoozedUntil} <= now())`;

const SEVERITY_ORDER = sql`case ${alerts.severity}
  when 'critical' then 0 when 'warning' then 1 else 2 end`;

export type AlertRow = Awaited<ReturnType<typeof listAlerts>>[number];

export async function listAlerts(filter: { type?: AlertType; severity?: AlertSeverity } = {}) {
  await assertPermission("alerts.view");
  const db = await getDb();

  return db
    .select({
      id: alerts.id,
      type: alerts.type,
      severity: alerts.severity,
      status: alerts.status,
      context: alerts.context,
      firstSeenAt: alerts.firstSeenAt,
      snoozedUntil: alerts.snoozedUntil,
      acknowledgedAt: alerts.acknowledgedAt,
      acknowledgedBy: users.fullName,
      itemId: items.id,
      itemCode: items.code,
      itemName: items.genericName,
      strength: items.strength,
      unit: items.unit,
      lotNumber: batches.lotNumber,
      expiryDate: batches.expiryDate,
    })
    .from(alerts)
    .innerJoin(items, eq(items.id, alerts.itemId))
    .leftJoin(batches, eq(batches.id, alerts.batchId))
    .leftJoin(users, eq(users.id, alerts.acknowledgedBy))
    .where(
      and(
        LIVE,
        filter.type ? eq(alerts.type, filter.type) : undefined,
        filter.severity ? eq(alerts.severity, filter.severity) : undefined,
      ),
    )
    .orderBy(SEVERITY_ORDER, asc(alerts.firstSeenAt))
    .limit(500);
}

/** Counts for the dashboard tiles, in one query rather than one per tile. */
export async function alertCounts() {
  await assertPermission("alerts.view");
  const db = await getDb();

  const rows = await db
    .select({ type: alerts.type, n: sql<number>`count(*)::int` })
    .from(alerts)
    .where(LIVE)
    .groupBy(alerts.type);

  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.type] = row.n;
  return counts;
}

/**
 * Acknowledging means "seen, ordered, on its way". The alert dims but stays
 * open, tagged with who acknowledged it -- it is not a way to make something
 * disappear.
 */
export async function acknowledgeAlert(alertId: string, note?: string) {
  const session = await assertPermission("alerts.manage");
  const db = await getDb();

  const [updated] = await db
    .update(alerts)
    .set({
      status: "acknowledged",
      acknowledgedBy: session.user.id,
      acknowledgedAt: new Date(),
      acknowledgeNote: note?.trim() || null,
    })
    .where(and(eq(alerts.id, alertId), ne(alerts.status, "resolved")))
    .returning({ id: alerts.id, type: alerts.type });

  if (updated) {
    await recordAudit({
      userId: session.user.id,
      actorLabel: session.user.username,
      action: "alert.acknowledged",
      entityType: "alerts",
      entityId: alertId,
      after: { note: note ?? null },
    });
  }
  return updated ?? null;
}

export class AlertError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AlertError";
  }
}

/** Warnings and notices only, and never longer than 30 days. */
export const MAX_SNOOZE_DAYS = 30;

export async function snoozeAlert(alertId: string, days: number) {
  const session = await assertPermission("alerts.manage");
  const db = await getDb();

  const [alert] = await db
    .select({ type: alerts.type, severity: alerts.severity })
    .from(alerts)
    .where(eq(alerts.id, alertId))
    .limit(1);
  if (!alert) throw new AlertError("alert_not_found");

  // Expired stock on the shelf stays on screen until it is off the shelf.
  if (!canSnooze(alert.type as AlertType)) throw new AlertError("cannot_snooze_critical");

  const capped = Math.min(Math.max(Math.trunc(days), 1), MAX_SNOOZE_DAYS);
  const until = new Date(Date.now() + capped * 86_400_000);

  await db
    .update(alerts)
    .set({ status: "snoozed", snoozedUntil: until, snoozedBy: session.user.id })
    .where(eq(alerts.id, alertId));

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "alert.snoozed",
    entityType: "alerts",
    entityId: alertId,
    after: { days: capped, until: until.toISOString() },
  });

  return { until, days: capped };
}

/** Recomputes on demand, for the refresh button and after stock changes. */
export async function refreshAlerts() {
  await assertPermission("alerts.view");
  const db = await getDb();
  return runAlertJob(db);
}
