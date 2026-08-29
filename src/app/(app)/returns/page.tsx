import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { listReturns } from "@/lib/dal/sales";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";

export default async function ReturnsPage() {
  const session = await requirePermission("sales.return");
  const t = await getTranslations();
  const locale = session.user.locale;

  const rows = await listReturns();

  return (
    <>
      <PageHeader
        title={t("returns.listTitle")}
        subtitle={t("returns.listSubtitle")}
      />

      {rows.length === 0 ? (
        <Card className="p-6">
          <EmptyState title={t("returns.noneYet")} />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-rule text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">
                  {t("dispose.number")}
                </th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">
                  {t("dispose.when")}
                </th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">
                  {t("returns.sale")}
                </th>
                <th className="px-4 py-2.5 font-medium">{t("common.reason")}</th>
                <th className="px-4 py-2.5 text-right font-medium whitespace-nowrap">
                  {t("returns.refund")}
                </th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">
                  {t("returns.processedBy")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-rule/60 last:border-0">
                  <td className="tabular px-4 py-3 font-medium whitespace-nowrap">
                    {row.returnNumber}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted">
                    {formatDateTime(row.returnedAt, locale)}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Link
                      href={`/sales/${row.saleId}`}
                      className="tabular text-accent hover:underline"
                    >
                      {row.saleNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{row.reason}</td>
                  <td className="tabular px-4 py-3 text-right whitespace-nowrap">
                    {formatMoney(row.refundTotal)}
                    <div className="text-xs text-faint">
                      {t(`paymentMethod.${row.refundMethod}`)}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted">
                    {row.processedBy}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}
