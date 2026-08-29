import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/dal/session";
import { can } from "@/lib/auth/permissions";
import { notFound } from "next/navigation";
import { REPORTS, REPORT_PERMISSION, resolveRange } from "@/lib/reports/catalogue";
import { Card, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/format/date";
import { RangePicker } from "./RangePicker";

/**
 * The hub. Only the reports the signed-in user may actually open are listed --
 * a locked card that refuses on click would be worse than no card.
 */
export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const session = await requireSession();
  const t = await getTranslations();
  const params = await searchParams;

  const available = REPORTS.filter((slug) =>
    can(session.grant, REPORT_PERMISSION[slug]),
  );
  if (available.length === 0) notFound();

  const range = resolveRange({
    preset: typeof params.preset === "string" ? params.preset : undefined,
    from: typeof params.from === "string" ? params.from : undefined,
    to: typeof params.to === "string" ? params.to : undefined,
  });

  const query =
    range.preset === "custom"
      ? `?from=${range.from}&to=${range.to}`
      : `?preset=${range.preset}`;

  return (
    <>
      <PageHeader title={t("reports.title")} subtitle={t("reports.subtitle")} />

      <RangePicker
        basePath="/reports"
        preset={range.preset}
        from={range.from}
        to={range.to}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {available.map((slug) => (
          <Link key={slug} href={`/reports/${slug}${query}`} className="group">
            <Card className="h-full px-5 py-4 transition-colors group-hover:border-accent">
              <div className="font-medium group-hover:text-accent">
                {t(`reports.nav.${slug}`)}
              </div>
              <p className="mt-1 text-sm text-muted">{t(`reports.blurb.${slug}`)}</p>
              {slug !== "valuation" && (
                <p className="tabular mt-2 text-xs text-faint">
                  {formatDate(range.from, session.user.locale)} —{" "}
                  {formatDate(range.to, session.user.locale)}
                </p>
              )}
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
