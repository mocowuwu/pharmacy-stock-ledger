import { getTranslations } from "next-intl/server";
import { batchesForItem, movementsForItem } from "@/lib/dal/stock";
import { Card, Chip } from "@/components/ui";
import { daysUntilExpiry, formatDateTime, formatExpiry } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";
import type { Locale } from "@/i18n/config";

/**
 * Expiry urgency, using the same thresholds the alerts will. Encoding it in the
 * chip means a shelf-life problem is visible while looking at the item, not
 * only once an alert has been generated overnight.
 */
function expiryTone(days: number): "critical" | "warning" | "notice" | "neutral" {
  if (days < 0) return "critical";
  if (days <= 30) return "warning";
  if (days <= 90) return "notice";
  return "neutral";
}

export async function StockPanel({
  itemId,
  unit,
  locale,
  canSeeCost,
}: {
  itemId: string;
  unit: string;
  locale: Locale;
  canSeeCost: boolean;
}) {
  const t = await getTranslations();
  const [batches, movements] = await Promise.all([
    batchesForItem(itemId),
    movementsForItem(itemId, 50),
  ]);

  const onHand = batches
    .filter((b) => b.status === "active")
    .reduce((sum, b) => sum + b.qtyRemaining, 0);

  return (
    <div className="flex flex-col gap-6">
      <Card className="p-5">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="font-medium">{t("stock.batches")}</h2>
          <span className="tabular text-2xl font-semibold">
            {t("stock.totalUnits", { count: onHand, unit })}
          </span>
        </div>

        {batches.length === 0 ? (
          <p className="text-sm text-muted">{t("stock.noBatches")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-rule text-left text-xs uppercase tracking-wide text-faint">
                  <th className="whitespace-nowrap py-2 pr-3 font-medium">{t("receive.lot")}</th>
                  <th className="whitespace-nowrap py-2 pr-3 font-medium">{t("receive.expiry")}</th>
                  <th className="whitespace-nowrap py-2 pr-3 text-right font-medium">{t("stock.remaining")}</th>
                  <th className="whitespace-nowrap py-2 pr-3 text-right font-medium">{t("stock.received")}</th>
                  {canSeeCost && (
                    <th className="whitespace-nowrap py-2 pr-3 text-right font-medium">{t("stock.cost")}</th>
                  )}
                  <th className="whitespace-nowrap py-2 pr-3 font-medium">{t("stock.supplier")}</th>
                  <th className="whitespace-nowrap py-2 font-medium">{t("common.status")}</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => {
                  const days = daysUntilExpiry(batch.expiryDate);
                  const tone = expiryTone(days);
                  return (
                    <tr key={batch.id} className="border-b border-rule last:border-0">
                      <td className="py-2 pr-3 font-mono text-xs">
                        {batch.lotNumber ?? (
                          <span className="text-faint">{t("stock.legacyLot")}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="tabular">{formatExpiry(batch.expiryDate, locale)}</div>
                        <div className="mt-0.5">
                          <Chip tone={tone}>
                            {days < 0
                              ? t("stock.expiredDaysAgo", { days: Math.abs(days) })
                              : days === 0
                                ? t("stock.expiresToday")
                                : t("stock.expiresInDays", { days })}
                          </Chip>
                        </div>
                      </td>
                      <td className="tabular py-2 pr-3 text-right font-medium">
                        {batch.qtyRemaining}
                      </td>
                      <td className="tabular py-2 pr-3 text-right text-muted">
                        {batch.qtyReceived}
                      </td>
                      {canSeeCost && (
                        <td className="tabular py-2 pr-3 text-right text-muted">
                          {formatMoney(batch.unitCost)}
                        </td>
                      )}
                      <td className="py-2 pr-3 text-xs text-muted">{batch.supplierName}</td>
                      <td className="py-2 text-xs">
                        <Chip tone={batch.status === "active" ? "accent" : "neutral"}>
                          {t(`batchStatus.${batch.status}`)}
                        </Chip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="mb-3 font-medium">{t("stock.movements")}</h2>
        {movements.length === 0 ? (
          <p className="text-sm text-muted">{t("stock.noMovements")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-rule text-left text-xs uppercase tracking-wide text-faint">
                  <th className="whitespace-nowrap py-2 pr-3 font-medium">{t("stock.when")}</th>
                  <th className="whitespace-nowrap py-2 pr-3 font-medium">{t("common.actions")}</th>
                  <th className="whitespace-nowrap py-2 pr-3 text-right font-medium">{t("stock.change")}</th>
                  <th className="whitespace-nowrap py-2 pr-3 font-medium">{t("receive.lot")}</th>
                  <th className="whitespace-nowrap py-2 font-medium">{t("stock.who")}</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-b border-rule last:border-0">
                    <td className="tabular py-2 pr-3 text-xs text-muted">
                      {formatDateTime(m.createdAt, locale)}
                    </td>
                    <td className="py-2 pr-3">
                      {t(`movementType.${m.type}`)}
                      {m.reason && (
                        <div className="text-xs text-faint">{m.reason}</div>
                      )}
                    </td>
                    <td
                      className={`tabular py-2 pr-3 text-right font-medium ${
                        m.qtyDelta > 0 ? "text-accent" : "text-critical"
                      }`}
                    >
                      {m.qtyDelta > 0 ? `+${m.qtyDelta}` : m.qtyDelta}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs text-muted">
                      {m.lotNumber ?? "—"}
                    </td>
                    <td className="py-2 text-xs text-muted">{m.performedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
