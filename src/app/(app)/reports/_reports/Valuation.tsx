import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { valuationReport } from "@/lib/dal/reports";
import { shareBps } from "@/lib/reports/analysis";
import { Alert } from "@/components/ui";
import { formatDate } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";
import type { Locale } from "@/i18n/config";
import type { ExpiryHorizon } from "@/lib/reports/queries";
import { KpiTile, TableHeading } from "../_ui/Figures";
import { DataTable } from "../_ui/DataTable";
import { tableLabels } from "../_ui/labels";

const HORIZONS: ExpiryHorizon[] = ["expired", "within30", "within90", "within180", "beyond"];

/**
 * What the shelf is worth, at what it cost, and how long there is to sell it.
 * A snapshot of now: the period control does not apply, and the screen says so.
 */
export async function ValuationReport({ locale }: { locale: Locale }) {
  const t = await getTranslations();
  const data = await valuationReport();
  const soon = data.byExpiry.within30.value + data.byExpiry.within90.value;
  const expiryTotal = HORIZONS.reduce((sum, key) => sum + data.byExpiry[key].value, 0);

  return (
    <>
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          emphasis
          label={t("reports.valuation.total")}
          value={formatMoney(data.total)}
          hint={t("reports.valuation.asOf", { date: formatDate(data.asOf, locale) })}
          locale={locale}
        />
        <KpiTile
          label={t("reports.valuation.units")}
          value={data.units.toLocaleString("id-ID")}
          locale={locale}
        />
        <KpiTile
          label={t("reports.valuation.soon")}
          value={formatMoney(soon)}
          tone={soon > 0 ? "warning" : "quiet"}
          hint={t("reports.valuation.soonHint")}
          locale={locale}
        />
        <KpiTile
          label={t("reports.valuation.horizon.expired")}
          value={formatMoney(data.byExpiry.expired.value)}
          tone={data.byExpiry.expired.value > 0 ? "critical" : "quiet"}
          locale={locale}
        />
      </div>

      {/* The date range control does not apply here, so say why rather than
          leaving a reader to wonder whether it silently did. */}
      <Alert tone="notice" className="mb-6">
        {t("reports.valuation.nowOnly")}
      </Alert>

      {data.byExpiry.expired.value > 0 && (
        <Alert className="mb-6">
          {t("reports.valuation.expiredWarning")}{" "}
          <Link href="/dispose" className="underline print:hidden">
            {t("nav.dispose")}
          </Link>
        </Alert>
      )}

      <div className="grid gap-y-8">
        <section className="min-w-0">
          <TableHeading title={t("reports.valuation.byExpiry")} note={t("reports.valuation.quarantineNote")} />
          <DataTable
            locale={locale}
            minWidth={420}
            labels={tableLabels(t)}
            columns={[
              { key: "horizon", label: t("reports.valuation.horizonColumn"), kind: "text" },
              { key: "units", label: t("reports.valuation.units"), kind: "number", muted: true },
              { key: "value", label: t("reports.valuation.total"), kind: "money" },
              { key: "share", label: t("reports.table.share"), kind: "share" },
            ]}
            rows={HORIZONS.filter((key) => data.byExpiry[key].units > 0).map((key) => ({
              id: key,
              cells: {
                horizon: t(`reports.valuation.horizon.${key}`),
                units: data.byExpiry[key].units,
                value: data.byExpiry[key].value,
                share: shareBps(data.byExpiry[key].value, expiryTotal),
              },
            }))}
            totals={{
              units: HORIZONS.reduce((sum, key) => sum + data.byExpiry[key].units, 0),
              value: expiryTotal,
            }}
          />
        </section>

        <section className="min-w-0">
          <TableHeading title={t("reports.valuation.byCategory")} note={t("reports.valuation.sellableNote")} />
          <DataTable
            locale={locale}
            minWidth={480}
            labels={tableLabels(t, data.byCategory.length)}
            initialSort={{ key: "value", direction: "desc" }}
            columns={[
              { key: "name", label: t("items.category"), kind: "text" },
              { key: "batches", label: t("reports.valuation.batches"), kind: "number", muted: true },
              { key: "units", label: t("reports.valuation.units"), kind: "number", muted: true },
              { key: "value", label: t("reports.valuation.total"), kind: "money" },
              { key: "share", label: t("reports.table.share"), kind: "share" },
            ]}
            rows={data.byCategory.map((row) => ({
              id: row.categoryId ?? "none",
              cells: {
                name: row.name || t("reports.table.uncategorised"),
                batches: row.batches,
                units: row.units,
                value: row.value,
                share: shareBps(row.value, data.total),
              },
            }))}
            totals={{
              batches: data.byCategory.reduce((sum, row) => sum + row.batches, 0),
              units: data.units,
              value: data.total,
            }}
          />
        </section>
      </div>
    </>
  );
}
