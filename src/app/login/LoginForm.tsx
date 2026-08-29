"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { signIn, type SignInState } from "./actions";

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

      {message && (
        <p
          role="alert"
          className="rounded-lg border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical"
        >
          {message}
        </p>
      )}

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
          className="w-full rounded-lg border border-rule bg-surface px-3 py-2 text-base outline-none focus:border-accent"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-muted">{t("password")}</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full rounded-lg border border-rule bg-surface px-3 py-2 text-base outline-none focus:border-accent"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-lg bg-accent px-4 py-2.5 font-medium text-accent-contrast disabled:opacity-60"
      >
        {pending ? t("signingIn") : t("signIn")}
      </button>
    </form>
  );
}
