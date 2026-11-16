import { daysBetween } from "@/lib/format/date";

/**
 * The six alert rules.
 *
 * Kept a pure function of a snapshot: given the items, the batches and when
 * each item last sold, it returns what should be on the dashboard. Nothing here
 * reads a database or a clock, so every rule and every boundary can be tested
 * exactly.
 *
 * **Two rules are facts and four are judgements.** Expired stock on the shelf
 * and an empty shelf are not thresholds: they always fire, always critical,
 * and nothing in the pharmacy's own rules (`AlertRules`) can switch them off,
 * soften them or make them snoozable. The other four -- what counts as
 * expiring soon, as running low, as not moving -- are the pharmacy's to set,
 * by whoever holds `alerts.configure`.
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
  /**
   * The minimum for an item that has none of its own (`reorderPoint` 0).
   * 0 leaves such items out of the low-stock rule, as they always were.
   */
  lowStockDefaultPoint: number;
  /**
   * Also low when what is on the shelf would not last this many days at the
   * rate it sold over the last `SALES_RATE_WINDOW_DAYS`. 0 switches it off.
   */
  lowStockCoverDays: number;
};

export const DEFAULT_THRESHOLDS: Thresholds = {
  expiringUrgentDays: 30,
  expiringNoticeDays: 90,
  deadStockNoSaleDays: 90,
  deadStockExpiryDays: 180,
  lowStockDefaultPoint: 0,
  lowStockCoverDays: 0,
};

/** The window the selling rate behind `lowStockCoverDays` is measured over. */
export const SALES_RATE_WINDOW_DAYS = 30;

/** The rules a pharmacy may switch off or re-grade. The two critical ones are not here. */
export const CONFIGURABLE_ALERTS = [
  "expiring_urgent",
  "low_stock",
  "expiring_notice",
  "dead_stock",
] as const;

export type ConfigurableAlert = (typeof CONFIGURABLE_ALERTS)[number];

/** A configurable rule is never critical: critical is reserved for the two facts. */
export const CONFIGURABLE_SEVERITIES = ["warning", "notice"] as const;
export type ConfigurableSeverity = (typeof CONFIGURABLE_SEVERITIES)[number];

export type AlertRule = { enabled: boolean; severity: ConfigurableSeverity };
export type AlertRules = Record<ConfigurableAlert, AlertRule>;

export const DEFAULT_ALERT_RULES: AlertRules = {
  expiring_urgent: { enabled: true, severity: "warning" },
  low_stock: { enabled: true, severity: "warning" },
  expiring_notice: { enabled: true, severity: "notice" },
  dead_stock: { enabled: true, severity: "notice" },
};

const CONFIGURABLE_SET: ReadonlySet<string> = new Set(CONFIGURABLE_ALERTS);

export function isConfigurableAlert(type: string): type is ConfigurableAlert {
  return CONFIGURABLE_SET.has(type);
}

/**
 * Reads the stored rules defensively. Whatever is missing or malformed falls
 * back to the default for that rule, and nothing stored can name a critical
 * rule or a critical severity: a row edited by hand must not be able to
 * silence expired stock.
 */
export function resolveAlertRules(stored: unknown): AlertRules {
  const rules: AlertRules = {
    expiring_urgent: { ...DEFAULT_ALERT_RULES.expiring_urgent },
    low_stock: { ...DEFAULT_ALERT_RULES.low_stock },
    expiring_notice: { ...DEFAULT_ALERT_RULES.expiring_notice },
    dead_stock: { ...DEFAULT_ALERT_RULES.dead_stock },
  };
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return rules;

  for (const type of CONFIGURABLE_ALERTS) {
    const entry = (stored as Record<string, unknown>)[type];
    if (!entry || typeof entry !== "object") continue;
    const { enabled, severity } = entry as Record<string, unknown>;
    if (typeof enabled === "boolean") rules[type].enabled = enabled;
    if (severity === "warning" || severity === "notice") rules[type].severity = severity;
  }
  return rules;
}

export type AlertRulesRefusal =
  | "invalid_days"
  | "urgent_window_too_wide"
  | "dead_stock_window_too_narrow"
  | "invalid_low_stock_point"
  | "invalid_cover_days"
  | "invalid_alert_rule";

/** The most a default minimum may be, and the longest cover that can be asked for. */
export const MAX_LOW_STOCK_POINT = 100_000;
export const MAX_COVER_DAYS = 365;

/**
 * Checks the rules that can contradict each other.
 *
 * The window check is the one that matters: an urgent window wider than the
 * notice window would fire the red alert *after* the amber one, which reads
 * as the system being broken rather than as a setting being wrong. The
 * dead-stock check is its sibling: that rule only speaks for batches no expiry
 * rule has already flagged, so a horizon inside the notice window would leave
 * it switched on and permanently silent.
 */
export function refusalToSaveAlertRules(input: {
  thresholds: Thresholds;
  rules: unknown;
}): AlertRulesRefusal | null {
  const t = input.thresholds;
  const days = [
    t.expiringUrgentDays,
    t.expiringNoticeDays,
    t.deadStockNoSaleDays,
    t.deadStockExpiryDays,
  ];
  if (days.some((value) => !Number.isInteger(value) || value < 1 || value > 3_650)) {
    return "invalid_days";
  }
  if (t.expiringUrgentDays >= t.expiringNoticeDays) return "urgent_window_too_wide";

  if (
    !Number.isInteger(t.lowStockDefaultPoint) ||
    t.lowStockDefaultPoint < 0 ||
    t.lowStockDefaultPoint > MAX_LOW_STOCK_POINT
  ) {
    return "invalid_low_stock_point";
  }
  if (
    !Number.isInteger(t.lowStockCoverDays) ||
    t.lowStockCoverDays < 0 ||
    t.lowStockCoverDays > MAX_COVER_DAYS
  ) {
    return "invalid_cover_days";
  }

  // Unlike reading, saving is strict: every rule present, nothing else, and
  // only the two severities a configurable rule may carry.
  const rules = input.rules;
  if (!rules || typeof rules !== "object" || Array.isArray(rules)) return "invalid_alert_rule";
  const keys = Object.keys(rules);
  if (keys.length !== CONFIGURABLE_ALERTS.length) return "invalid_alert_rule";
  for (const key of keys) {
    if (!isConfigurableAlert(key)) return "invalid_alert_rule";
    const entry = (rules as Record<string, unknown>)[key] as Record<string, unknown> | null;
    if (!entry || typeof entry.enabled !== "boolean") return "invalid_alert_rule";
    if (entry.severity !== "warning" && entry.severity !== "notice") return "invalid_alert_rule";
  }

  const resolved = rules as AlertRules;
  const lastExpiryWindow = resolved.expiring_notice.enabled
    ? t.expiringNoticeDays
    : resolved.expiring_urgent.enabled
      ? t.expiringUrgentDays
      : 0;
  if (resolved.dead_stock.enabled && t.deadStockExpiryDays <= lastExpiryWindow) {
    return "dead_stock_window_too_narrow";
  }
  return null;
}

export type ItemSnapshot = {
  id: string;
  reorderPoint: number;
  reorderQty: number | null;
  status: "active" | "archived";
  /** Last date this item sold, or null if it never has. */
  lastSoldOn: string | null;
  /** Units sold over the last `SALES_RATE_WINDOW_DAYS`, voids taken back out. */
  soldRecently?: number;
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

/** Each rule's severity out of the box. The two critical ones never change. */
export const SEVERITY_OF: Record<AlertType, AlertSeverity> = {
  expired_stock: "critical",
  out_of_stock: "critical",
  expiring_urgent: "warning",
  low_stock: "warning",
  expiring_notice: "notice",
  dead_stock: "notice",
};

/**
 * Critical alerts cannot be snoozed: expired stock stays on screen until it is
 * off the shelf. Decided by the rule and not by the severity stored on the
 * row, so nothing a pharmacy sets can make a critical rule snoozable -- and a
 * configurable rule can never be graded critical in the first place.
 */
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

/**
 * The minimum an item is held to: its own, or the pharmacy's default when it
 * has none. Shared with the dashboard's stock-health figure so the two cannot
 * disagree about what "low" means.
 */
export function effectiveReorderPoint(reorderPoint: number, defaultPoint: number): number {
  return reorderPoint > 0 ? reorderPoint : defaultPoint;
}

/**
 * Whole days the shelf lasts at the recent selling rate, or null when the item
 * has not sold in the window and so has no rate to divide by.
 */
export function daysOfCover(onHand: number, soldRecently: number): number | null {
  if (soldRecently <= 0) return null;
  return Math.floor((onHand * SALES_RATE_WINDOW_DAYS) / soldRecently);
}

export function computeAlerts(input: {
  today: string;
  items: readonly ItemSnapshot[];
  batches: readonly BatchSnapshot[];
  thresholds?: Partial<Thresholds>;
  /** The pharmacy's own rules; whatever is left out keeps its default. */
  rules?: Partial<AlertRules>;
}): ComputedAlert[] {
  const t = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
  const rules = { ...DEFAULT_ALERT_RULES, ...input.rules };
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
    } else if (rules.low_stock.enabled) {
      const reorderPoint = effectiveReorderPoint(item.reorderPoint, t.lowStockDefaultPoint);
      const cover = daysOfCover(onHand, item.soldRecently ?? 0);
      const belowMinimum = onHand <= reorderPoint;
      // Selling faster than the shelf can keep up with, whatever minimum was
      // typed in months ago. Only for an item that is actually selling: no
      // sales means no rate, and "runs out in infinity days" is not low.
      const runningOut = t.lowStockCoverDays > 0 && cover !== null && cover < t.lowStockCoverDays;

      if (belowMinimum || runningOut) {
        alerts.push({
          type: "low_stock",
          severity: rules.low_stock.severity,
          itemId: item.id,
          batchId: null,
          context: {
            onHand,
            reorderPoint,
            reorderQty: item.reorderQty,
            // Present whenever the selling rate says it is running out, so
            // the list can say why an item above its minimum is on it -- and
            // how long one below its minimum actually has.
            daysOfCover: runningOut ? cover : null,
          },
        });
      }
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

      // A switched-off rule hands its batches to the next one down rather than
      // dropping them: with "expiring soon" off, a batch ten days out is still
      // inside the notice window and is still worth a line.
      let flaggedExpiry = false;
      if (rules.expiring_urgent.enabled && days <= t.expiringUrgentDays) {
        flaggedExpiry = true;
        alerts.push({
          type: "expiring_urgent",
          severity: rules.expiring_urgent.severity,
          itemId: item.id,
          batchId: batch.id,
          context: {
            qty: batch.qtyRemaining, days, expiryDate: batch.expiryDate, valueAtCost: value,
          },
        });
      } else if (rules.expiring_notice.enabled && days <= t.expiringNoticeDays) {
        flaggedExpiry = true;
        alerts.push({
          type: "expiring_notice",
          severity: rules.expiring_notice.severity,
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
      if (rules.dead_stock.enabled && !flaggedExpiry && days <= t.deadStockExpiryDays) {
        const idle = item.lastSoldOn ? daysBetween(item.lastSoldOn, today) : Infinity;
        if (idle >= t.deadStockNoSaleDays) {
          alerts.push({
            type: "dead_stock",
            severity: rules.dead_stock.severity,
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
