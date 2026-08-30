"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Alert, Card, Field, buttonPrimary, buttonSecondary, inputClass } from "@/components/ui";
import { PermissionPicker } from "../PermissionPicker";
import { TemporaryPassword } from "../TemporaryPassword";
import { issueNewPassword, submitEditUser, type EditUserState } from "../actions";

export type EditableUser = {
  id: string;
  username: string;
  fullName: string;
  locale: "id" | "en";
  isOwner: boolean;
  isPharmacist: boolean;
  sipaNumber: string | null;
  straNumber: string | null;
  permissions: string[];
};

export function EditUserForm({ user }: { user: EditableUser }) {
  const t = useTranslations();
  const [state, formAction, pending] = useActionState<EditUserState, FormData>(
    submitEditUser,
    {},
  );
  const [reset, resetAction, resetting] = useActionState<EditUserState, FormData>(
    issueNewPassword,
    {},
  );

  if (reset.issued) {
    return (
      <TemporaryPassword
        username={reset.issued.username}
        fullName={reset.issued.fullName}
        password={reset.issued.password}
        done={{ href: `/users/${user.id}` }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-6">
        <input type="hidden" name="userId" value={user.id} />

        {state.formError && <Alert>{t(`errors.${state.formError}`)}</Alert>}
        {state.saved && <Alert tone="notice">{t("users.updated")}</Alert>}

        <Card className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label={t("users.fullName")} required>
            <input
              name="fullName"
              required
              defaultValue={user.fullName}
              className={inputClass}
            />
          </Field>
          {/* Renaming only changes how the account signs in from now on: past
              audit entries keep the username as it was typed at the time,
              since actorLabel is a snapshot rather than a live join. */}
          <Field label={t("users.username")} hint={t("users.usernameHint")} required>
            <input
              name="username"
              required
              defaultValue={user.username}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className={`${inputClass} font-mono`}
            />
          </Field>
          <Field label={t("users.locale")}>
            <select name="locale" defaultValue={user.locale} className={inputClass}>
              <option value="id">Bahasa Indonesia</option>
              <option value="en">English</option>
            </select>
          </Field>
          <div className="flex flex-col gap-3">
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                name="isPharmacist"
                defaultChecked={user.isPharmacist}
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
                <input
                  name="sipaNumber"
                  defaultValue={user.sipaNumber ?? ""}
                  className={`${inputClass} font-mono`}
                />
              </Field>
              <Field label={t("users.stra")}>
                <input
                  name="straNumber"
                  defaultValue={user.straNumber ?? ""}
                  className={`${inputClass} font-mono`}
                />
              </Field>
            </div>
          </div>
        </Card>

        {/* The owner's permissions are not editable, because they are not
            stored: every box would be ticked and none of them could be cleared. */}
        {user.isOwner ? (
          <Alert tone="notice">{t("users.ownerNotice")}</Alert>
        ) : (
          <PermissionPicker initial={user.permissions} />
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className={buttonPrimary}
          >
            {pending ? t("common.loading") : t("users.save")}
          </button>
          <Link href="/users" className="text-sm text-muted hover:text-accent">
            {t("users.backToList")}
          </Link>
        </div>
      </form>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <h2 className="font-medium">{t("users.resetPassword")}</h2>
          <p className="mt-1 text-sm text-muted">{t("users.resetHint")}</p>
        </div>
        <form action={resetAction}>
          <input type="hidden" name="userId" value={user.id} />
          <input type="hidden" name="fullName" value={user.fullName} />
          <button
            type="submit"
            disabled={resetting}
            className={buttonSecondary}
          >
            {resetting ? t("common.loading") : t("users.resetConfirm")}
          </button>
        </form>
      </Card>

      {reset.formError && <Alert>{t(`errors.${reset.formError}`)}</Alert>}
    </div>
  );
}
