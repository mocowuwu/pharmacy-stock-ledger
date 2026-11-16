import Link from "next/link";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/dal/session";
import { can } from "@/lib/auth/permissions";
import { listCategories, listItems, listSuppliers } from "@/lib/dal/catalogue";
import { alertBadge, alertCounts, listAlerts } from "@/lib/dal/alerts";
import { dailyTakings, listSales, todaysTakings } from "@/lib/dal/sales";
import { panelPending } from "@/lib/dal/panel";
import {
  DASHBOARD_DAYS,
  dashboardMoney,
  dashboardSales,
  dashboardStock,
  myLayout,
} from "@/lib/dal/dashboard";
import { layoutSpans, visibleWidgets, type WidgetKey } from "@/lib/dashboard/widgets";
import { CONFIGURABLE_ALERTS, DEFAULT_ALERT_RULES, type AlertType } from "@/lib/alerts/rules";
import { changeBps, shareBps } from "@/lib/reports/analysis";
import { Alert, Card, Chip, SectionHeading, Stat, PageHeader } from "@/components/ui";
import { SalesChart } from "@/components/SalesChart";
import { RankedBars } from "@/components/dashboard/RankedBars";
import { Sparkline } from "@/components/dashboard/Sparkline";
import { StockHealthBar } from "@/components/dashboard/StockHealthBar";
import { ExpiryChart } from "@/components/dashboard/ExpiryChart";
import { HourChart } from "./reports/_ui/HourChart";
import { KpiTile, Panel, percentFromBps } from "./reports/_ui/Figures";
import { formatMoney } from "@/lib/format/money";
import { formatDate, formatDateTime, formatExpiry } from "@/lib/format/date";

/**
 * The dashboard: what needs doing, then how the shop is doing.
 *
 * Each account has its own: the owner chooses which widgets it shows and in
 * what order (Settings > Dashboards). A layout only chooses; an account still
 * sees nothing it lacks the permission for, and data is fetched only for the
 * widgets that will be drawn -- every fetch below is behind `shows(...)`, and
 * every DAL function it calls asserts its own permission besides.
 *
 * The alert tiles come first by default. Nobody has to remember to go and
 * look, which is the whole point of persisting alerts rather than computing
 * them on demand.
 */

/** The two facts first, then the four judgements in the order the list sorts them. */
const ALERT_TILES: AlertType[] = [
  "expired_stock",
  "out_of_stock",
  "expiring_urgent",
  "low_stock",
  "expiring_notice",
  "dead_stock",
];

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export default async function DashboardPage() {
  const session = await requireSession();
  const t = await getTranslations();
  const locale = session.user.locale;
  const number = (value: number) => value.toLocaleString(locale === "id" ? "id-ID" : "en-GB");

  const layout = visibleWidgets(await myLayout(), session.grant);
  const shows = (key: WidgetKey) => layout.includes(key);

  const wantsSeries = shows("takings_today") || shows("sales_period") || shows("sales_chart");
  const wantsInsight =
    shows("busy_hours") || shows("top_products") || shows("payment_mix") || shows("cashier_sales");
  const wantsStock = shows("expiry_calendar") || shows("stock_health") || shows("alerts_summary");

  const [
    counts,
    takings,
    series,
    insight,
    stock,
    worklist,
    badge,
    recent,
    money,
    items,
    categories,
    suppliers,
    panelWaiting,
  ] = await Promise.all([
    shows("alerts_summary") ? alertCounts() : Promise.resolve({} as Record<string, number>),
    shows("takings_today") ? todaysTakings() : Promise.resolve(null),
    // Two windows in one read: the last 30 days and the 30 before them.
    wantsSeries ? dailyTakings(DASHBOARD_DAYS * 2) : Promise.resolve([]),
    wantsInsight
      ? dashboardSales({
          hours: shows("busy_hours"),
          products: shows("top_products"),
          payments: shows("payment_mix"),
          cashiers: shows("cashier_sales"),
        })
      : Promise.resolve(null),
    wantsStock
      ? dashboardStock({
          calendar: shows("expiry_calendar"),
          health: shows("stock_health"),
          rules: shows("alerts_summary"),
        })
      : Promise.resolve(null),
    shows("alerts_worklist") ? listAlerts({ limit: 6 }) : Promise.resolve([]),
    shows("alerts_worklist") ? alertBadge() : Promise.resolve(null),
    shows("recent_sales") ? listSales({ limit: 6 }) : Promise.resolve([]),
    shows("money_overview") ? dashboardMoney() : Promise.resolve(null),
    shows("catalogue_counts") ? listItems({ status: "active" }) : Promise.resolve([]),
    shows("catalogue_counts") ? listCategories() : Promise.resolve([]),
    shows("catalogue_counts") ? listSuppliers() : Promise.resolve([]),
    shows("panel_waiting") ? panelPending() : Promise.resolve(0),
  ]);

  /* ---- the two 30-day windows, cut from one series ---------------------- */

  const current = series.slice(-DASHBOARD_DAYS);
  const previous = series.slice(0, Math.max(series.length - DASHBOARD_DAYS, 0));
  const takingsOf = (days: typeof series) => sum(days.map((day) => day.total));
  const countOf = (days: typeof series) => sum(days.map((day) => day.count));
  // No trade at all in the window before is "nothing to compare with", never
  // a rise of infinity per cent.
  const orNull = (value: number, days: typeof series) => (takingsOf(days) > 0 ? value : null);
  const average = (days: typeof series) =>
    countOf(days) > 0 ? Math.round(takingsOf(days) / countOf(days)) : 0;

  const versus = (value: string) => t("reports.compare.versus", { value });
  const none = t("reports.compare.none");
  const last30 = t("dashboard.last30Days");

  const rules = stock?.rules ?? DEFAULT_ALERT_RULES;
  const isConfigurable = (type: AlertType): type is (typeof CONFIGURABLE_ALERTS)[number] =>
    (CONFIGURABLE_ALERTS as readonly string[]).includes(type);

  const todayDelta = takings ? changeBps(takings.till, takings.yesterdaySoFar) : null;
  const mayReport = can(session.grant, "reports.sales");
  const seeAll = (href: string) => (
    <Link href={href} className="shrink-0 text-xs font-medium text-accent hover:underline">
      {t("dashboard.seeAll")}
    </Link>
  );

  const widgets: Record<WidgetKey, ReactNode> = {
    // Orders waiting for this account's decision are the one thing on the
    // dashboard that is somebody else's work held up on this person.
    panel_waiting:
      panelWaiting > 0 ? (
        <Alert tone="warning">
          {t("dashboard.panelPending", { count: panelWaiting })}{" "}
          <Link href="/panel?status=pending" className="underline">
            {t("dashboard.panelPendingOpen")}
          </Link>
        </Alert>
      ) : null,

    alerts_summary: (
      <section>
        <SectionHeading>{t("dashboard.summary")}</SectionHeading>
        <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-3 @6xl:grid-cols-6">
          {ALERT_TILES.filter((type) => !isConfigurable(type) || rules[type].enabled).map((type) => {
            const count = counts[type] ?? 0;
            // A tile wears the level the pharmacy gave its rule, so amber on
            // the dashboard is amber in the list.
            const tone = isConfigurable(type) ? rules[type].severity : "critical";
            return (
              <Link key={type} href={`/alerts?type=${type}`} className="block h-full">
                <Stat
                  value={count}
                  label={t(`alertType.${type}`)}
                  tone={count === 0 ? "quiet" : tone}
                />
              </Link>
            );
          })}
        </div>
      </section>
    ),

    takings_today: (
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm font-medium text-muted">{t("dashboard.takingsToday")}</div>
            <div className="mt-2 text-[2.125rem] leading-none font-semibold tracking-[-0.03em] text-accent [overflow-wrap:anywhere] @2xl:text-[2.5rem]">
              {formatMoney(takings?.total ?? 0)}
            </div>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
              {todayDelta === null ? (
                <span className="text-faint">— {t("dashboard.noYesterday")}</span>
              ) : (
                <>
                  <span
                    className={`tabular font-semibold ${
                      todayDelta > 0 ? "text-accent" : todayDelta < 0 ? "text-critical" : "text-muted"
                    }`}
                  >
                    {todayDelta > 0 ? "▲" : todayDelta < 0 ? "▼" : "■"}{" "}
                    {percentFromBps(Math.abs(todayDelta), locale)}
                  </span>
                  <span className="text-faint">
                    {t("dashboard.vsYesterday", {
                      amount: formatMoney(takings?.yesterdaySoFar ?? 0),
                    })}
                  </span>
                </>
              )}
            </div>
          </div>
          {/* Beside the figure only where there is room for both: on a phone
              the figure needs the whole line, and the full chart is one card down. */}
          <div className="hidden shrink-0 @lg:block">
            <Sparkline values={series.slice(-14).map((day) => day.total)} />
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-rule pt-4 text-sm @2xl:grid-cols-4">
          <div>
            <dt className="text-xs text-faint">{t("reports.sales.transactions")}</dt>
            <dd className="tabular mt-0.5 font-semibold">{number(takings?.count ?? 0)}</dd>
          </div>
          <div>
            <dt className="text-xs text-faint">{t("reports.sales.averageSale")}</dt>
            <dd className="tabular mt-0.5 font-semibold">{formatMoney(takings?.average ?? 0)}</dd>
          </div>
          <div>
            <dt className="text-xs text-faint">{t("reports.sales.refunds")}</dt>
            <dd className="tabular mt-0.5 font-semibold">{formatMoney(takings?.refunds ?? 0)}</dd>
          </div>
          {(takings?.panel ?? 0) > 0 && (
            <div>
              <dt className="text-xs text-faint">{t("dashboard.panelToday")}</dt>
              <dd className="tabular mt-0.5 font-semibold">{formatMoney(takings?.panel ?? 0)}</dd>
            </div>
          )}
        </dl>
      </Card>
    ),

    sales_period: (
      <section>
        <SectionHeading>{t("dashboard.period")}</SectionHeading>
        <div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @4xl:grid-cols-4">
          <KpiTile
            label={t("dashboard.takings7")}
            value={formatMoney(takingsOf(current.slice(-7)))}
            current={takingsOf(current.slice(-7))}
            previous={orNull(takingsOf(current.slice(-14, -7)), current.slice(-14, -7))}
            previousLabel={versus(formatMoney(takingsOf(current.slice(-14, -7))))}
            noComparison={none}
            locale={locale}
          />
          <KpiTile
            emphasis
            label={t("dashboard.takings30")}
            value={formatMoney(takingsOf(current))}
            current={takingsOf(current)}
            previous={orNull(takingsOf(previous), previous)}
            previousLabel={versus(formatMoney(takingsOf(previous)))}
            noComparison={none}
            locale={locale}
          />
          <KpiTile
            label={t("reports.sales.transactions")}
            value={number(countOf(current))}
            current={countOf(current)}
            previous={orNull(countOf(previous), previous)}
            previousLabel={versus(number(countOf(previous)))}
            noComparison={none}
            hint={last30}
            locale={locale}
          />
          <KpiTile
            label={t("reports.sales.averageSale")}
            value={formatMoney(average(current))}
            current={average(current)}
            previous={orNull(average(previous), previous)}
            previousLabel={versus(formatMoney(average(previous)))}
            noComparison={none}
            hint={last30}
            locale={locale}
          />
        </div>
      </section>
    ),

    sales_chart: (
      <Panel
        title={t("reports.sales.daily")}
        note={t("dashboard.chartNote")}
        actions={mayReport ? seeAll("/reports/sales?preset=30d") : undefined}
        className="h-full"
      >
        <SalesChart
          data={current}
          previous={previous}
          locale={locale}
          emptyLabel={t("dashboard.noSalesYet")}
          salesLabel={t("reports.sales.daily")}
          labels={{
            current: last30,
            previous: t("dashboard.previous30Days"),
            transactions: t("reports.sales.transactionsShort").toLowerCase(),
          }}
        />
      </Panel>
    ),

    busy_hours: (
      <Panel title={t("reports.sales.byHour")} note={t("dashboard.busyNote")} className="h-full">
        <HourChart
          data={insight?.byHour ?? []}
          label={t("reports.sales.byHour")}
          transactionsLabel={t("reports.sales.transactionsShort").toLowerCase()}
          emptyLabel={t("dashboard.noSalesYet")}
        />
      </Panel>
    ),

    top_products: (
      <Panel
        title={t("dashboard.topProducts")}
        note={t("dashboard.topProductsNote")}
        actions={seeAll("/reports/sales?preset=30d")}
        className="h-full"
      >
        <RankedBars
          emptyLabel={t("dashboard.noSalesYet")}
          rows={(insight?.topProducts ?? []).map((row) => ({
            key: row.key,
            label: `${row.name}${row.strength ? ` ${row.strength}` : ""}`,
            detail: t("dashboard.unitsSold", { qty: number(row.qty), unit: row.unit }),
            value: row.revenue,
            display: formatMoney(row.revenue),
            href: row.itemId ? `/items/${row.itemId}` : undefined,
          }))}
        />
      </Panel>
    ),

    payment_mix: (() => {
      const rows = (insight?.byPayment ?? []).filter((row) => row.revenue > 0);
      const total = sum(rows.map((row) => row.revenue));
      return (
        <Panel title={t("dashboard.paymentMix")} note={t("dashboard.paymentMixNote")} className="h-full">
          <RankedBars
            emptyLabel={t("dashboard.noSalesYet")}
            rows={rows.map((row) => ({
              key: row.method,
              label:
                row.method === "unrecorded"
                  ? t("reports.sales.unrecordedMethod")
                  : t(`paymentMethod.${row.method}`),
              detail: `${percentFromBps(shareBps(row.revenue, total), locale)} · ${t(
                "dashboard.transactionsCount",
                { count: row.transactions },
              )}`,
              value: row.revenue,
              display: formatMoney(row.revenue),
            }))}
          />
        </Panel>
      );
    })(),

    cashier_sales: (
      <Panel title={t("reports.sales.byCashier")} note={last30} className="h-full">
        <RankedBars
          emptyLabel={t("dashboard.noSalesYet")}
          rows={(insight?.byCashier ?? [])
            .filter((row) => row.revenue > 0)
            .slice(0, 6)
            .map((row, index) => ({
              key: row.cashierId ?? (row.fromPanel ? "panel" : `history-${index}`),
              label: row.fromPanel
                ? t("panel.title")
                : row.name || t("reports.history.unknownCashier"),
              detail: row.fromPanel
                ? undefined
                : t("dashboard.transactionsCount", { count: row.transactions }),
              value: row.revenue,
              display: formatMoney(row.revenue),
            }))}
        />
      </Panel>
    ),

    expiry_calendar: (
      <Panel
        title={t("dashboard.expiry.title")}
        note={t("dashboard.expiry.note")}
        actions={seeAll("/alerts?type=expiring_urgent")}
        className="h-full"
      >
        <ExpiryChart
          months={stock?.calendar?.months ?? []}
          windows={stock?.calendar?.windows ?? { urgent: 0, notice: 0 }}
          locale={locale}
          label={t("dashboard.expiry.title")}
          emptyLabel={t("dashboard.expiry.empty")}
        />
        {(stock?.calendar?.beyond.batches ?? 0) > 0 && (
          <p className="mt-2 text-xs text-faint">
            {t("dashboard.expiry.beyond", { count: stock?.calendar?.beyond.batches ?? 0 })}
          </p>
        )}
      </Panel>
    ),

    stock_health: (() => {
      const health = stock?.health ?? { items: 0, out: 0, low: 0, healthy: 0 };
      return (
        <Panel
          title={t("dashboard.health.title")}
          note={t("dashboard.health.note", { count: health.items })}
          className="h-full"
        >
          <StockHealthBar
            total={health.items}
            shareOf={(count) => percentFromBps(shareBps(count, health.items), locale)}
            parts={[
              { key: "healthy", label: t("dashboard.health.healthy"), count: health.healthy, href: "/items" },
              { key: "low", label: t("alertType.low_stock"), count: health.low, href: "/alerts?type=low_stock" },
              { key: "out", label: t("alertType.out_of_stock"), count: health.out, href: "/alerts?type=out_of_stock" },
            ]}
          />
        </Panel>
      );
    })(),

    alerts_worklist: (
      <Panel
        title={t("dashboard.worklist.title")}
        note={t("dashboard.worklist.note", { count: badge?.total ?? 0 })}
        actions={seeAll("/alerts")}
        className="h-full"
      >
        {worklist.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">{t("alerts.none")}</p>
        ) : (
          <ul className="flex flex-col">
            {worklist.map((alert) => {
              const context = (alert.context ?? {}) as Record<string, number | string | null>;
              const qty = typeof context.qty === "number" ? context.qty : context.onHand;
              return (
                <li key={alert.id} className="border-t border-rule first:border-t-0">
                  <Link
                    href={`/alerts?type=${alert.type}`}
                    className="flex min-h-11 flex-col justify-center gap-1 py-2.5 hover:text-accent"
                  >
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Chip tone={alert.severity}>{t(`alertType.${alert.type}`)}</Chip>
                      <span className="min-w-0 text-sm font-medium">
                        {alert.itemName}
                        {alert.strength ? ` ${alert.strength}` : ""}
                      </span>
                    </span>
                    <span className="flex flex-wrap gap-x-3 text-xs text-muted">
                      {alert.lotNumber && alert.expiryDate && (
                        <span className="font-mono">
                          {alert.lotNumber} · {formatExpiry(alert.expiryDate, locale)}
                        </span>
                      )}
                      {typeof qty === "number" && (
                        <span className="tabular">
                          {t("alerts.unitsAffected", { qty, unit: alert.unit })}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    ),

    recent_sales: (
      <Panel
        title={t("dashboard.recent.title")}
        note={
          can(session.grant, "sales.view_all") ? t("dashboard.recent.all") : t("dashboard.recent.own")
        }
        actions={seeAll("/sales")}
        className="h-full"
      >
        {recent.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">{t("sales.empty")}</p>
        ) : (
          <ul className="flex flex-col">
            {recent.map((sale) => (
              <li key={sale.id} className="border-t border-rule first:border-t-0">
                <Link
                  href={`/sales/${sale.id}`}
                  className="flex min-h-11 items-center justify-between gap-3 py-2.5 hover:text-accent"
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-xs">{sale.saleNumber}</span>
                    <span className="block text-xs text-muted">
                      {formatDateTime(sale.soldAt, locale)} · {sale.cashier}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`tabular text-sm font-semibold ${
                        sale.status === "voided" ? "text-faint line-through" : ""
                      }`}
                    >
                      {formatMoney(sale.total)}
                    </span>
                    {sale.status === "voided" ? (
                      <Chip tone="critical">{t("sales.voided")}</Chip>
                    ) : (
                      <span className="text-xs text-faint">{t(`paymentMethod.${sale.paymentMethod}`)}</span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    ),

    money_overview: money ? (
      <section>
        <SectionHeading>{t("dashboard.money.title")}</SectionHeading>
        <div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @4xl:grid-cols-4">
          <KpiTile
            emphasis
            label={t("reports.margin.margin")}
            value={formatMoney(money.margin.margin)}
            current={money.margin.margin}
            previous={money.previousMargin.revenue > 0 ? money.previousMargin.margin : null}
            previousLabel={versus(formatMoney(money.previousMargin.margin))}
            noComparison={none}
            hint={last30}
            locale={locale}
          />
          <KpiTile
            label={t("dashboard.money.marginRate")}
            value={percentFromBps(money.margin.marginBps, locale)}
            current={money.margin.marginBps}
            previous={money.previousMargin.revenue > 0 ? money.previousMargin.marginBps : null}
            pointsLabel={t("reports.compare.points")}
            noComparison={none}
            hint={last30}
            locale={locale}
          />
          <KpiTile
            label={t("reports.valuation.total")}
            value={formatMoney(money.stockValue)}
            hint={t("reports.valuation.asOf", { date: formatDate(new Date(), locale) })}
            locale={locale}
          />
          <KpiTile
            label={t("dashboard.money.atRisk")}
            value={formatMoney(money.atRisk.expired.value + money.atRisk.within30.value)}
            tone={
              money.atRisk.expired.value > 0
                ? "critical"
                : money.atRisk.within30.value > 0
                  ? "warning"
                  : "quiet"
            }
            hint={t("dashboard.money.atRiskHint", {
              expired: formatMoney(money.atRisk.expired.value),
              loss: formatMoney(money.expiryLoss),
            })}
            locale={locale}
          />
        </div>
      </section>
    ) : null,

    catalogue_counts: (
      <section>
        <SectionHeading>{t("dashboard.catalogue")}</SectionHeading>
        <div className="grid grid-cols-1 gap-3 @md:grid-cols-3">
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

  // A widget with nothing to draw takes no cell, so it cannot leave a gap
  // beside a half-width neighbour.
  const placed = layoutSpans(layout.filter((key) => widgets[key] !== null));

  return (
    <>
      <PageHeader
        title={t("nav.dashboard")}
        subtitle={`${session.user.fullName} · ${formatDate(new Date(), locale)}`}
      />

      {/* Two columns where the dashboard's own box is wide enough for them --
          a container query, because beside the menu a laptop leaves this
          column not much wider than a tablet. */}
      <div className="@container">
        <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-2">
          {placed.map(({ key, wide }) => (
            <div key={key} className={`min-w-0 ${wide ? "@4xl:col-span-2" : ""}`}>
              {widgets[key]}
            </div>
          ))}
        </div>
      </div>

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
