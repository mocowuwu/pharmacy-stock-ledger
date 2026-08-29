import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { salesReport, type DateRange } from "@/lib/dal/reports";
import { Card, Stat } from "@/components/ui";
import { SalesChart } from "@/components/SalesChart";
import { formatMoney } from "@/lib/format/money";
import type { Locale } from "@/i18n/config";
import { Cell, ReportTable, Row } from "../ReportTable";

export async function SalesReport({
  range,
  locale,
}: {
  range: DateRange;
  locale: Locale;
}) {
  const t = await getTranslations();
  const data = await salesReport(range);
  const { summary } = data;

  return (
    <>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          value={formatMoney(summary.net)}
          label={t("reports.sales.net")}
          hint={
            summary.refunds > 0
              ? `${formatMoney(summary.revenue)} − ${formatMoney(summary.refunds)}`
              : undefined
          }
        />
        <Stat value={summary.transactions} label={t("reports.sales.transactions")} />
        <Stat
          value={formatMoney(summary.averageSale)}
          label={t("reports.sales.averageSale")}
        />
        <Stat
          value={summary.units}
          label={t("reports.sales.units")}
          tone={summary.units === 0 ? "quiet" : "default"}
        />
      </div>

      {(summary.voided > 0 || summary.discount > 0 || summary.tax > 0) && (
        <Card className="mb-8 flex flex-wrap gap-x-8 gap-y-2 px-5 py-4 text-sm">
          {summary.voided > 0 && (
            <span className="text-muted">
              {t("reports.sales.voided")}:{" "}
              <span className="tabular text-foreground">{summary.voided}</span>
              <span className="ml-2 text-xs text-faint">
                {t("reports.sales.voidedHint")}
              </span>
            </span>
          )}
          {summary.discount > 0 && (
            <span className="text-muted">
              {t("reports.sales.discount")}:{" "}
              <span className="tabular text-foreground">
                {formatMoney(summary.discount)}
              </span>
            </span>
          )}
          {summary.tax > 0 && (
            <span className="text-muted">
              {t("reports.sales.tax")}:{" "}
              <span className="tabular text-foreground">{formatMoney(summary.tax)}</span>
            </span>
          )}
        </Card>
      )}

      <Card className="mb-8 px-5 py-4">
        <h2 className="mb-3 text-sm font-medium text-muted">
          {t("reports.sales.daily")}
        </h2>
        <SalesChart
          data={data.daily}
          locale={locale}
          emptyLabel={t("dashboard.noSalesYet")}
          salesLabel={t("reports.sales.transactions")}
        />
      </Card>

      <ReportTable
        title={t("reports.sales.byItem")}
        empty={t("reports.noData")}
        minWidth={820}
        columns={[
          { label: t("sell.item") },
          { label: t("reports.sales.sold"), align: "right" },
          { label: t("reports.sales.returned"), align: "right" },
          { label: t("reports.sales.netUnits"), align: "right" },
          { label: t("reports.sales.netRevenue"), align: "right" },
        ]}
      >
        {data.byItem.map((row) => (
          <Row key={row.itemId}>
            <Cell>
              <Link href={`/items/${row.itemId}`} className="hover:text-accent">
                {row.name}
                {row.strength ? ` ${row.strength}` : ""}
              </Link>
              <div className="font-mono text-xs text-faint">{row.code}</div>
            </Cell>
            <Cell align="right">
              {row.qtySold} {row.unit}
            </Cell>
            <Cell align="right" tone={row.qtyReturned > 0 ? "warning" : undefined}>
              {row.qtyReturned > 0 ? row.qtyReturned : "—"}
            </Cell>
            <Cell align="right">{row.qtyNet}</Cell>
            <Cell align="right">{formatMoney(row.revenueNet)}</Cell>
          </Row>
        ))}
      </ReportTable>

      <ReportTable
        title={t("reports.sales.byCategory")}
        empty={t("reports.noData")}
        minWidth={520}
        columns={[
          { label: t("items.category") },
          { label: t("common.quantity"), align: "right" },
          { label: t("reports.sales.revenue"), align: "right" },
        ]}
      >
        {data.byCategory.map((row) => (
          <Row key={row.categoryId ?? row.name}>
            <Cell>{row.name || "—"}</Cell>
            <Cell align="right">{row.qty}</Cell>
            <Cell align="right">{formatMoney(row.revenue)}</Cell>
          </Row>
        ))}
      </ReportTable>

      <div className="grid gap-x-8 lg:grid-cols-2">
        <ReportTable
          title={t("reports.sales.byCashier")}
          empty={t("reports.noData")}
          minWidth={360}
          columns={[
            { label: t("reports.sales.byCashier") },
            { label: t("reports.sales.transactions"), align: "right" },
            { label: t("reports.sales.revenue"), align: "right" },
          ]}
        >
          {data.byCashier.map((row) => (
            <Row key={row.cashierId}>
              <Cell>{row.name}</Cell>
              <Cell align="right">{row.transactions}</Cell>
              <Cell align="right">{formatMoney(row.revenue)}</Cell>
            </Row>
          ))}
        </ReportTable>

        <ReportTable
          title={t("reports.sales.byPayment")}
          empty={t("reports.noData")}
          minWidth={360}
          columns={[
            { label: t("sell.paymentMethod") },
            { label: t("reports.sales.transactions"), align: "right" },
            { label: t("reports.sales.revenue"), align: "right" },
          ]}
        >
          {data.byPaymentMethod.map((row) => (
            <Row key={row.method}>
              <Cell>{t(`paymentMethod.${row.method}`)}</Cell>
              <Cell align="right">{row.transactions}</Cell>
              <Cell align="right">{formatMoney(row.revenue)}</Cell>
            </Row>
          ))}
        </ReportTable>
      </div>
    </>
  );
}
