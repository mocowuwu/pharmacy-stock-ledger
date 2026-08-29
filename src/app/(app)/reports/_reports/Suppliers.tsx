import { getTranslations } from "next-intl/server";
import { supplierReport, type DateRange } from "@/lib/dal/reports";
import { Stat } from "@/components/ui";
import { formatMoney } from "@/lib/format/money";
import type { Locale } from "@/i18n/config";
import { Cell, percentFromBps, ReportTable, Row } from "../ReportTable";

export async function SuppliersReport({
  range,
  locale,
}: {
  range: DateRange;
  locale: Locale;
}) {
  const t = await getTranslations();
  const data = await supplierReport(range);

  return (
    <>
      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <Stat value={formatMoney(data.total)} label={t("reports.suppliers.value")} />
        <Stat
          value={data.rows.reduce((sum, row) => sum + row.deliveries, 0)}
          label={t("reports.suppliers.deliveries")}
        />
        <Stat
          value={formatMoney(data.disposed)}
          label={t("reports.suppliers.disposed")}
          tone={data.disposed > 0 ? "warning" : "quiet"}
        />
      </div>

      <ReportTable
        title={t("reports.suppliers.received")}
        note={t("reports.suppliers.note")}
        empty={t("reports.noData")}
        minWidth={860}
        columns={[
          { label: t("stock.supplier") },
          { label: t("reports.suppliers.deliveries"), align: "right" },
          { label: t("reports.suppliers.unitsReceived"), align: "right" },
          { label: t("reports.suppliers.value"), align: "right" },
          { label: t("reports.suppliers.remaining"), align: "right" },
          { label: t("reports.suppliers.disposed"), align: "right" },
          { label: t("reports.suppliers.disposalRate"), align: "right" },
        ]}
      >
        {data.rows.map((row) => (
          <Row key={row.supplierId}>
            <Cell>{row.name}</Cell>
            <Cell align="right" muted>
              {row.deliveries}
            </Cell>
            <Cell align="right">{row.units}</Cell>
            <Cell align="right">{formatMoney(row.value)}</Cell>
            <Cell align="right" muted>
              {row.remaining}
            </Cell>
            <Cell align="right" tone={row.disposedValue > 0 ? "warning" : undefined}>
              {row.disposedValue > 0 ? formatMoney(row.disposedValue) : "—"}
            </Cell>
            {/* Above a twentieth of a delivery in the bin is worth a second
                look, so it is coloured rather than left to be scanned for. */}
            <Cell
              align="right"
              tone={
                row.disposalBps >= 1_000
                  ? "critical"
                  : row.disposalBps >= 500
                    ? "warning"
                    : undefined
              }
            >
              {row.disposalBps > 0 ? percentFromBps(row.disposalBps, locale) : "—"}
            </Cell>
          </Row>
        ))}
      </ReportTable>
    </>
  );
}
