import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { marginReport, type DateRange } from "@/lib/dal/reports";
import { Alert, Stat } from "@/components/ui";
import { formatMoney } from "@/lib/format/money";
import type { Locale } from "@/i18n/config";
import { Cell, percentFromBps, ReportTable, Row } from "../ReportTable";

export async function MarginReport({
  range,
  locale,
}: {
  range: DateRange;
  locale: Locale;
}) {
  const t = await getTranslations();
  const { summary, byItem } = await marginReport(range);

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat value={formatMoney(summary.revenue)} label={t("reports.margin.revenue")} />
        <Stat
          value={formatMoney(summary.cost)}
          label={t("reports.margin.cost")}
          tone="quiet"
        />
        <Stat value={formatMoney(summary.margin)} label={t("reports.margin.margin")} />
        <Stat
          value={percentFromBps(summary.marginBps, locale)}
          label={t("reports.margin.marginPercent")}
        />
      </div>

      {/* Said once, at the top: this is the whole reason the snapshot column
          exists, and a reader who assumes otherwise will mistrust the numbers
          the first time a delivery price changes. */}
      <Alert tone="notice" className="mb-8">
        {t("reports.margin.costNote")}
      </Alert>

      <ReportTable
        title={t("reports.margin.byItem")}
        note={t("reports.margin.netOfReturns")}
        empty={t("reports.noData")}
        minWidth={820}
        columns={[
          { label: t("sell.item") },
          { label: t("common.quantity"), align: "right" },
          { label: t("reports.margin.revenue"), align: "right" },
          { label: t("reports.margin.cost"), align: "right" },
          { label: t("reports.margin.margin"), align: "right" },
          { label: t("reports.margin.marginPercent"), align: "right" },
        ]}
      >
        {byItem.map((row) => (
          <Row key={row.itemId}>
            <Cell>
              <Link href={`/items/${row.itemId}`} className="hover:text-accent">
                {row.name}
                {row.strength ? ` ${row.strength}` : ""}
              </Link>
              <div className="font-mono text-xs text-faint">{row.code}</div>
            </Cell>
            <Cell align="right">
              {row.qtyNet} {row.unit}
            </Cell>
            <Cell align="right">{formatMoney(row.revenue)}</Cell>
            <Cell align="right" muted>
              {formatMoney(row.cost)}
            </Cell>
            <Cell align="right" tone={row.margin < 0 ? "critical" : undefined}>
              {formatMoney(row.margin)}
            </Cell>
            <Cell align="right" tone={row.marginBps < 0 ? "critical" : undefined}>
              {percentFromBps(row.marginBps, locale)}
            </Cell>
          </Row>
        ))}
      </ReportTable>
    </>
  );
}
