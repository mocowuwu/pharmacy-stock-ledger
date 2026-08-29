import { daysBetween } from "@/lib/format/date";

/**
 * The six alert rules.
 *
 * Kept a pure function of a snapshot: given the items, the batches and when
 * each item last sold, it returns what should be on the dashboard. Nothing here
 * reads a database or a clock, so every rule and every boundary can be tested
 * exactly.
 */

export type AlertType =
  | "expired_stock"
  | "out_of_stock"
  | "expiring_urgent"
  | "low_stock"
  | "expiring_notice"
  | "dead_stock";

export type AlertSeverity = "critical" | "warning" | "notice";

export type Thresholds = {
  expiringUrgentDays: number;
  expiringNoticeDays: number;
  deadStockNoSaleDays: number;
  deadStockExpiryDays: number;
};

export const DEFAULT_THRESHOLDS: Thresholds = {
  expiringUrgentDays: 30,
  expiringNoticeDays: 90,
  deadStockNoSaleDays: 90,
  deadStockExpiryDays: 180,
};

export type ItemSnapshot = {
  id: string;
  reorderPoint: number;
  reorderQty: number | null;
  status: "active" | "archived";
  /** Last date this item sold, or null if it never has. */
  lastSoldOn: string | null;
};

export type BatchSnapshot = {
  id: string;
  itemId: string;
  expiryDate: string;
  qtyRemaining: number;
  unitCost: number;
  status: "active" | "quarantined" | "expired" | "disposed" | "depleted";
};

export type ComputedAlert = {
  type: AlertType;
  severity: AlertSeverity;
  itemId: string;
  batchId: string | null;
  context: Record<string, number | string | null>;
};

export const SEVERITY_OF: Record<AlertType, AlertSeverity> = {
  expired_stock: "critical",
  out_of_stock: "critical",
  expiring_urgent: "warning",
  low_stock: "warning",
  expiring_notice: "notice",
  dead_stock: "notice",
};

/** Critical alerts cannot be snoozed: expired stock stays on screen until it is off the shelf. */
export function canSnooze(type: AlertType): boolean {
  return SEVERITY_OF[type] !== "critical";
}

/** Batches that still physically hold stock, whatever their status says. */
function holdsStock(batch: BatchSnapshot): boolean {
  return batch.qtyRemaining > 0 && batch.status !== "disposed" && batch.status !== "depleted";
}

/** Batches that can actually be sold. */
function sellable(batch: BatchSnapshot, today: string): boolean {
  return (
    batch.status === "active" &&
    batch.qtyRemaining > 0 &&
    daysBetween(today, batch.expiryDate) >= 0
  );
}

export function computeAlerts(input: {
  today: string;
  items: readonly ItemSnapshot[];
  batches: readonly BatchSnapshot[];
  thresholds?: Partial<Thresholds>;
}): ComputedAlert[] {
  const t = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
  const { today } = input;

  const byItem = new Map<string, BatchSnapshot[]>();
  for (const batch of input.batches) {
    const list = byItem.get(batch.itemId);
    if (list) list.push(batch);
    else byItem.set(batch.itemId, [batch]);
  }

  const alerts: ComputedAlert[] = [];

  for (const item of input.items) {
    // Archived items are out of the catalogue; alerting on them would be noise
    // about something nobody intends to sell.
    if (item.status !== "active") continue;

    const batches = byItem.get(item.id) ?? [];
    const onHand = batches
      .filter((b) => sellable(b, today))
      .reduce((sum, b) => sum + b.qtyRemaining, 0);

    /* --- item-level ------------------------------------------------------ */

    if (onHand === 0) {
      alerts.push({
        type: "out_of_stock",
        severity: "critical",
        itemId: item.id,
        batchId: null,
        context: {
          lastSoldOn: item.lastSoldOn,
          daysSinceSale: item.lastSoldOn ? daysBetween(item.lastSoldOn, today) : null,
          reorderQty: item.reorderQty,
          // Stock that exists but cannot be sold. "None left" and "200 on the
          // shelf that expired last week" are different problems.
          expiredUnits: batches
            .filter((b) => holdsStock(b) && daysBetween(today, b.expiryDate) < 0)
            .reduce((sum, b) => sum + b.qtyRemaining, 0),
        },
      });
    } else if (onHand <= item.reorderPoint) {
      alerts.push({
        type: "low_stock",
        severity: "warning",
        itemId: item.id,
        batchId: null,
        context: { onHand, reorderPoint: item.reorderPoint, reorderQty: item.reorderQty },
      });
    }

    /* --- batch-level ----------------------------------------------------- */

    for (const batch of batches) {
      if (!holdsStock(batch)) continue;
      const days = daysBetween(today, batch.expiryDate);
      const value = batch.qtyRemaining * batch.unitCost;

      if (days < 0) {
        alerts.push({
          type: "expired_stock",
          severity: "critical",
          itemId: item.id,
          batchId: batch.id,
          context: {
            qty: batch.qtyRemaining,
            daysExpired: Math.abs(days),
            expiryDate: batch.expiryDate,
            valueAtCost: value,
          },
        });
        // An expired batch is already the loudest thing that can be said about
        // it; the expiry-warning rules would only repeat it.
        continue;
      }

      if (batch.status !== "active") continue;

      let flaggedExpiry = false;
      if (days <= t.expiringUrgentDays) {
        flaggedExpiry = true;
        alerts.push({
          type: "expiring_urgent",
          severity: "warning",
          itemId: item.id,
          batchId: batch.id,
          context: {
            qty: batch.qtyRemaining, days, expiryDate: batch.expiryDate, valueAtCost: value,
          },
        });
      } else if (days <= t.expiringNoticeDays) {
        flaggedExpiry = true;
        alerts.push({
          type: "expiring_notice",
          severity: "notice",
          itemId: item.id,
          batchId: batch.id,
          context: {
            qty: batch.qtyRemaining, days, expiryDate: batch.expiryDate, valueAtCost: value,
          },
        });
      }

      // Dead stock is the money-at-risk rule: bought, not moving, and heading
      // for expiry while there is still time to act commercially -- discount
      // it, move it, return it under supplier terms.
      //
      // Suppressed when an expiry alert already fired for this batch. Three
      // rows about one box trains people to skim the list, and by then the
      // expiry warning is saying the same thing more urgently. What remains is
      // a distinct band: not selling, and expiring in the medium term.
      if (!flaggedExpiry && days <= t.deadStockExpiryDays) {
        const idle = item.lastSoldOn ? daysBetween(item.lastSoldOn, today) : Infinity;
        if (idle >= t.deadStockNoSaleDays) {
          alerts.push({
            type: "dead_stock",
            severity: "notice",
            itemId: item.id,
            batchId: batch.id,
            context: {
              qty: batch.qtyRemaining,
              days,
              lastSoldOn: item.lastSoldOn,
              valueAtCost: value,
            },
          });
        }
      }
    }
  }

  return alerts;
}

/** Groups alerts by severity, for the dashboard tiles. */
export function countBySeverity(alerts: readonly ComputedAlert[]) {
  return alerts.reduce(
    (counts, alert) => {
      counts[alert.severity] += 1;
      return counts;
    },
    { critical: 0, warning: 0, notice: 0 },
  );
}
