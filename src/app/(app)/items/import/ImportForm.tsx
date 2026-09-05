"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { importAction, type ImportState } from "./actions";
import { Alert, Card, Th, buttonSecondary } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";

const initialState: ImportState = { stage: "idle" };

/**
 * Upload, then confirm: the file is parsed and validated first, and only the
 * rows that pass are actually written, on a second explicit submit. The CSV
 * text carried in the hidden field is what the second submit re-validates and
 * commits -- so a category deleted between the two steps is caught again
 * rather than trusted from a stale preview.
 */
export function ImportForm() {
  const t = useTranslations();
  const [state, formAction] = useActionState<ImportState, FormData>(
    importAction,
    initialState,
  );

  const errorCount = state.errors?.length ?? 0;
  const validCount = state.validCount ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="text-sm font-medium">{t("itemsImport.templateTitle")}</p>
          <p className="mt-1 text-sm text-muted">{t("itemsImport.templateHint")}</p>
        </div>
        <a href={`/items/import/template`} className={buttonSecondary}>
          {t("itemsImport.downloadTemplate")}
        </a>
      </Card>

      {state.formError && <Alert>{t(`errors.${state.formError}`)}</Alert>}

      {state.stage === "done" && state.summary ? (
        <Alert tone="notice">
          {t("itemsImport.done", {
            items: state.summary.itemsCreated,
            batches: state.summary.batchesCreated,
          })}
        </Alert>
      ) : (
        <Card className="p-5">
          <form action={formAction} className="flex flex-col gap-4">
            {state.stage === "previewed" ? (
              <>
                <input type="hidden" name="intent" value="commit" />
                <textarea
                  name="csvText"
                  defaultValue={state.csvText}
                  hidden
                  readOnly
                />

                <p className="text-sm">
                  {t("itemsImport.previewSummary", {
                    valid: validCount,
                    total: state.totalRows ?? 0,
                    errors: errorCount,
                  })}
                </p>

                {errorCount > 0 && (
                  <div className="max-h-72 overflow-auto rounded-lg border border-rule">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0">
                        <tr>
                          <Th>{t("itemsImport.row")}</Th>
                          <Th>{t("itemsImport.field")}</Th>
                          <Th>{t("itemsImport.problem")}</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.errors?.map((e, i) => (
                          <tr key={i} className="border-t border-rule">
                            <td className="tabular px-3 py-2">{e.row}</td>
                            <td className="px-3 py-2 font-mono text-xs text-muted">
                              {e.field}
                            </td>
                            <td className="px-3 py-2">
                              {t(`itemsImport.error.${e.message}`)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {validCount > 0 && (
                    <SubmitButton pendingLabel={t("itemsImport.importing")}>
                      {t("itemsImport.confirm", { count: validCount })}
                    </SubmitButton>
                  )}
                  <Link href="/items/import" className={buttonSecondary}>
                    {t("itemsImport.startOver")}
                  </Link>
                </div>
              </>
            ) : (
              <>
                <input type="hidden" name="intent" value="preview" />
                <input
                  type="file"
                  name="file"
                  accept=".csv,text/csv"
                  required
                  className="text-sm"
                />
                <div>
                  <SubmitButton pendingLabel={t("itemsImport.checking")}>
                    {t("itemsImport.upload")}
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
