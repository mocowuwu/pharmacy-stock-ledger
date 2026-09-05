"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { signIn, type SignInState } from "./actions";
import { Alert, buttonPrimaryLarge, inputClass } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const t = useTranslations("auth");
  const [state, formAction, pending] = useActionState<SignInState, FormData>(
    signIn,
    {},
  );

  const message =
    state.error === "invalid"
      ? t("invalidCredentials")
      : state.error === "suspended"
        ? t("accountSuspended")
        : state.error === "locked"
          ? t("tooManyAttempts", { minutes: state.minutes ?? 15 })
          : null;

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="next" value={next} />

      {message && <Alert tone="critical">{message}</Alert>}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-muted">{t("username")}</span>
        <input
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          required
          autoFocus
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-muted">{t("password")}</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className={`mt-1 ${buttonPrimaryLarge}`}
      >
        {pending ? t("signingIn") : t("signIn")}
      </button>
    </form>
  );
}
