import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { listCounts } from "@/lib/dal/counts";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/format/date";

const STATUS_TONE = {
  draft: "neutral",
  counting: "accent",
  review: "notice",
  posted: "neutral",
  cancelled: "neutral",
} as const;

export default async function CountsPage() {
  const session = await requirePermission("stock.count");
  const t = await getTranslations();
  const locale = session.user.locale;

  const counts = await listCounts();

  return (
    <>
      <PageHeader
        title={t("counts.title")}
        subtitle={t("counts.subtitle")}
        actions={
          <Link
            href="/counts/new"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            {t("counts.start")}
          </Link>
        }
      />

      {counts.length === 0 ? (
        <Card className="p-6">
          <EmptyState title={t("counts.listEmpty")} body={t("counts.subtitle")} />
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="border-b border-rule text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">
                  {t("dispose.number")}
                </th>
                <th className="px-4 py-2.5 font-medium">{t("counts.name")}</th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">
                  {t("common.status")}
                </th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">
                  {t("counts.counted")}
                </th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">
                  {t("counts.variance")}
                </th>
                <th className="px-4 py-2.5 font-medium whitespace-nowrap">
                  {t("counts.started")}
                </th>
                <th className="px-4 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              {counts.map((count) => (
                <tr key={count.id} className="border-b border-rule/60 last:border-0">
                  <td className="tabular px-4 py-3 font-medium whitespace-nowrap">
                    {count.countNumber}
                  </td>
                  <td className="px-4 py-3">
                    {count.name}
                    <div className="text-xs text-faint">
                      {count.categoryName ?? t("counts.wholePharmacy")}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Chip tone={STATUS_TONE[count.status]}>
                      {t(`counts.status.${count.status}`)}
                    </Chip>
                  </td>
                  <td className="tabular px-4 py-3 whitespace-nowrap text-muted">
                    {t("counts.progress", {
                      counted: count.counted,
                      total: count.lines,
                    })}
                  </td>
                  <td className="tabular px-4 py-3 whitespace-nowrap">
                    {count.variances > 0 ? (
                      <span className="text-warning-ink">
                        {t("counts.variances", { count: count.variances })}
                      </span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted">
                    {formatDateTime(count.startedAt, locale)}
                    <div className="text-xs text-faint">{count.startedBy}</div>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <Link
                      href={`/counts/${count.id}`}
                      className="rounded border border-rule px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-accent"
                    >
                      {t("counts.openSheet")}
                    </Link>
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
