import { getTranslations } from "next-intl/server";
import { marginReport, type DateRange } from "@/lib/dal/reports";
import type { Preset } from "@/lib/reports/catalogue";
import { shareBps } from "@/lib/reports/analysis";
import { Alert } from "@/components/ui";
import { formatMoney } from "@/lib/format/money";
import { formatDate } from "@/lib/format/date";
import type { Locale } from "@/i18n/config";
import { KpiTile, Panel, percentFromBps, Statement, TableHeading } from "../_ui/Figures";
import { DataTable } from "../_ui/DataTable";
import { productName, tableLabels } from "../_ui/labels";

/**
 * Gross profit: net sales against the cost of what was sold.
 *
 * Laid out as the top of a profit and loss statement -- net sales, cost of
 * goods, gross profit -- because that is the shape the accountant will put it
 * in anyway, and then the same arithmetic per product and per category.
 */
export async function MarginReport({
  range,
  locale,
}: {
  range: DateRange & { preset: Preset | "custom" };
  locale: Locale;
}) {
  const t = await getTranslations();
  const data = await marginReport(range);
  const { summary: s, previousSummary: p } = data;
  const versus = (value: string) => t("reports.compare.versus", { value });

  const totals = data.byItem.reduce(
    (sum, row) => ({
      qty: sum.qty + row.marginQty,
      revenue: sum.revenue + row.marginRevenue,
      cost: sum.cost + row.cost,
      margin: sum.margin + row.margin,
    }),
    { qty: 0, revenue: 0, cost: 0, margin: 0 },
  );
  const lossMakers = data.byItem.filter((row) => row.margin < 0).length;

  return (
    <>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          label={t("reports.margin.revenue")}
          value={formatMoney(s.revenue)}
          current={s.revenue}
          previous={p.revenue}
          previousLabel={versus(formatMoney(p.revenue))}
          noComparison={t("reports.compare.none")}
          locale={locale}
        />
        <KpiTile
          label={t("reports.margin.cost")}
          value={formatMoney(s.cost)}
          current={s.cost}
          previous={p.cost}
          previousLabel={versus(formatMoney(p.cost))}
          noComparison={t("reports.compare.none")}
          goodWhen="neutral"
          locale={locale}
        />
        <KpiTile
          emphasis
          label={t("reports.margin.margin")}
          value={formatMoney(s.margin)}
          current={s.margin}
          previous={p.margin}
          previousLabel={versus(formatMoney(p.margin))}
          noComparison={t("reports.compare.none")}
          locale={locale}
        />
        <KpiTile
          label={t("reports.margin.marginPercent")}
          value={percentFromBps(s.marginBps, locale)}
          current={s.marginBps}
          previous={p.revenue > 0 ? p.marginBps : null}
          previousLabel={versus(percentFromBps(p.marginBps, locale))}
          noComparison={t("reports.compare.none")}
          pointsLabel={t("reports.compare.points")}
          locale={locale}
        />
      </div>

      {s.uncostedRevenue > 0 && (
        <Alert tone="warning" className="mb-6">
          {t("reports.margin.uncosted", { revenue: formatMoney(s.uncostedRevenue) })}
        </Alert>
      )}

      <div className="mb-8 grid gap-4 lg:grid-cols-5">
        <Panel title={t("reports.margin.statementTitle")} className="lg:col-span-2">
          <Statement
            format={(value) => formatMoney(value)}
            lines={[
              { label: t("reports.margin.revenue"), value: s.revenue, kind: "base" },
              { label: t("reports.margin.cost"), value: s.cost, kind: "minus" },
              { label: t("reports.margin.margin"), value: s.margin, kind: "grand" },
            ]}
          />
          <p className="mt-3 border-t border-rule pt-3 text-xs text-muted">
            {t("reports.margin.marginLine", {
              percent: percentFromBps(s.marginBps, locale),
              period: `${formatDate(data.previousRange.from, locale)} — ${formatDate(data.previousRange.to, locale)}`,
              previous: percentFromBps(p.marginBps, locale),
            })}
          </p>
        </Panel>

        <Panel title={t("reports.margin.howTitle")} className="lg:col-span-3">
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-muted">
            <li>{t("reports.margin.costNote")}</li>
            <li>{t("reports.margin.netOfReturns")}</li>
            <li>{t("reports.margin.netOfDiscount")}</li>
          </ul>
          {lossMakers > 0 && (
            <p className="mt-3 text-sm font-medium text-critical">
              {t("reports.margin.lossMakers", { count: lossMakers })}
            </p>
          )}
        </Panel>
      </div>

      <section className="mb-8">
        <TableHeading title={t("reports.margin.byItem")} />
        <DataTable
          locale={locale}
          searchable
          minWidth={860}
          labels={tableLabels(t, data.byItem.length)}
          initialSort={{ key: "margin", direction: "desc" }}
          columns={[
            { key: "name", label: t("sell.item"), kind: "text" },
            { key: "qty", label: t("common.quantity"), kind: "number", muted: true },
            { key: "revenue", label: t("reports.margin.revenue"), kind: "money" },
            { key: "cost", label: t("reports.margin.cost"), kind: "money", muted: true },
            { key: "margin", label: t("reports.margin.margin"), kind: "money", signed: true },
            { key: "marginBps", label: t("reports.margin.marginPercent"), kind: "percent", signed: true },
            { key: "share", label: t("reports.margin.shareOfProfit"), kind: "share" },
          ]}
          rows={data.byItem.map((row) => ({
            id: row.key,
            href: row.itemId ? `/items/${row.itemId}` : undefined,
            sub: row.code || undefined,
            tag: row.itemId ? undefined : t("reports.history.notInCatalogue"),
            cells: {
              name: productName(row),
              qty: row.marginQty,
              revenue: row.marginRevenue,
              cost: row.cost,
              margin: row.margin,
              marginBps: row.marginBps,
              share: shareBps(Math.max(row.margin, 0), Math.max(totals.margin, 0)),
            },
          }))}
          totals={{
            qty: totals.qty,
            revenue: totals.revenue,
            cost: totals.cost,
            margin: totals.margin,
            marginBps: totals.revenue > 0 ? Math.round((totals.margin / totals.revenue) * 10_000) : 0,
          }}
        />
      </section>

      <section className="min-w-0">
        <TableHeading title={t("reports.margin.byCategory")} />
        <DataTable
          locale={locale}
          minWidth={620}
          labels={tableLabels(t, data.byCategory.length)}
          initialSort={{ key: "margin", direction: "desc" }}
          columns={[
            { key: "name", label: t("items.category"), kind: "text" },
            { key: "revenue", label: t("reports.margin.revenue"), kind: "money" },
            { key: "cost", label: t("reports.margin.cost"), kind: "money", muted: true },
            { key: "margin", label: t("reports.margin.margin"), kind: "money", signed: true },
            { key: "marginBps", label: t("reports.margin.marginPercent"), kind: "percent", signed: true },
          ]}
          rows={data.byCategory.map((row) => ({
            id: row.categoryId ?? "none",
            cells: {
              name: row.name || t("reports.table.uncategorised"),
              revenue: row.revenue,
              cost: row.cost,
              margin: row.margin,
              marginBps: row.marginBps,
            },
          }))}
          totals={{
            revenue: totals.revenue,
            cost: totals.cost,
            margin: totals.margin,
            marginBps: totals.revenue > 0 ? Math.round((totals.margin / totals.revenue) * 10_000) : 0,
          }}
        />
      </section>
    </>
  );
}
