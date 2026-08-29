import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { listSales } from "@/lib/dal/sales";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";

export default async function SalesPage() {
  const session = await requirePermission("sales.create");
  const t = await getTranslations();
  const sales = await listSales({ limit: 100 });

  return (
    <>
      <PageHeader title={t("sales.title")} subtitle={t("sales.subtitle")} />

      {sales.length === 0 ? (
        <EmptyState title={t("sales.empty")} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-rule bg-surface-2 text-left text-xs uppercase tracking-wide text-faint">
                <th className="whitespace-nowrap px-3 py-2 font-medium">{t("sales.number")}</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">{t("sales.when")}</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">{t("sales.cashier")}</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">{t("sales.method")}</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">{t("sales.total")}</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">{t("sales.status")}</th>
              </tr>
            </thead>
            <tbody>
              {sales.map((sale) => (
                <tr key={sale.id} className="border-b border-rule last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link href={`/sales/${sale.id}`} className="hover:text-accent">
                      {sale.saleNumber}
                    </Link>
                  </td>
                  <td className="tabular px-3 py-2 text-xs text-muted">
                    {formatDateTime(sale.soldAt, session.user.locale)}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">{sale.cashier}</td>
                  <td className="px-3 py-2 text-xs">
                    {t(`paymentMethod.${sale.paymentMethod}`)}
                  </td>
                  <td
                    className={`tabular px-3 py-2 text-right font-medium ${
                      sale.status === "voided" ? "text-faint line-through" : ""
                    }`}
                  >
                    {formatMoney(sale.total)}
                  </td>
                  <td className="px-3 py-2">
                    <Chip tone={sale.status === "voided" ? "critical" : "accent"}>
                      {t(`sales.${sale.status}`)}
                    </Chip>
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
