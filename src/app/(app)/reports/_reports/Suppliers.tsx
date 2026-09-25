import { getTranslations } from "next-intl/server";
import { supplierReport, type DateRange } from "@/lib/dal/reports";
import { formatMoney } from "@/lib/format/money";
import type { Locale } from "@/i18n/config";
import { KpiTile, percentFromBps, TableHeading } from "../_ui/Figures";
import { DataTable } from "../_ui/DataTable";
import { tableLabels } from "../_ui/labels";

/**
 * What each supplier delivered, and how much of it ended up in the bin. The
 * last column is the one that matters: stock that arrives close to expiry is
 * not cheap, whatever the invoice said.
 */
export async function SuppliersReport({ range, locale }: { range: DateRange; locale: Locale }) {
  const t = await getTranslations();
  const data = await supplierReport(range);
  const deliveries = data.rows.reduce((sum, row) => sum + row.deliveries, 0);
  const overallBps = data.total > 0 ? Math.round((data.disposed / data.total) * 10_000) : 0;

  return (
    <>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile emphasis label={t("reports.suppliers.value")} value={formatMoney(data.total)} locale={locale} />
        <KpiTile
          label={t("reports.suppliers.deliveries")}
          value={deliveries.toLocaleString("id-ID")}
          locale={locale}
        />
        <KpiTile
          label={t("reports.suppliers.disposed")}
          value={formatMoney(data.disposed)}
          tone={data.disposed > 0 ? "warning" : "quiet"}
          locale={locale}
        />
        <KpiTile
          label={t("reports.suppliers.disposalRate")}
          value={percentFromBps(overallBps, locale)}
          tone={overallBps >= 1_000 ? "critical" : overallBps >= 500 ? "warning" : "quiet"}
          locale={locale}
        />
      </div>

      <TableHeading title={t("reports.suppliers.received")} note={t("reports.suppliers.note")} />
      <DataTable
        locale={locale}
        minWidth={860}
        labels={tableLabels(t, data.rows.length)}
        initialSort={{ key: "value", direction: "desc" }}
        columns={[
          { key: "name", label: t("stock.supplier"), kind: "text" },
          { key: "deliveries", label: t("reports.suppliers.deliveries"), kind: "number", muted: true },
          { key: "units", label: t("reports.suppliers.unitsReceived"), kind: "number" },
          { key: "value", label: t("reports.suppliers.value"), kind: "money" },
          { key: "remaining", label: t("reports.suppliers.remaining"), kind: "number", muted: true },
          { key: "disposedValue", label: t("reports.suppliers.disposed"), kind: "money" },
          { key: "disposalBps", label: t("reports.suppliers.disposalRate"), kind: "percent" },
        ]}
        rows={data.rows.map((row) => ({
          id: row.supplierId,
          tag: row.isSystem ? t("reports.suppliers.systemSupplier") : undefined,
          cells: {
            name: row.name,
            deliveries: row.deliveries,
            units: row.units,
            value: row.value,
            remaining: row.remaining,
            disposedValue: row.disposedValue > 0 ? row.disposedValue : null,
            disposalBps: row.disposalBps > 0 ? row.disposalBps : null,
          },
        }))}
        totals={{
          deliveries,
          units: data.rows.reduce((sum, row) => sum + row.units, 0),
          value: data.total,
          remaining: data.rows.reduce((sum, row) => sum + row.remaining, 0),
          disposedValue: data.disposed,
          disposalBps: overallBps,
        }}
      />
    </>
  );
}
