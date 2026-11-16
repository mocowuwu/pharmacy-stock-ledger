import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { settings } from "@/db/schema";
import {
  DEFAULT_THRESHOLDS,
  refusalToSaveAlertRules,
  resolveAlertRules,
  type AlertRules,
  type AlertRulesRefusal,
  type Thresholds,
} from "./rules";

/**
 * The pharmacy's own alert rules: what counts as expiring soon, as running
 * low, as not moving, and which of those are worth a line at all.
 *
 * Against an executor and with no session -- `src/lib/dal/alerts.ts` adds the
 * permission and the audit -- so the refusals can be tested on a real database.
 * The values live on the single settings row, but nothing that saves the rest
 * of that row writes these columns.
 */

export type AlertConfig = { thresholds: Thresholds; rules: AlertRules };

export class AlertConfigError extends Error {
  constructor(readonly code: AlertRulesRefusal) {
    super(code);
    this.name = "AlertConfigError";
  }
}

export async function readAlertConfig(ex: Database): Promise<AlertConfig> {
  const [row] = await ex
    .select({
      expiringUrgentDays: settings.expiringUrgentDays,
      expiringNoticeDays: settings.expiringNoticeDays,
      deadStockNoSaleDays: settings.deadStockNoSaleDays,
      deadStockExpiryDays: settings.deadStockExpiryDays,
      lowStockDefaultPoint: settings.lowStockDefaultPoint,
      lowStockCoverDays: settings.lowStockCoverDays,
      alertRules: settings.alertRules,
    })
    .from(settings)
    .where(eq(settings.id, 1));

  if (!row) return { thresholds: { ...DEFAULT_THRESHOLDS }, rules: resolveAlertRules(null) };
  const { alertRules, ...thresholds } = row;
  return { thresholds, rules: resolveAlertRules(alertRules) };
}

/**
 * Stores the rules, or refuses them whole. Returns what was there before, for
 * the audit entry.
 */
export async function saveAlertConfig(
  ex: Database,
  actorId: string,
  input: { thresholds: Thresholds; rules: unknown },
): Promise<{ before: AlertConfig; after: AlertConfig }> {
  const refusal = refusalToSaveAlertRules(input);
  if (refusal) throw new AlertConfigError(refusal);

  const before = await readAlertConfig(ex);
  // Through the reader, so what is stored is exactly the four known rules.
  const rules = resolveAlertRules(input.rules);

  await ex
    .update(settings)
    .set({
      ...input.thresholds,
      alertRules: rules,
      updatedBy: actorId,
      updatedAt: new Date(),
    })
    .where(eq(settings.id, 1));

  return { before, after: { thresholds: { ...input.thresholds }, rules } };
}
