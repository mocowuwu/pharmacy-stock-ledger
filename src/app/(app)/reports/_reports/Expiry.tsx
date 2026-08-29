import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { expiryLossReport, type DateRange } from "@/lib/dal/reports";
import { Stat } from "@/components/ui";
import { formatMoney } from "@/lib/format/money";
import { Cell, ReportTable, Row } from "../ReportTable";

export async function ExpiryReport({ range }: { range: DateRange }) {
  const t = await getTranslations();
  const data = await expiryLossReport(range);

  return (
    <>
      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <Stat
          value={formatMoney(data.total)}
          label={t("reports.expiry.total")}
          tone={data.total > 0 ? "warning" : "quiet"}
          hint={t("reports.expiry.note")}
        />
        <Stat
          value={data.units}
          label={t("reports.expiry.units")}
          tone={data.units === 0 ? "quiet" : "default"}
        />
        <Stat
          value={data.byItem.reduce((sum, row) => sum + row.events, 0)}
          label={t("reports.expiry.events")}
          tone="quiet"
        />
      </div>

      <ReportTable
        title={t("reports.expiry.byItem")}
        empty={t("reports.noData")}
        minWidth={720}
        columns={[
          { label: t("sell.item") },
          { label: t("items.category") },
          { label: t("reports.expiry.units"), align: "right" },
          { label: t("reports.expiry.total"), align: "right" },
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
            <Cell muted>{row.categoryName ?? "—"}</Cell>
            <Cell align="right">
              {row.qty} {row.unit}
            </Cell>
            <Cell align="right">{formatMoney(row.value)}</Cell>
          </Row>
        ))}
      </ReportTable>

      <div className="grid gap-x-8 lg:grid-cols-2">
        <ReportTable
          title={t("reports.expiry.byMonth")}
          empty={t("reports.noData")}
          minWidth={340}
          columns={[
            { label: t("reports.expiry.month") },
            { label: t("reports.expiry.units"), align: "right" },
            { label: t("reports.expiry.total"), align: "right" },
          ]}
        >
          {data.byMonth.map((row) => (
            <Row key={row.month}>
              <Cell>{row.month}</Cell>
              <Cell align="right">{row.qty}</Cell>
              <Cell align="right">{formatMoney(row.value)}</Cell>
            </Row>
          ))}
        </ReportTable>

        {/* Reasons are free text typed at the counter, so they are shown
            exactly as entered and never translated. */}
        <ReportTable
          title={t("reports.expiry.byReason")}
          empty={t("reports.noData")}
          minWidth={340}
          columns={[
            { label: t("reports.expiry.reason") },
            { label: t("reports.expiry.events"), align: "right" },
            { label: t("reports.expiry.total"), align: "right" },
          ]}
        >
          {data.byReason.map((row) => (
            <Row key={row.reason}>
              <Cell>{row.reason}</Cell>
              <Cell align="right">{row.events}</Cell>
              <Cell align="right">{formatMoney(row.value)}</Cell>
            </Row>
          ))}
        </ReportTable>
      </div>
    </>
  );
}
