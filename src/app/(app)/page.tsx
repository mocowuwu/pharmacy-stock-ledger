import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/dal/session";
import { can } from "@/lib/auth/permissions";
import { listCategories, listItems, listSuppliers } from "@/lib/dal/catalogue";
import { alertCounts } from "@/lib/dal/alerts";
import { dailyTakings, todaysTakings } from "@/lib/dal/sales";
import { Card, PageHeader, SectionHeading, Stat } from "@/components/ui";
import { SalesChart } from "@/components/SalesChart";
import { formatMoney } from "@/lib/format/money";

/**
 * The dashboard is the alert list.
 *
 * Four tiles for the two critical rules and the two warnings, each opening the
 * filtered list. Nobody has to remember to go and look, which is the whole
 * point of persisting alerts rather than computing them on demand.
 */
const TILES = [
  { type: "expired_stock", tone: "critical" },
  { type: "out_of_stock", tone: "critical" },
  { type: "expiring_urgent", tone: "warning" },
  { type: "low_stock", tone: "warning" },
] as const;

export default async function DashboardPage() {
  const session = await requireSession();
  const t = await getTranslations();

  const mayViewAlerts = can(session.grant, "alerts.view");
  const maySell = can(session.grant, "sales.create");
  const mayViewItems = can(session.grant, "items.view");

  const [counts, takings, series, items, categories, suppliers] = await Promise.all([
    mayViewAlerts ? alertCounts() : Promise.resolve({} as Record<string, number>),
    maySell ? todaysTakings() : Promise.resolve(null),
    maySell ? dailyTakings(30) : Promise.resolve([]),
    mayViewItems ? listItems({ status: "active" }) : Promise.resolve([]),
    mayViewItems ? listCategories() : Promise.resolve([]),
    mayViewItems ? listSuppliers() : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader title={t("nav.dashboard")} subtitle={session.user.fullName} />

      {mayViewAlerts && (
        <section className="mb-8">
          <SectionHeading>{t("dashboard.summary")}</SectionHeading>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TILES.map((tile) => {
              const count = counts[tile.type] ?? 0;
              return (
                <Link key={tile.type} href={`/alerts?type=${tile.type}`} className="block">
                  <Stat
                    value={count}
                    label={t(`alertType.${tile.type}`)}
                    tone={count === 0 ? "quiet" : tile.tone}
                  />
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {maySell && (
        <section className="mb-8">
          <SectionHeading>{t("dashboard.salesSection")}</SectionHeading>
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="text-sm text-muted">{t("dashboard.takingsToday")}</div>
                <div className="tabular mt-1 text-3xl font-semibold">
                  {formatMoney(takings?.total ?? 0)}
                </div>
                <div className="mt-0.5 text-xs text-faint">
                  {t("dashboard.transactionsToday", { count: takings?.count ?? 0 })}
                </div>
              </div>
              <span className="rounded-full border border-rule px-3 py-1 text-xs text-muted">
                {t("dashboard.last30Days")}
              </span>
            </div>

            <SalesChart
              data={series}
              locale={session.user.locale}
              emptyLabel={t("dashboard.noSalesYet")}
              salesLabel={t("dashboard.salesSection")}
            />
          </Card>
        </section>
      )}

      {mayViewItems && (
        <section>
          <SectionHeading>{t("dashboard.catalogue")}</SectionHeading>
          <div className="grid gap-4 sm:grid-cols-3">
            <Link href="/items" className="block">
              <Stat value={items.length} label={t("items.title")} />
            </Link>
            <Link href="/categories" className="block">
              <Stat value={categories.length} label={t("categories.title")} />
            </Link>
            <Link href="/suppliers" className="block">
              <Stat value={suppliers.length} label={t("suppliers.title")} />
            </Link>
          </div>
        </section>
      )}

      {!mayViewAlerts && !mayViewItems && !maySell && (
        <p className="text-sm text-muted">{t("account.noAccess")}</p>
      )}
    </>
  );
}
