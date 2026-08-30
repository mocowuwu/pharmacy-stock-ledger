import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { can } from "@/lib/auth/permissions";
import { listAlerts } from "@/lib/dal/alerts";
import { canSnooze, type AlertType } from "@/lib/alerts/rules";
import { Alert, Card, Chip, EmptyState, PageHeader, buttonSecondary, buttonSecondarySmall, inputBase } from "@/components/ui";
import { daysBetween, formatDate, formatExpiry, today } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";
import { acknowledge, refresh, snooze } from "./actions";

const TYPES: AlertType[] = [
  "expired_stock", "out_of_stock", "expiring_urgent",
  "low_stock", "expiring_notice", "dead_stock",
];

const TONE = {
  critical: "critical",
  warning: "warning",
  notice: "notice",
} as const;

export default async function AlertsPage({ searchParams }: PageProps<"/alerts">) {
  const session = await requirePermission("alerts.view");
  const t = await getTranslations();
  const params = await searchParams;
  const locale = session.user.locale;

  const typeFilter =
    typeof params.type === "string" && TYPES.includes(params.type as AlertType)
      ? (params.type as AlertType)
      : undefined;

  const alerts = await listAlerts({ type: typeFilter });
  const mayManage = can(session.grant, "alerts.manage");

  return (
    <>
      <PageHeader
        title={t("alerts.title")}
        subtitle={t("alerts.subtitle")}
        actions={
          <form action={refresh}>
            <button
              type="submit"
              className={buttonSecondarySmall}
            >
              {t("alerts.refresh")}
            </button>
          </form>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        {params.refreshed && <Alert tone="notice">{t("alerts.refreshed")}</Alert>}
        {typeof params.error === "string" && <Alert>{t(`errors.${params.error}`)}</Alert>}
      </div>

      <form method="get" className="mb-4 flex flex-wrap gap-2">
        <select name="type" defaultValue={typeFilter ?? ""} className={`${inputBase} w-auto`}>
          <option value="">{t("alerts.allTypes")}</option>
          {TYPES.map((type) => (
            <option key={type} value={type}>{t(`alertType.${type}`)}</option>
          ))}
        </select>
        <button
          type="submit"
          className={buttonSecondary}
        >
          {t("common.search")}
        </button>
      </form>

      {alerts.length === 0 ? (
        <EmptyState title={t("alerts.none")} />
      ) : (
        <div className="flex flex-col gap-3">
          {alerts.map((alert) => {
            const context = (alert.context ?? {}) as Record<string, number | string | null>;
            const age = daysBetween(
              alert.firstSeenAt.toISOString().slice(0, 10),
              today(),
            );
            const dimmed = alert.status === "acknowledged";

            return (
              <Card
                key={alert.id}
                className={`p-4 ${dimmed ? "opacity-60" : ""}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone={TONE[alert.severity]}>
                        {t(`alertType.${alert.type}`)}
                      </Chip>
                      <Link
                        href={`/items/${alert.itemId}`}
                        className="font-medium hover:text-accent"
                      >
                        {alert.itemName}
                        {alert.strength ? ` ${alert.strength}` : ""}
                      </Link>
                      <span className="font-mono text-xs text-faint">{alert.itemCode}</span>
                    </div>

                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                      <span>
                        {age > 0 ? t("alerts.since", { days: age }) : t("alerts.sinceToday")}
                      </span>

                      {alert.lotNumber && alert.expiryDate && (
                        <span className="font-mono">
                          {alert.lotNumber} · {formatExpiry(alert.expiryDate, locale)}
                        </span>
                      )}

                      {typeof context.qty === "number" && (
                        <span className="tabular">
                          {t("alerts.unitsAffected", {
                            qty: context.qty, unit: alert.unit,
                          })}
                        </span>
                      )}

                      {typeof context.onHand === "number" && (
                        <span className="tabular">
                          {t("alerts.unitsAffected", {
                            qty: context.onHand, unit: alert.unit,
                          })}
                          {typeof context.reorderPoint === "number"
                            ? ` / ${context.reorderPoint}`
                            : ""}
                        </span>
                      )}

                      {typeof context.valueAtCost === "number" && context.valueAtCost > 0 && (
                        <span className="tabular">
                          {t("alerts.valueAtRisk", {
                            value: formatMoney(context.valueAtCost),
                          })}
                        </span>
                      )}

                      {typeof context.expiredUnits === "number" && context.expiredUnits > 0 && (
                        <span className="text-critical">
                          {t("alerts.expiredUnitsOnShelf", { qty: context.expiredUnits })}
                        </span>
                      )}

                      {typeof context.reorderQty === "number" && context.reorderQty > 0 && (
                        <span className="tabular">
                          {t("alerts.reorderSuggestion", { qty: context.reorderQty })}
                        </span>
                      )}

                      {alert.type === "dead_stock" && (
                        <span>
                          {context.lastSoldOn
                            ? t("alerts.lastSold", {
                                days: daysBetween(String(context.lastSoldOn), today()),
                              })
                            : t("alerts.neverSold")}
                        </span>
                      )}
                    </div>

                    {alert.acknowledgedAt && alert.acknowledgedBy && (
                      <p className="mt-1 text-xs text-accent">
                        {t("alerts.acknowledged", { name: alert.acknowledgedBy })}
                      </p>
                    )}
                    {alert.snoozedUntil && (
                      <p className="mt-1 text-xs text-faint">
                        {t("alerts.snoozedUntil", {
                          date: formatDate(alert.snoozedUntil, locale),
                        })}
                      </p>
                    )}
                  </div>

                  {mayManage && (
                    <div className="flex shrink-0 items-center gap-2">
                      {alert.status !== "acknowledged" && (
                        <form action={acknowledge}>
                          <input type="hidden" name="alertId" value={alert.id} />
                          <button
                            type="submit"
                            className={buttonSecondarySmall}
                          >
                            {t("alerts.acknowledge")}
                          </button>
                        </form>
                      )}

                      {/* Critical alerts have no snooze at all: expired stock
                          stays on screen until it is off the shelf. */}
                      {canSnooze(alert.type as AlertType) && (
                        <form action={snooze}>
                          <input type="hidden" name="alertId" value={alert.id} />
                          <input type="hidden" name="days" value="7" />
                          <button
                            type="submit"
                            className={buttonSecondarySmall}
                          >
                            {t("alerts.snooze")} · {t("alerts.snoozeDays", { days: 7 })}
                          </button>
                        </form>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
