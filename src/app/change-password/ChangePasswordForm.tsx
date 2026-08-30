"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { changePassword, type ChangePasswordState } from "./actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { buttonPrimaryLarge } from "@/components/ui";

export function ChangePasswordForm() {
  const t = useTranslations("auth");
  const [state, formAction, pending] = useActionState<ChangePasswordState, FormData>(
    changePassword,
    {},
  );

  const label: Record<string, string> = {
    wrong_current: t("invalidCredentials"),
    mismatch: t("passwordMismatch"),
    too_short: t("passwordTooShort", { min: MIN_PASSWORD_LENGTH }),
    too_common: t("passwordTooCommon"),
    same_as_username: t("passwordSameAsUsername"),
    same_as_current: t("passwordSameAsCurrent"),
  };

  const field =
    "w-full rounded-lg border border-rule bg-surface px-3 py-2 text-base outline-none focus:border-accent";

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {state.problems && state.problems.length > 0 && (
        <ul
          role="alert"
          className="flex list-disc flex-col gap-1 rounded-lg border border-critical/30 bg-critical-soft px-3 py-2 pl-6 text-sm text-critical"
        >
          {state.problems.map((p) => (
            <li key={p}>{label[p] ?? p}</li>
          ))}
        </ul>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-muted">{t("currentPassword")}</span>
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          autoFocus
          className={field}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-muted">{t("newPassword")}</span>
        <input
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          className={field}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-muted">{t("confirmPassword")}</span>
        <input
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          className={field}
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className={`mt-1 ${buttonPrimaryLarge}`}
      >
        {t("changePasswordTitle")}
      </button>
    </form>
  );
}
