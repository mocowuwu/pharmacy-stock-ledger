import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/dal/session";
import { reportsOverview } from "@/lib/dal/reports";
import { can } from "@/lib/auth/permissions";
import {
  REPORT_GROUP,
  REPORT_ICON,
  REPORTS,
  REPORT_PERMISSION,
  resolveRange,
} from "@/lib/reports/catalogue";
import { Card, PageHeader, SectionHeading, buttonSecondary } from "@/components/ui";
import { NavIcon } from "@/components/Sidebar";
import { SalesChart } from "@/components/SalesChart";
import { formatDate } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";
import { RangePicker } from "./RangePicker";
import { KpiTile, Panel, percentFromBps } from "./_ui/Figures";

/**
 * The reports home: the period's headline figures against the period before,
 * the trend, and every report the signed-in user may open.
 *
 * Only the reports the user may actually open are listed -- a locked card
 * that refuses on click would be worse than no card -- and the headline
 * figures follow the same split: a manager without `reports.financial` sees
 * sales, and no profit figure at all.
 */
export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const session = await requireSession();
  const t = await getTranslations();
  const params = await searchParams;
  const locale = session.user.locale;

  const available = REPORTS.filter((slug) => can(session.grant, REPORT_PERMISSION[slug]));
  if (available.length === 0) notFound();

  const range = resolveRange({
    preset: typeof params.preset === "string" ? params.preset : undefined,
    from: typeof params.from === "string" ? params.from : undefined,
    to: typeof params.to === "string" ? params.to : undefined,
  });
  const query =
    range.preset === "custom" ? `?from=${range.from}&to=${range.to}` : `?preset=${range.preset}`;

  const access = {
    sales: can(session.grant, "reports.sales"),
    financial: can(session.grant, "reports.financial"),
  };
  const overview = await reportsOverview(range, access);
  // Not behind the Settings "import" switch: that one is the catalogue's
  // Import button, and this entry is how the owner finds the history import at
  // all. The permission is the control either way.
  const canImport = can(session.grant, "sales.import_history");

  const previous = `${formatDate(overview.previousRange.from, locale)} — ${formatDate(overview.previousRange.to, locale)}`;
  const versus = (value: string) => t("reports.compare.versus", { value });
  const none = t("reports.compare.none");
  const sales = overview.sales;
  const money = overview.financial;

  return (
    <>
      <PageHeader
        title={t("reports.title")}
        subtitle={`${formatDate(range.from, locale)} — ${formatDate(range.to, locale)}`}
        actions={
          canImport ? (
            <Link href="/reports/import" className={buttonSecondary}>
              <NavIcon name="import" />
              {t("reports.importHistory")}
            </Link>
          ) : undefined
        }
      />

      <RangePicker
        basePath="/reports"
        preset={range.preset}
        from={range.from}
        to={range.to}
        comparedWith={previous}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {sales && (
          <>
            <KpiTile
              emphasis
              label={t("reports.sales.net")}
              value={formatMoney(sales.summary.net)}
              current={sales.summary.net}
              previous={sales.previousSummary.net}
              previousLabel={versus(formatMoney(sales.previousSummary.net))}
              noComparison={none}
              locale={locale}
            />
            <KpiTile
              label={t("reports.sales.transactions")}
              value={sales.summary.transactions.toLocaleString("id-ID")}
              current={sales.summary.transactions}
              previous={sales.previousSummary.transactions}
              previousLabel={versus(sales.previousSummary.transactions.toLocaleString("id-ID"))}
              noComparison={none}
              locale={locale}
            />
          </>
        )}
        {money && (
          <>
            <KpiTile
              label={t("reports.margin.margin")}
              value={formatMoney(money.margin.margin)}
              current={money.margin.margin}
              previous={money.previousMargin.margin}
              previousLabel={versus(formatMoney(money.previousMargin.margin))}
              noComparison={none}
              hint={t("reports.overviewMarginHint", {
                percent: percentFromBps(money.margin.marginBps, locale),
              })}
              locale={locale}
            />
            <KpiTile
              label={t("reports.valuation.total")}
              value={formatMoney(money.stockValue)}
              hint={t("reports.valuation.asOf", { date: formatDate(new Date(), locale) })}
              locale={locale}
            />
          </>
        )}
        {sales && !money && (
          <>
            <KpiTile
              label={t("reports.sales.averageSale")}
              value={formatMoney(sales.summary.averageSale)}
              current={sales.summary.averageSale}
              previous={sales.previousSummary.averageSale}
              previousLabel={versus(formatMoney(sales.previousSummary.averageSale))}
              noComparison={none}
              locale={locale}
            />
            <KpiTile
              label={t("reports.sales.units")}
              value={sales.summary.units.toLocaleString("id-ID")}
              current={sales.summary.units}
              previous={sales.previousSummary.units}
              previousLabel={versus(sales.previousSummary.units.toLocaleString("id-ID"))}
              noComparison={none}
              locale={locale}
            />
          </>
        )}
      </div>

      {sales && (
        <Panel title={t("reports.sales.daily")} note={t("reports.sales.dailyNote")} className="mb-8">
          <SalesChart
            data={sales.daily}
            previous={sales.previousDaily}
            locale={locale}
            emptyLabel={t("reports.noData")}
            salesLabel={t("reports.sales.daily")}
            labels={{
              current: t("reports.compare.thisPeriod"),
              previous: t("reports.compare.previousPeriod", { period: previous }),
              transactions: t("reports.sales.transactionsShort"),
            }}
          />
          {money && money.expiryLoss > 0 && (
            <p className="mt-3 border-t border-rule pt-3 text-xs text-muted">
              {t("reports.overviewExpiryLoss", { value: formatMoney(money.expiryLoss) })}
            </p>
          )}
        </Panel>
      )}

      {(["selling", "money"] as const).map((group) => {
        const slugs = available.filter((slug) => REPORT_GROUP[slug] === group);
        if (slugs.length === 0) return null;
        return (
          <section key={group} className="mb-8">
            <SectionHeading>{t(`reports.groups.${group}`)}</SectionHeading>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {slugs.map((slug) => (
                <Link key={slug} href={`/reports/${slug}${query}`} data-tour="report-card" className="group">
                  <Card className="flex h-full gap-4 px-5 py-4 transition-colors group-hover:border-accent">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                      <NavIcon name={REPORT_ICON[slug]} />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium group-hover:text-accent">
                        {t(`reports.nav.${slug}`)}
                      </span>
                      <span className="mt-1 block text-sm text-muted">{t(`reports.blurb.${slug}`)}</span>
                    </span>
                  </Card>
                </Link>
              ))}
              {group === "selling" && canImport && (
                <Link href="/reports/import" className="group">
                  <Card className="flex h-full gap-4 border-dashed px-5 py-4 transition-colors group-hover:border-accent">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted group-hover:text-accent">
                      <NavIcon name="import" />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium group-hover:text-accent">
                        {t("reports.importHistory")}
                      </span>
                      <span className="mt-1 block text-sm text-muted">{t("reports.importHistoryBlurb")}</span>
                    </span>
                  </Card>
                </Link>
              )}
            </div>
          </section>
        );
      })}
    </>
  );
}
