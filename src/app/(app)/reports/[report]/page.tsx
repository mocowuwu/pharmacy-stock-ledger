import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { getSettings } from "@/lib/dal/settings";
import { can } from "@/lib/auth/permissions";
import {
  isReportSlug,
  previousRange,
  REPORTS,
  REPORT_ICON,
  REPORT_PERMISSION,
  resolveRange,
  type ReportSlug,
} from "@/lib/reports/catalogue";
import { PageHeader } from "@/components/ui";
import { NavIcon } from "@/components/Sidebar";
import { formatDate, formatDateTime } from "@/lib/format/date";
import { isUuid } from "@/lib/format/ids";
import { PrintLetterhead, RangePicker, ReportActions } from "../RangePicker";
import { SalesReport } from "../_reports/Sales";
import { MovementsReport } from "../_reports/Movements";
import { MarginReport } from "../_reports/Margin";
import { ValuationReport } from "../_reports/Valuation";
import { ExpiryReport } from "../_reports/Expiry";
import { SuppliersReport } from "../_reports/Suppliers";

/** Reports that compare their window with the one before. */
const COMPARES: ReadonlySet<ReportSlug> = new Set(["sales", "margin"]);

/**
 * One route for all six reports.
 *
 * They share a period, a header, the exports and the printed letterhead, and
 * differ only in their body, so six near-identical page files would be six
 * places to change the date picker. The slug is validated against the union
 * before anything is read.
 */
export default async function ReportPage({
  params,
  searchParams,
}: PageProps<"/reports/[report]">) {
  const { report } = await params;
  if (!isReportSlug(report)) notFound();

  const session = await requirePermission(REPORT_PERMISSION[report]);
  const t = await getTranslations();
  const query = await searchParams;
  const locale = session.user.locale;
  const settings = await getSettings();

  const range = resolveRange({
    preset: typeof query.preset === "string" ? query.preset : undefined,
    from: typeof query.from === "string" ? query.from : undefined,
    to: typeof query.to === "string" ? query.to : undefined,
  });
  // A malformed product in the URL is no filter at all, not a server error.
  const itemId = isUuid(query.item) ? query.item : undefined;

  // Valuation is a snapshot of the shelf now, so a period would be a lie.
  const dated = report !== "valuation";
  const siblings = REPORTS.filter((slug) => can(session.grant, REPORT_PERMISSION[slug]));
  const period = `${formatDate(range.from, locale)} — ${formatDate(range.to, locale)}`;
  const previous = previousRange(range);
  const periodQuery =
    range.preset === "custom" ? `from=${range.from}&to=${range.to}` : `preset=${range.preset}`;

  return (
    <>
      {/* The page's own paper size: A4, where receipts print on a roll. Later
          in the document than the global receipt rule, so it wins here. */}
      <style>{`@media print { @page { size: A4 portrait; margin: 12mm 11mm; } body { font-size: 10pt !important; } }`}</style>

      <PrintLetterhead
        business={settings.businessName || t("app.name")}
        address={settings.businessAddress}
        title={t(`reports.nav.${report}`)}
        period={dated ? period : t("reports.valuation.asOf", { date: formatDate(new Date(), locale) })}
        printedBy={t("reports.printedBy", {
          name: session.user.fullName,
          when: formatDateTime(new Date(), locale),
        })}
      />

      <div className="print:hidden">
        <PageHeader
          title={t(`reports.nav.${report}`)}
          subtitle={dated ? period : t(`reports.blurb.${report}`)}
          actions={
            <ReportActions
              basePath={`/reports/${report}`}
              from={range.from}
              to={range.to}
              preset={range.preset}
              extra={{ item: itemId }}
            />
          }
        />
      </div>

      <nav
        aria-label={t("reports.title")}
        className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0"
      >
        <div className="flex w-max gap-1 border-b border-rule sm:w-auto">
          <Link
            href={`/reports?${periodQuery}`}
            className="-mb-px flex items-center gap-2 border-b-2 border-transparent px-3 py-2.5 text-sm whitespace-nowrap text-muted hover:text-accent"
          >
            <NavIcon name="dashboard" />
            {t("reports.overview")}
          </Link>
          {siblings.map((slug) => (
            <Link
              key={slug}
              href={`/reports/${slug}?${periodQuery}`}
              aria-current={slug === report ? "page" : undefined}
              className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap ${
                slug === report
                  ? "border-accent font-medium text-accent"
                  : "border-transparent text-muted hover:text-accent"
              }`}
            >
              <NavIcon name={REPORT_ICON[slug]} />
              {t(`reports.nav.${slug}`)}
            </Link>
          ))}
        </div>
      </nav>

      {dated && (
        <RangePicker
          basePath={`/reports/${report}`}
          preset={range.preset}
          from={range.from}
          to={range.to}
          comparedWith={
            COMPARES.has(report)
              ? `${formatDate(previous.from, locale)} — ${formatDate(previous.to, locale)}`
              : undefined
          }
          extra={{ item: itemId }}
        />
      )}

      {report === "sales" && <SalesReport range={range} locale={locale} />}
      {report === "movements" && (
        <MovementsReport
          range={range}
          locale={locale}
          itemId={itemId}
          query={
            range.preset === "custom"
              ? { from: range.from, to: range.to }
              : { preset: range.preset }
          }
        />
      )}
      {report === "margin" && <MarginReport range={range} locale={locale} />}
      {report === "valuation" && <ValuationReport locale={locale} />}
      {report === "expiry" && <ExpiryReport range={range} locale={locale} />}
      {report === "suppliers" && <SuppliersReport range={range} locale={locale} />}
    </>
  );
}
