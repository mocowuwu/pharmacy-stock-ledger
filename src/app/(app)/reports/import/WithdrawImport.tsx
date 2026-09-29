"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { withdrawImportAction, type WithdrawState } from "./actions";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonSecondarySmall, inputClass } from "@/components/ui";

/**
 * Taking an import back out of the reports.
 *
 * Behind a disclosure and a required reason, like a void: it changes every
 * revenue figure for the months the file covered, and the reason is what the
 * record will say afterwards.
 */
export function WithdrawImport({ importId, importNumber }: { importId: string; importNumber: string }) {
  const t = useTranslations();
  const [state, formAction] = useActionState<WithdrawState, FormData>(withdrawImportAction, {});

  if (state.ok) return null;

  return (
    <details className="group">
      <summary className={`${buttonSecondarySmall} cursor-pointer list-none marker:content-none`}>
        {t("historyImport.withdraw")}
      </summary>
      <form action={formAction} className="mt-3 flex flex-col gap-2 sm:w-80">
        <input type="hidden" name="importId" value={importId} />
        <p className="text-xs text-muted">{t("historyImport.withdrawHint", { number: importNumber })}</p>
        <input
          name="reason"
          required
          maxLength={300}
          placeholder={t("historyImport.withdrawReason")}
          aria-label={t("historyImport.withdrawReason")}
          className={`${inputClass} py-1.5 text-sm`}
        />
        {state.error && <p className="text-xs text-critical">{t(`errors.${state.error}`)}</p>}
        <div>
          <SubmitButton pendingLabel={t("historyImport.withdrawing")}>
            {t("historyImport.withdrawConfirm")}
          </SubmitButton>
        </div>
      </form>
    </details>
  );
}
