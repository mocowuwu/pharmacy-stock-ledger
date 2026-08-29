import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { valuationReport } from "@/lib/dal/reports";
import { Alert, Stat } from "@/components/ui";
import { formatDate } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";
import type { Locale } from "@/i18n/config";
import type { ExpiryHorizon } from "@/lib/reports/queries";
import { Cell, ReportTable, Row } from "../ReportTable";

const HORIZONS: ExpiryHorizon[] = [
  "expired",
  "within30",
  "within90",
  "within180",
  "beyond",
];

export async function ValuationReport({ locale }: { locale: Locale }) {
  const t = await getTranslations();
  const data = await valuationReport();

  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat
          value={formatMoney(data.total)}
          label={t("reports.valuation.total")}
          hint={t("reports.valuation.asOf", { date: formatDate(data.asOf, locale) })}
        />
        <Stat value={data.units} label={t("reports.valuation.units")} />
        <Stat
          value={formatMoney(data.byExpiry.expired.value)}
          label={t("reports.valuation.horizon.expired")}
          tone={data.byExpiry.expired.value > 0 ? "critical" : "quiet"}
        />
      </div>

      {/* The date range control does not apply here, so say why rather than
          leaving a reader to wonder whether it silently did. */}
      <Alert tone="notice" className="mb-8">
        {t("reports.valuation.nowOnly")}
      </Alert>

      {data.byExpiry.expired.value > 0 && (
        <Alert className="mb-8">
          {t("reports.valuation.expiredWarning")}{" "}
          <Link href="/dispose" className="underline">
            {t("nav.dispose")}
          </Link>
        </Alert>
      )}

      <ReportTable
        title={t("reports.valuation.byExpiry")}
        note={t("reports.valuation.quarantineNote")}
        empty={t("reports.noData")}
        minWidth={520}
        columns={[
          { label: t("reports.valuation.byExpiry") },
          { label: t("reports.valuation.units"), align: "right" },
          { label: t("reports.valuation.total"), align: "right" },
        ]}
      >
        {HORIZONS.filter((key) => data.byExpiry[key].units > 0).map((key) => (
          <Row key={key}>
            <Cell tone={key === "expired" ? "critical" : undefined}>
              {t(`reports.valuation.horizon.${key}`)}
            </Cell>
            <Cell align="right">{data.byExpiry[key].units}</Cell>
            <Cell align="right">{formatMoney(data.byExpiry[key].value)}</Cell>
          </Row>
        ))}
      </ReportTable>

      <ReportTable
        title={t("reports.valuation.byCategory")}
        empty={t("reports.noData")}
        minWidth={620}
        columns={[
          { label: t("items.category") },
          { label: t("reports.valuation.batches"), align: "right" },
          { label: t("reports.valuation.units"), align: "right" },
          { label: t("reports.valuation.total"), align: "right" },
        ]}
      >
        {data.byCategory.map((row) => (
          <Row key={row.categoryId ?? row.name}>
            <Cell>{row.name || "—"}</Cell>
            <Cell align="right" muted>
              {row.batches}
            </Cell>
            <Cell align="right">{row.units}</Cell>
            <Cell align="right">{formatMoney(row.value)}</Cell>
          </Row>
        ))}
      </ReportTable>
    </>
  );
}
