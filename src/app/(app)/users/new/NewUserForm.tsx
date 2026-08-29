"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Alert, Card, Field, inputClass } from "@/components/ui";
import { PermissionPicker } from "../PermissionPicker";
import { TemporaryPassword } from "../TemporaryPassword";
import { submitNewUser, type NewUserState } from "../actions";

export function NewUserForm() {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState<NewUserState, FormData>(
    submitNewUser,
    {},
  );

  // The password replaces the form rather than appearing beside it. It is shown
  // once, and a form still sitting there invites a second submission.
  if (state.issued) {
    return (
      <TemporaryPassword
        username={state.issued.username}
        fullName={state.issued.fullName}
        password={state.issued.password}
        done={{ href: "/users" }}
      />
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.formError && <Alert>{t(`errors.${state.formError}`)}</Alert>}

      <Card className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label={t("users.fullName")} hint={t("users.fullNameHint")} required>
          <input name="fullName" required autoFocus className={inputClass} />
        </Field>
        <Field label={t("users.username")} hint={t("users.usernameHint")} required>
          <input
            name="username"
            required
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className={`${inputClass} font-mono`}
          />
        </Field>
        <Field label={t("users.locale")}>
          <select name="locale" defaultValue="id" className={inputClass}>
            <option value="id">Bahasa Indonesia</option>
            <option value="en">English</option>
          </select>
        </Field>
        <div className="flex flex-col gap-3">
          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              name="isPharmacist"
              className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
            />
            <span>
              {t("users.pharmacist")}
              <span className="block text-xs text-faint">
                {t("users.pharmacistHint")}
              </span>
            </span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("users.sipa")}>
              <input name="sipaNumber" className={`${inputClass} font-mono`} />
            </Field>
            <Field label={t("users.stra")}>
              <input name="straNumber" className={`${inputClass} font-mono`} />
            </Field>
          </div>
        </div>
      </Card>

      <PermissionPicker initial={[]} showTemplates />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {pending ? t("common.loading") : t("users.create")}
        </button>
        <Link href="/users" className="text-sm text-muted hover:text-accent">
          {t("common.cancel")}
        </Link>
      </div>
    </form>
  );
}
