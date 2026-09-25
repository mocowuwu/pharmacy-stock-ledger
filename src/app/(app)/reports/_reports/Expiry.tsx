import { getTranslations } from "next-intl/server";
import { expiryLossReport, type DateRange } from "@/lib/dal/reports";
import { shareBps } from "@/lib/reports/analysis";
import { formatMoney } from "@/lib/format/money";
import type { Locale } from "@/i18n/config";
import { KpiTile, TableHeading } from "../_ui/Figures";
import { DataTable } from "../_ui/DataTable";
import { productName, tableLabels } from "../_ui/labels";

const MONTHS: Record<Locale, string[]> = {
  id: ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

/**
 * What was thrown away, what it cost, and why. The report that tells the owner
 * they are over-ordering -- which is why a disposal is never an adjustment.
 */
export async function ExpiryReport({ range, locale }: { range: DateRange; locale: Locale }) {
  const t = await getTranslations();
  const data = await expiryLossReport(range);
  const events = data.byItem.reduce((sum, row) => sum + row.events, 0);
  const month = (key: string) => {
    const [year, m] = key.split("-").map(Number);
    return `${MONTHS[locale][m - 1] ?? key} ${year}`;
  };

  return (
    <>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiTile
          label={t("reports.expiry.total")}
          value={formatMoney(data.total)}
          tone={data.total > 0 ? "warning" : "quiet"}
          hint={t("reports.expiry.note")}
          locale={locale}
        />
        <KpiTile
          label={t("reports.expiry.units")}
          value={data.units.toLocaleString("id-ID")}
          tone={data.units === 0 ? "quiet" : "default"}
          locale={locale}
        />
        <KpiTile
          label={t("reports.expiry.events")}
          value={events.toLocaleString("id-ID")}
          tone={events === 0 ? "quiet" : "default"}
          locale={locale}
        />
      </div>

      <section className="mb-8">
        <TableHeading title={t("reports.expiry.byItem")} />
        <DataTable
          locale={locale}
          searchable
          minWidth={720}
          labels={tableLabels(t, data.byItem.length)}
          initialSort={{ key: "value", direction: "desc" }}
          columns={[
            { key: "name", label: t("sell.item"), kind: "text" },
            { key: "category", label: t("items.category"), kind: "text" },
            { key: "events", label: t("reports.expiry.events"), kind: "number", muted: true },
            { key: "qty", label: t("reports.expiry.units"), kind: "number" },
            { key: "value", label: t("reports.expiry.total"), kind: "money" },
            { key: "share", label: t("reports.table.share"), kind: "share" },
          ]}
          rows={data.byItem.map((row) => ({
            id: row.itemId,
            href: `/items/${row.itemId}`,
            sub: row.code,
            cells: {
              name: productName(row),
              category: row.categoryName ?? "—",
              events: row.events,
              qty: row.qty,
              value: row.value,
              share: shareBps(row.value, data.total),
            },
          }))}
          totals={{ events, qty: data.units, value: data.total }}
        />
      </section>

      <div className="grid gap-x-6 gap-y-8 lg:grid-cols-2">
        <section className="min-w-0">
          <TableHeading title={t("reports.expiry.byMonth")} />
          <DataTable
            locale={locale}
            minWidth={340}
            labels={tableLabels(t, data.byMonth.length)}
            initialSort={{ key: "key", direction: "asc" }}
            columns={[
              { key: "month", label: t("reports.expiry.month"), kind: "text", sortKey: "key" },
              { key: "qty", label: t("reports.expiry.units"), kind: "number", muted: true },
              { key: "value", label: t("reports.expiry.total"), kind: "money" },
            ]}
            rows={data.byMonth.map((row) => ({
              id: row.month,
              cells: { month: month(row.month), key: row.month, qty: row.qty, value: row.value },
            }))}
            totals={{ qty: data.units, value: data.total }}
          />
        </section>

        {/* Reasons are free text typed at the counter, so they are shown
            exactly as entered and never translated. */}
        <section className="min-w-0">
          <TableHeading title={t("reports.expiry.byReason")} />
          <DataTable
            locale={locale}
            minWidth={340}
            labels={tableLabels(t, data.byReason.length)}
            initialSort={{ key: "value", direction: "desc" }}
            columns={[
              { key: "reason", label: t("reports.expiry.reason"), kind: "text" },
              { key: "events", label: t("reports.expiry.events"), kind: "number", muted: true },
              { key: "value", label: t("reports.expiry.total"), kind: "money" },
            ]}
            rows={data.byReason.map((row) => ({
              id: row.reason,
              cells: { reason: row.reason, events: row.events, value: row.value },
            }))}
            totals={{ events, value: data.total }}
          />
        </section>
      </div>
    </>
  );
}
