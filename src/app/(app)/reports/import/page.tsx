import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/dal/session";
import { listHistoryImports } from "@/lib/dal/history";
import { Card, Chip, EmptyState, PageHeader, SectionHeading, Th, buttonSecondarySmall } from "@/components/ui";
import { formatDateTime, formatExpiry } from "@/lib/format/date";
import { formatMoney } from "@/lib/format/money";
import { HistoryImportForm } from "./HistoryImportForm";
import { WithdrawImport } from "./WithdrawImport";

/**
 * Past sales, brought in from a spreadsheet so the reports reach back before
 * the till was switched on. What it does and does not touch is said on the
 * screen, because the answer -- reports yes, stock no -- is not obvious.
 */
export default async function HistoryImportPage() {
  const session = await requirePermission("sales.import_history");
  const t = await getTranslations();
  const locale = session.user.locale;
  const imports = await listHistoryImports();

  return (
    <>
      <PageHeader
        title={t("historyImport.title")}
        subtitle={t("historyImport.subtitle")}
        actions={
          <Link href="/reports" className={buttonSecondarySmall}>
            {t("historyImport.backToReports")}
          </Link>
        }
      />

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        {(["counts", "stock", "today"] as const).map((key) => (
          <Card key={key} className="px-5 py-4">
            <p className="text-sm font-medium">{t(`historyImport.rules.${key}.title`)}</p>
            <p className="mt-1 text-sm text-muted">{t(`historyImport.rules.${key}.body`)}</p>
          </Card>
        ))}
      </div>

      <HistoryImportForm locale={locale} />

      <section className="mt-10">
        <SectionHeading>{t("historyImport.pastTitle")}</SectionHeading>
        {imports.length === 0 ? (
          <EmptyState title={t("historyImport.pastEmpty")} body={t("historyImport.pastEmptyHint")} />
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr>
                  <Th>{t("historyImport.col.number")}</Th>
                  <Th>{t("historyImport.col.period")}</Th>
                  <Th className="text-right">{t("historyImport.col.lines")}</Th>
                  <Th className="text-right">{t("historyImport.col.total")}</Th>
                  <Th>{t("historyImport.col.importedBy")}</Th>
                  <Th>{t("historyImport.col.status")}</Th>
                </tr>
              </thead>
              <tbody>
                {imports.map((row) => (
                  <tr key={row.id} className="border-t border-rule align-top">
                    <td className="px-3 py-3">
                      <div className="font-mono text-xs">{row.importNumber}</div>
                      {row.fileName && (
                        <div className="mt-0.5 max-w-[14rem] truncate text-xs text-faint" title={row.fileName}>
                          {row.fileName}
                        </div>
                      )}
                    </td>
                    <td className="tabular px-3 py-3 whitespace-nowrap">
                      {formatExpiry(row.firstDay, locale)} – {formatExpiry(row.lastDay, locale)}
                    </td>
                    <td className="tabular px-3 py-3 text-right">
                      {row.lineCount.toLocaleString("id-ID")}
                    </td>
                    <td className="tabular px-3 py-3 text-right whitespace-nowrap">
                      {formatMoney(row.total)}
                    </td>
                    <td className="px-3 py-3">
                      <div>{row.importedBy}</div>
                      <div className="tabular text-xs text-faint">
                        {formatDateTime(row.importedAt, locale)}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {row.status === "active" ? (
                        <div className="flex flex-col items-start gap-2">
                          <Chip tone="accent">{t("historyImport.status.active")}</Chip>
                          <WithdrawImport importId={row.id} importNumber={row.importNumber} />
                        </div>
                      ) : (
                        <div className="flex flex-col items-start gap-1">
                          <Chip>{t("historyImport.status.withdrawn")}</Chip>
                          <span className="text-xs text-muted">
                            {row.withdrawnBy}
                            {row.withdrawnAt ? ` · ${formatDateTime(row.withdrawnAt, locale)}` : ""}
                          </span>
                          {row.withdrawReason && (
                            <span className="text-xs text-faint">{row.withdrawReason}</span>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </>
  );
}
