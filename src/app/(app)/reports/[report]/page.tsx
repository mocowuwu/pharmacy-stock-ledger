import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { can } from "@/lib/auth/permissions";
import {
  isReportSlug,
  REPORTS,
  REPORT_PERMISSION,
  resolveRange,
} from "@/lib/reports/catalogue";
import { PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/format/date";
import { ExportLink, RangePicker } from "../RangePicker";
import { SalesReport } from "../_reports/Sales";
import { MarginReport } from "../_reports/Margin";
import { ValuationReport } from "../_reports/Valuation";
import { ExpiryReport } from "../_reports/Expiry";
import { SuppliersReport } from "../_reports/Suppliers";

/**
 * One route for all five reports.
 *
 * They share a period, a header and an export link and differ only in their
 * tables, so five near-identical page files would be five places to change the
 * date picker. The slug is validated against the union before anything is read.
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

  const range = resolveRange({
    preset: typeof query.preset === "string" ? query.preset : undefined,
    from: typeof query.from === "string" ? query.from : undefined,
    to: typeof query.to === "string" ? query.to : undefined,
  });

  // Valuation is a snapshot of the shelf now, so a period would be a lie.
  const dated = report !== "valuation";
  const siblings = REPORTS.filter((slug) => can(session.grant, REPORT_PERMISSION[slug]));

  return (
    <>
      <PageHeader
        title={t(`reports.nav.${report}`)}
        subtitle={
          dated
            ? `${formatDate(range.from, locale)} — ${formatDate(range.to, locale)}`
            : t(`reports.blurb.${report}`)
        }
        actions={
          <ExportLink
            basePath={`/reports/${report}`}
            from={range.from}
            to={range.to}
          />
        }
      />

      <nav className="mb-6 flex flex-wrap gap-1.5">
        {siblings.map((slug) => (
          <Link
            key={slug}
            href={`/reports/${slug}?preset=${range.preset === "custom" ? "30d" : range.preset}`}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              slug === report
                ? "border-accent bg-accent-soft text-accent"
                : "border-rule text-muted hover:border-accent hover:text-accent"
            }`}
          >
            {t(`reports.nav.${slug}`)}
          </Link>
        ))}
      </nav>

      {dated && (
        <RangePicker
          basePath={`/reports/${report}`}
          preset={range.preset}
          from={range.from}
          to={range.to}
        />
      )}

      {report === "sales" && <SalesReport range={range} locale={locale} />}
      {report === "margin" && <MarginReport range={range} locale={locale} />}
      {report === "valuation" && <ValuationReport locale={locale} />}
      {report === "expiry" && <ExpiryReport range={range} />}
      {report === "suppliers" && <SuppliersReport range={range} locale={locale} />}
    </>
  );
}
