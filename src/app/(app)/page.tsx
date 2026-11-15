import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/dal/session";
import { can } from "@/lib/auth/permissions";
import { listCategories, listItems, listSuppliers } from "@/lib/dal/catalogue";
import { alertCounts } from "@/lib/dal/alerts";
import { dailyTakings, todaysTakings } from "@/lib/dal/sales";
import { panelPending } from "@/lib/dal/panel";
import { myLayout } from "@/lib/dal/dashboard";
import { visibleWidgets } from "@/lib/dashboard/widgets";
import { Alert, Card, Chip, PageHeader, SectionHeading, Stat } from "@/components/ui";
import { SalesChart } from "@/components/SalesChart";
import { formatMoney } from "@/lib/format/money";

/**
 * The dashboard is the alert list -- by default.
 *
 * Each account has its own: the owner chooses which widgets it shows and in
 * what order (Settings > Dashboards). A layout only chooses; an account still
 * sees nothing it lacks the permission for, and data is fetched only for the
 * widgets that will be drawn.
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

  const layout = visibleWidgets(await myLayout(), session.grant);
  const shows = (key: (typeof layout)[number]) => layout.includes(key);

  const [counts, takings, series, items, categories, suppliers, panelWaiting] = await Promise.all([
    shows("alerts_summary") ? alertCounts() : Promise.resolve({} as Record<string, number>),
    shows("takings_today") ? todaysTakings() : Promise.resolve(null),
    shows("sales_chart") ? dailyTakings(30) : Promise.resolve([]),
    shows("catalogue_counts") ? listItems({ status: "active" }) : Promise.resolve([]),
    shows("catalogue_counts") ? listCategories() : Promise.resolve([]),
    shows("catalogue_counts") ? listSuppliers() : Promise.resolve([]),
    shows("panel_waiting") ? panelPending() : Promise.resolve(0),
  ]);

  const widgets: Record<(typeof layout)[number], React.ReactNode> = {
    // Orders waiting for this account's decision are the one thing on the
    // dashboard that is somebody else's work held up on this person.
    panel_waiting:
      panelWaiting > 0 ? (
        <Alert tone="warning" className="mb-6">
          {t("dashboard.panelPending", { count: panelWaiting })}{" "}
          <Link href="/panel?status=pending" className="underline">
            {t("dashboard.panelPendingOpen")}
          </Link>
        </Alert>
      ) : null,

    alerts_summary: (
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
    ),

    takings_today: (
      <section className="mb-8">
        <SectionHeading>{t("dashboard.takingsToday")}</SectionHeading>
        <Card className="p-5">
          <div className="tabular text-3xl font-semibold text-accent">
            {formatMoney(takings?.total ?? 0)}
          </div>
          <div className="mt-0.5 text-xs text-faint">
            {t("dashboard.transactionsToday", { count: takings?.count ?? 0 })}
            {(takings?.panel ?? 0) > 0 &&
              ` · ${t("dashboard.includesPanel", { amount: formatMoney(takings?.panel ?? 0) })}`}
          </div>
        </Card>
      </section>
    ),

    sales_chart: (
      <section className="mb-8">
        <SectionHeading>{t("dashboard.salesSection")}</SectionHeading>
        <Card className="p-5">
          <div className="mb-4">
            <Chip tone="accent">{t("dashboard.last30Days")}</Chip>
          </div>
          <SalesChart
            data={series}
            locale={session.user.locale}
            emptyLabel={t("dashboard.noSalesYet")}
            salesLabel={t("dashboard.salesSection")}
          />
        </Card>
      </section>
    ),

    catalogue_counts: (
      <section className="mb-8">
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
    ),
  };

  return (
    <>
      <PageHeader title={t("nav.dashboard")} subtitle={session.user.fullName} />

      {layout.map((key) => (
        <div key={key}>{widgets[key]}</div>
      ))}

      {layout.length === 0 && (
        <p className="text-sm text-muted">
          {can(session.grant, "alerts.view") ||
          can(session.grant, "items.view") ||
          can(session.grant, "sales.create")
            ? t("dashboard.emptyLayout")
            : t("account.noAccess")}
        </p>
      )}
    </>
  );
}
