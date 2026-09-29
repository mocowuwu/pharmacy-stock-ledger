"use server";

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { authenticate, clientIp } from "@/lib/auth/sign-in";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { AuthEvents, recordAudit } from "@/lib/audit";
import { LOCALE_COOKIE } from "@/i18n/config";
import { isSafeNextPath } from "@/lib/auth/redirect";

export type SignInState = {
  error?: "invalid" | "suspended" | "locked";
  minutes?: number;
};

export async function signIn(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");
  const ip = await clientIp();

  const result = await authenticate({ username, password, ip });
  if (!result.ok) return { error: result.error, minutes: result.minutes };
  const { user } = result;

  const { token, expiresAt } = await createSession(user.id, {
    ip,
    userAgent: (await headers()).get("user-agent"),
  });
  await setSessionCookie(token, expiresAt);

  // Mirror the stored language preference so rendering needs no query for it.
  (await cookies()).set(LOCALE_COOKIE, user.locale, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  await recordAudit({
    action: AuthEvents.signInSucceeded,
    userId: user.id,
    actorLabel: user.username,
  });

  if (user.mustChangePassword) redirect("/change-password");
  // Checked again here, not only on the page: the form field is the client's to
  // change, and a server action is as reachable as any route.
  redirect(isSafeNextPath(next) ? next : "/");
}
