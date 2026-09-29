import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { salesReport, type DateRange } from "@/lib/dal/reports";
import { getCurrentSession } from "@/lib/dal/session";
import { can } from "@/lib/auth/permissions";
import type { Preset } from "@/lib/reports/catalogue";
import { shareBps } from "@/lib/reports/analysis";
import { Alert } from "@/components/ui";
import { SalesChart } from "@/components/SalesChart";
import { formatMoney } from "@/lib/format/money";
import { formatDate } from "@/lib/format/date";
import type { Locale } from "@/i18n/config";
import { KpiTile, Panel, Statement, TableHeading, type StatementLine } from "../_ui/Figures";
import { DataTable } from "../_ui/DataTable";
import { HourChart } from "../_ui/HourChart";
import { productName, tableLabels } from "../_ui/labels";

/**
 * The sales report, laid out the way a back office reads one: the headline
 * figures against the period before, the statement that gets from gross to
 * net, the trend, then the detail -- by product, category, payment and
 * cashier -- each table adding up to the statement above it.
 */
export async function SalesReport({
  range,
  locale,
}: {
  range: DateRange & { preset: Preset | "custom" };
  locale: Locale;
}) {
  const t = await getTranslations();
  const session = await getCurrentSession();
  const data = await salesReport(range);
  const { summary: s, previousSummary: p } = data;
  const previous = `${formatDate(data.previousRange.from, locale)} — ${formatDate(data.previousRange.to, locale)}`;
  const versus = (value: string) => t("reports.compare.versus", { value });
  const canImport = session ? can(session.grant, "sales.import_history") : false;

  const hasTax = s.tax > 0 || s.refundTax > 0;
  const statement: StatementLine[] = [
    { label: t("reports.statement.gross"), value: s.gross, kind: "base" },
    { label: t("reports.statement.discount"), value: s.discount, kind: "minus" },
    {
      label: t("reports.statement.returns"),
      value: s.refundsExTax,
      kind: "minus",
      note: s.returns > 0 ? t("reports.statement.returnsNote", { count: s.returns }) : undefined,
    },
    ...(s.taxIncluded > 0
      ? [{ label: t("reports.statement.taxIncluded"), value: s.taxIncluded, kind: "minus" as const }]
      : []),
    { label: t("reports.statement.net"), value: s.net, kind: hasTax ? "total" : "grand" },
    ...(hasTax
      ? [
          { label: t("reports.statement.tax"), value: s.taxNet, kind: "plus" as const },
          { label: t("reports.statement.collected"), value: s.collected, kind: "grand" as const },
        ]
      : []),
  ];

  const itemTotals = data.byItem.reduce(
    (sum, row) => ({
      qtySold: sum.qtySold + row.qtySold,
      qtyReturned: sum.qtyReturned + row.qtyReturned,
      qtyNet: sum.qtyNet + row.qtyNet,
      revenue: sum.revenue + row.revenue,
      discount: sum.discount + row.discount,
      taxIncluded: sum.taxIncluded + row.taxIncluded,
      refunded: sum.refunded + row.refunded,
      revenueNet: sum.revenueNet + row.revenueNet,
    }),
    { qtySold: 0, qtyReturned: 0, qtyNet: 0, revenue: 0, discount: 0, taxIncluded: 0, refunded: 0, revenueNet: 0 },
  );
  const showTaxColumn = itemTotals.taxIncluded > 0;
  const abcCount = (klass: string) => data.byItem.filter((row) => row.abc === klass).length;

  const paymentTotal = data.byPaymentMethod.reduce((sum, row) => sum + row.net, 0);
  const cashierTotal = data.byCashier.reduce((sum, row) => sum + row.revenue, 0);
  const categoryTotal = data.byCategory.reduce((sum, row) => sum + row.revenue, 0);

  return (
    <>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          emphasis
          label={t("reports.sales.net")}
          value={formatMoney(s.net)}
          current={s.net}
          previous={p.net}
          previousLabel={versus(formatMoney(p.net))}
          noComparison={t("reports.compare.none")}
          locale={locale}
        />
        <KpiTile
          label={t("reports.sales.transactions")}
          value={s.transactions.toLocaleString("id-ID")}
          current={s.transactions}
          previous={p.transactions}
          previousLabel={versus(p.transactions.toLocaleString("id-ID"))}
          noComparison={t("reports.compare.none")}
          locale={locale}
        />
        <KpiTile
          label={t("reports.sales.averageSale")}
          value={formatMoney(s.averageSale)}
          current={s.averageSale}
          previous={p.averageSale}
          previousLabel={versus(formatMoney(p.averageSale))}
          noComparison={t("reports.compare.none")}
          locale={locale}
        />
        <KpiTile
          label={t("reports.sales.units")}
          value={s.units.toLocaleString("id-ID")}
          current={s.units}
          previous={p.units}
          previousLabel={versus(p.units.toLocaleString("id-ID"))}
          noComparison={t("reports.compare.none")}
          locale={locale}
        />
      </div>

      {s.history.lines > 0 && (
        <Alert tone="notice" className="mb-6">
          {t("reports.history.included", {
            revenue: formatMoney(s.history.revenue),
            lines: s.history.lines.toLocaleString("id-ID"),
          })}
          {s.history.withoutReceipt > 0 &&
            ` ${t("reports.history.withoutReceipt", { count: s.history.withoutReceipt.toLocaleString("id-ID") })}`}{" "}
          {canImport && (
            <Link href="/reports/import" className="underline print:hidden">
              {t("reports.history.manage")}
            </Link>
          )}
        </Alert>
      )}

      <Panel title={t("reports.sales.daily")} note={t("reports.sales.dailyNote")} className="mb-6">
        <SalesChart
          data={data.daily}
          previous={data.previousDaily}
          locale={locale}
          emptyLabel={t("reports.noData")}
          salesLabel={t("reports.sales.daily")}
          labels={{
            current: t("reports.compare.thisPeriod"),
            previous: t("reports.compare.previousPeriod", { period: previous }),
            transactions: t("reports.sales.transactionsShort"),
          }}
        />
      </Panel>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Panel title={t("reports.statement.title")} note={t("reports.statement.note")}>
          <Statement lines={statement} format={(value) => formatMoney(value)} />
          {s.voided > 0 && (
            <p className="mt-3 border-t border-rule pt-3 text-xs text-muted">
              {t("reports.sales.voidedLine", { count: s.voided })}
            </p>
          )}
        </Panel>

        <Panel title={t("reports.sales.byPayment")} note={t("reports.sales.byPaymentNote")}>
          <DataTable
            locale={locale}
            minWidth={380}
            labels={tableLabels(t)}
            initialSort={{ key: "net", direction: "desc" }}
            columns={[
              { key: "method", label: t("sell.paymentMethod"), kind: "text" },
              { key: "transactions", label: t("reports.sales.transactionsShort"), kind: "number", muted: true },
              { key: "refunds", label: t("reports.sales.refunds"), kind: "money", muted: true },
              { key: "net", label: t("reports.sales.received"), kind: "money" },
            ]}
            rows={data.byPaymentMethod.map((row) => ({
              id: row.method,
              cells: {
                method:
                  row.method === "unrecorded"
                    ? t("reports.sales.unrecordedMethod")
                    : t(`paymentMethod.${row.method}`),
                transactions: row.transactions,
                refunds: row.refunds,
                net: row.net,
              },
            }))}
            totals={{
              transactions: data.byPaymentMethod.reduce((sum, row) => sum + row.transactions, 0),
              refunds: data.byPaymentMethod.reduce((sum, row) => sum + row.refunds, 0),
              net: paymentTotal,
            }}
          />
        </Panel>
      </div>

      <Panel title={t("reports.sales.byHour")} note={t("reports.sales.byHourNote")} className="mb-8">
        <HourChart
          data={data.byHour}
          label={t("reports.sales.byHour")}
          transactionsLabel={t("reports.sales.transactionsShort")}
          emptyLabel={t("reports.noData")}
        />
      </Panel>

      <section className="mb-8">
        <TableHeading
          title={t("reports.sales.byItem")}
          note={t("reports.sales.byItemNote", {
            a: abcCount("A"),
            b: abcCount("B"),
            c: abcCount("C"),
          })}
        />
        <DataTable
          locale={locale}
          searchable
          minWidth={showTaxColumn ? 1040 : 940}
          labels={tableLabels(t, data.byItem.length)}
          initialSort={{ key: "revenueNet", direction: "desc" }}
          columns={[
            { key: "name", label: t("sell.item"), kind: "text" },
            { key: "abc", label: t("reports.sales.abc"), kind: "abc" },
            { key: "qtySold", label: t("reports.sales.sold"), kind: "number" },
            { key: "qtyReturned", label: t("reports.sales.returned"), kind: "number", muted: true },
            { key: "qtyNet", label: t("reports.sales.netUnits"), kind: "number" },
            { key: "revenue", label: t("reports.sales.gross"), kind: "money", muted: true },
            { key: "discount", label: t("reports.statement.discount"), kind: "money", muted: true },
            ...(showTaxColumn
              ? [{ key: "taxIncluded", label: t("reports.statement.taxIncluded"), kind: "money" as const, muted: true }]
              : []),
            { key: "refunded", label: t("reports.statement.returns"), kind: "money", muted: true },
            { key: "revenueNet", label: t("reports.sales.netRevenue"), kind: "money", signed: true },
            { key: "share", label: t("reports.table.share"), kind: "share" },
          ]}
          rows={data.byItem.map((row) => ({
            id: row.key,
            href: row.itemId ? `/items/${row.itemId}` : undefined,
            sub: row.code || undefined,
            tag: row.itemId ? undefined : t("reports.history.notInCatalogue"),
            cells: {
              name: productName(row),
              abc: row.abc,
              qtySold: row.qtySold,
              qtyReturned: row.qtyReturned,
              qtyNet: row.qtyNet,
              revenue: row.revenue,
              discount: row.discount,
              taxIncluded: row.taxIncluded,
              refunded: row.refunded,
              revenueNet: row.revenueNet,
              share: shareBps(row.revenueNet, itemTotals.revenueNet),
            },
          }))}
          totals={{ ...itemTotals, abc: null }}
        />
      </section>

      <div className="grid gap-x-6 gap-y-8 lg:grid-cols-2">
        <section className="min-w-0">
          <TableHeading title={t("reports.sales.byCategory")} />
          <DataTable
            locale={locale}
            minWidth={440}
            labels={tableLabels(t, data.byCategory.length)}
            initialSort={{ key: "revenue", direction: "desc" }}
            columns={[
              { key: "name", label: t("items.category"), kind: "text" },
              { key: "qty", label: t("reports.sales.netUnits"), kind: "number", muted: true },
              { key: "revenue", label: t("reports.sales.netRevenue"), kind: "money", signed: true },
              { key: "share", label: t("reports.table.share"), kind: "share" },
            ]}
            rows={data.byCategory.map((row) => ({
              id: row.categoryId ?? "none",
              cells: {
                name: row.name || t("reports.table.uncategorised"),
                qty: row.qty,
                revenue: row.revenue,
                share: shareBps(row.revenue, categoryTotal),
              },
            }))}
            totals={{
              qty: data.byCategory.reduce((sum, row) => sum + row.qty, 0),
              revenue: categoryTotal,
            }}
          />
        </section>

        <section className="min-w-0">
          <TableHeading title={t("reports.sales.byCashier")} note={t("reports.sales.byCashierNote")} />
          <DataTable
            locale={locale}
            minWidth={420}
            labels={tableLabels(t, data.byCashier.length)}
            initialSort={{ key: "revenue", direction: "desc" }}
            columns={[
              { key: "name", label: t("reports.sales.cashier"), kind: "text" },
              { key: "transactions", label: t("reports.sales.transactionsShort"), kind: "number", muted: true },
              { key: "revenue", label: t("reports.sales.takings"), kind: "money" },
              { key: "share", label: t("reports.table.share"), kind: "share" },
            ]}
            rows={data.byCashier.map((row, index) => ({
              id: row.cashierId ?? `history-${index}`,
              tag: row.fromHistory ? t("reports.history.tag") : undefined,
              cells: {
                name: row.name || t("reports.history.unknownCashier"),
                transactions: row.transactions,
                revenue: row.revenue,
                share: shareBps(row.revenue, cashierTotal),
              },
            }))}
            totals={{
              transactions: data.byCashier.reduce((sum, row) => sum + row.transactions, 0),
              revenue: cashierTotal,
            }}
          />
        </section>
      </div>
    </>
  );
}
