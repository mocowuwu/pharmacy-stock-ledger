import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import {
  disposableBatches,
  listDisposals,
  recentDisposalLoss,
} from "@/lib/dal/disposal";
import {
  Alert,
  Card,
  Chip,
  DrugClassMark,
  EmptyState,
  PageHeader,
  SectionHeading,
} from "@/components/ui";
import { formatDateTime, formatExpiry, isExpired } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";

export default async function DisposePage({ searchParams }: PageProps<"/dispose">) {
  const session = await requirePermission("stock.dispose");
  const t = await getTranslations();
  const params = await searchParams;
  const locale = session.user.locale;

  const queue = await disposableBatches();
  const history = await listDisposals(50);
  const recentLoss = await recentDisposalLoss(30);

  return (
    <>
      <PageHeader title={t("dispose.title")} subtitle={t("dispose.subtitle")} />

      <div className="mb-4 flex flex-col gap-3">
        {typeof params.done === "string" && (
          <Alert tone="notice">
            {t("dispose.saved", {
              number: params.done,
              count: String(params.qty ?? ""),
              unit: String(params.unit ?? ""),
              item: String(params.item ?? ""),
            })}
          </Alert>
        )}
        {typeof params.error === "string" && (
          <Alert>{t(`errors.${params.error}`)}</Alert>
        )}
      </div>

      <SectionHeading>{t("dispose.queue")}</SectionHeading>

      {queue.length === 0 ? (
        <Card className="p-6">
          <EmptyState title={t("dispose.queueEmpty")} />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-rule text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t("sell.item")}</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">
                  {t("dispose.batch")}
                </th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">
                  {t("common.status")}
                </th>
                <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap">
                  {t("dispose.onHand")}
                </th>
                <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap">
                  {t("dispose.costValue")}
                </th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {queue.map((batch) => (
                <tr key={batch.id} className="border-b border-rule/60 last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      href={`/items/${batch.itemId}`}
                      className="font-medium hover:text-accent"
                    >
                      <DrugClassMark
                        drugClass={batch.drugClass}
                        label={`${batch.genericName}${batch.strength ? ` ${batch.strength}` : ""}`}
                      />
                    </Link>
                    <div className="font-mono text-xs text-faint">{batch.code}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="font-mono text-xs">{batch.lotNumber ?? "—"}</div>
                    <div className="text-xs text-faint">
                      {formatExpiry(batch.expiryDate, locale)}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {isExpired(batch.expiryDate) ? (
                      <Chip tone="critical">{t("dispose.expired")}</Chip>
                    ) : (
                      <Chip tone="warning">{t("dispose.quarantinedStock")}</Chip>
                    )}
                  </td>
                  <td className="tabular px-4 py-3 text-right whitespace-nowrap">
                    {batch.qtyRemaining} {batch.unit}
                  </td>
                  <td className="tabular px-4 py-3 text-right whitespace-nowrap text-muted">
                    {formatMoney(batch.qtyRemaining * batch.unitCost)}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Link
                      href={`/dispose/${batch.id}`}
                      className="rounded border border-rule px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-accent"
                    >
                      {t("dispose.disposeThis")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <div className="mt-8">
        <SectionHeading>{t("dispose.history")}</SectionHeading>

        {history.length === 0 ? (
          <Card className="p-6">
            <EmptyState title={t("dispose.historyEmpty")} />
          </Card>
        ) : (
          <>
            <p className="mb-3 text-sm text-muted">
              {t("dispose.totalLoss")}:{" "}
              <span className="tabular font-medium text-foreground">
                {formatMoney(recentLoss.value)}
              </span>
            </p>
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="border-b border-rule text-left text-xs text-muted">
                  <tr>
                    <th className="px-4 py-2.5 font-medium whitespace-nowrap">
                      {t("dispose.number")}
                    </th>
                    <th className="px-4 py-2.5 font-medium whitespace-nowrap">
                      {t("dispose.when")}
                    </th>
                    <th className="px-4 py-2.5 font-medium">{t("sell.item")}</th>
                    <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap">
                      {t("common.quantity")}
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap">
                      {t("dispose.costValue")}
                    </th>
                    <th className="px-4 py-2.5 font-medium">{t("common.reason")}</th>
                    <th className="px-4 py-2.5 font-medium whitespace-nowrap">
                      {t("dispose.who")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => (
                    <tr key={row.id} className="border-b border-rule/60 last:border-0">
                      <td className="tabular px-4 py-3 font-medium whitespace-nowrap">
                        {row.disposalNumber}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted">
                        {formatDateTime(row.disposedAt, locale)}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/items/${row.itemId}`}
                          className="hover:text-accent"
                        >
                          {row.genericName}
                          {row.strength ? ` ${row.strength}` : ""}
                        </Link>
                        <div className="font-mono text-xs text-faint">
                          {row.lotNumber ?? "—"} ·{" "}
                          {formatExpiry(row.expiryDate, locale)}
                        </div>
                      </td>
                      <td className="tabular px-4 py-3 text-right whitespace-nowrap">
                        {row.qty} {row.unit}
                      </td>
                      <td className="tabular px-4 py-3 text-right whitespace-nowrap">
                        {formatMoney(row.costValue)}
                      </td>
                      <td className="px-4 py-3">
                        {row.reason}
                        {row.method && (
                          <div className="text-xs text-faint">{row.method}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-muted">
                        {row.disposedBy}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
