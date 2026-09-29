"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { historyImportAction, type HistoryImportState } from "./actions";
import { Alert, Card, Th, buttonSecondary } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { formatMoney } from "@/lib/format/money";
import { formatExpiry } from "@/lib/format/date";
import type { Locale } from "@/i18n/config";

const initialState: HistoryImportState = { stage: "idle" };

/** Days are listed up to this many; past it the count says the rest. */
const DAYS_LISTED = 12;

/**
 * Upload, check, then confirm -- the catalogue import's flow, with a fuller
 * preview. Past sales move every revenue figure in the reports, so before
 * anything is written the owner sees what the file adds up to, which lines
 * were refused and why, and which days are already counted elsewhere.
 *
 * The CSV text rides in a hidden field to the second submit, which checks it
 * again against the catalogue as it is then rather than trusting this preview.
 */
export function HistoryImportForm({ locale }: { locale: Locale }) {
  const t = useTranslations();
  const [state, formAction] = useActionState<HistoryImportState, FormData>(
    historyImportAction,
    initialState,
  );

  const summary = state.summary;
  const errorCount = state.errorCount ?? 0;
  const lines = summary?.lines ?? 0;
  const days = (list: string[]) =>
    list.slice(0, DAYS_LISTED).map((day) => formatExpiry(day, locale)).join(", ") +
    (list.length > DAYS_LISTED ? ` ${t("historyImport.andMore", { count: list.length - DAYS_LISTED })}` : "");

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t("historyImport.templateTitle")}</p>
          <p className="mt-1 text-sm text-muted">{t("historyImport.templateHint")}</p>
        </div>
        {/* A file download, not a page: a plain link, so the browser saves it. */}
        <a href={`/reports/import/template`} download className={buttonSecondary}>
          {t("historyImport.downloadTemplate")}
        </a>
      </Card>

      {state.formError && <Alert>{t(`errors.${state.formError}`)}</Alert>}

      {state.stage === "done" && state.done ? (
        <Card className="flex flex-col gap-4 p-5">
          <Alert tone="notice">
            {t("historyImport.done", {
              number: state.done.importNumber,
              lines: state.done.lines,
              total: formatMoney(state.done.total),
              from: formatExpiry(state.done.firstDay, locale),
              to: formatExpiry(state.done.lastDay, locale),
            })}
          </Alert>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/reports/sales?from=${state.done.firstDay}&to=${state.done.lastDay}`}
              className={buttonSecondary}
            >
              {t("historyImport.seeReport")}
            </Link>
            <Link href="/reports/import" className={buttonSecondary}>
              {t("historyImport.another")}
            </Link>
          </div>
        </Card>
      ) : (
        <Card className="p-5">
          <form action={formAction} className="flex flex-col gap-5">
            {state.stage === "previewed" && summary ? (
              <>
                <input type="hidden" name="intent" value="commit" />
                <input type="hidden" name="fileName" value={state.fileName ?? ""} />
                <textarea name="csvText" defaultValue={state.csvText} hidden readOnly />

                <div>
                  <p className="text-sm font-medium">{state.fileName}</p>
                  <p className="mt-1 text-sm text-muted">
                    {t("historyImport.previewSummary", {
                      valid: lines,
                      total: state.totalRows ?? 0,
                      errors: errorCount,
                    })}
                  </p>
                </div>

                {lines > 0 && (
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Figure
                      label={t("historyImport.figure.period")}
                      value={
                        summary.firstDay === summary.lastDay
                          ? formatExpiry(summary.firstDay ?? "", locale)
                          : `${formatExpiry(summary.firstDay ?? "", locale)} – ${formatExpiry(summary.lastDay ?? "", locale)}`
                      }
                    />
                    <Figure label={t("historyImport.figure.total")} value={formatMoney(summary.total)} />
                    <Figure label={t("historyImport.figure.units")} value={summary.units.toLocaleString("id-ID")} />
                    <Figure
                      label={t("historyImport.figure.receipts")}
                      value={summary.receipts.toLocaleString("id-ID")}
                      hint={
                        summary.withoutReceipt > 0
                          ? t("historyImport.figure.withoutReceipt", { count: summary.withoutReceipt })
                          : undefined
                      }
                    />
                    <Figure
                      label={t("historyImport.figure.linked")}
                      value={`${summary.linked} / ${lines}`}
                      hint={
                        summary.unlinked > 0
                          ? t("historyImport.figure.unlinked", { count: summary.unlinked })
                          : undefined
                      }
                    />
                    <Figure
                      label={t("historyImport.figure.costed")}
                      value={`${summary.costed} / ${lines}`}
                      hint={
                        summary.costed < lines ? t("historyImport.figure.uncosted") : undefined
                      }
                    />
                  </dl>
                )}

                {state.duplicateOf && (
                  <Alert>
                    {t("historyImport.duplicate", { number: state.duplicateOf.importNumber })}
                  </Alert>
                )}

                {state.overlap && state.overlap.tillDays.length > 0 && (
                  <Alert tone="warning">
                    <p className="font-medium">
                      {t("historyImport.overlapTill", { count: state.overlap.tillDays.length })}
                    </p>
                    <p className="mt-1 text-xs">{days(state.overlap.tillDays)}</p>
                  </Alert>
                )}

                {state.overlap && state.overlap.importedDays.length > 0 && (
                  <Alert tone="warning">
                    <p className="font-medium">
                      {t("historyImport.overlapImported", {
                        count: state.overlap.importedDays.length,
                      })}
                    </p>
                    <p className="mt-1 text-xs">{days(state.overlap.importedDays)}</p>
                  </Alert>
                )}

                {errorCount > 0 && (
                  <div>
                    <p className="mb-2 text-sm font-medium text-critical">
                      {t("historyImport.errorsTitle", { count: errorCount })}
                    </p>
                    <div className="max-h-72 overflow-auto rounded-lg border border-rule">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0">
                          <tr>
                            <Th>{t("historyImport.sheetRow")}</Th>
                            <Th>{t("itemsImport.field")}</Th>
                            <Th>{t("itemsImport.problem")}</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {state.errors?.map((e, i) => (
                            <tr key={i} className="border-t border-rule">
                              <td className="tabular px-3 py-2">{e.row}</td>
                              <td className="px-3 py-2 font-mono text-xs text-muted">{e.field}</td>
                              <td className="px-3 py-2">{t(`historyImport.error.${e.message}`)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {errorCount > (state.errors?.length ?? 0) && (
                      <p className="mt-2 text-xs text-muted">
                        {t("historyImport.errorsCapped", {
                          shown: state.errors?.length ?? 0,
                          total: errorCount,
                        })}
                      </p>
                    )}
                  </div>
                )}

                {state.sample && state.sample.length > 0 && (
                  <div>
                    <p className="mb-2 text-sm font-medium">{t("historyImport.sampleTitle")}</p>
                    <div className="overflow-x-auto rounded-lg border border-rule">
                      <table className="w-full min-w-[640px] text-sm">
                        <thead>
                          <tr>
                            <Th>{t("historyImport.col.date")}</Th>
                            <Th>{t("historyImport.col.receipt")}</Th>
                            <Th>{t("historyImport.col.item")}</Th>
                            <Th className="text-right">{t("historyImport.col.qty")}</Th>
                            <Th className="text-right">{t("historyImport.col.total")}</Th>
                            <Th className="text-right">{t("historyImport.col.cost")}</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {state.sample.map((row) => (
                            <tr key={row.row} className="border-t border-rule">
                              <td className="tabular px-3 py-2 whitespace-nowrap">
                                {formatExpiry(row.soldOn, locale)}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-muted">
                                {row.receiptNumber ?? "—"}
                              </td>
                              <td className="px-3 py-2">
                                {row.itemName}
                                {!row.itemId && (
                                  <span className="ml-2 text-xs text-faint">
                                    {t("historyImport.notInCatalogue")}
                                  </span>
                                )}
                              </td>
                              <td className="tabular px-3 py-2 text-right">{row.qty}</td>
                              <td className="tabular px-3 py-2 text-right whitespace-nowrap">
                                {formatMoney(row.lineTotal)}
                              </td>
                              <td className="tabular px-3 py-2 text-right whitespace-nowrap text-muted">
                                {row.unitCost === null ? "—" : formatMoney(row.unitCost)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {lines > 0 && !state.duplicateOf && (
                    <SubmitButton pendingLabel={t("historyImport.importing")}>
                      {t("historyImport.confirm", { count: lines })}
                    </SubmitButton>
                  )}
                  <Link href="/reports/import" className={buttonSecondary}>
                    {t("historyImport.startOver")}
                  </Link>
                </div>
              </>
            ) : (
              <>
                <input type="hidden" name="intent" value="preview" />
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium">{t("historyImport.chooseFile")}</span>
                  <input
                    type="file"
                    name="file"
                    accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    required
                    className="text-sm file:mr-3 file:rounded-lg file:border file:border-rule file:bg-surface file:px-3 file:py-1.5 file:text-sm file:text-foreground"
                  />
                  <span className="text-xs text-faint">{t("historyImport.fileHint")}</span>
                </label>
                <div>
                  <SubmitButton pendingLabel={t("historyImport.checking")}>
                    {t("historyImport.upload")}
                  </SubmitButton>
                </div>
              </>
            )}
          </form>
        </Card>
      )}
    </div>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-rule bg-surface-2/50 px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tabular mt-1 font-semibold">{value}</dd>
      {hint && <dd className="mt-1 text-xs text-faint">{hint}</dd>}
    </div>
  );
}
