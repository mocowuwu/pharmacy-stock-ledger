import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { LOCALE_COOKIE } from "@/i18n/config";
import { isSafeNextPath } from "@/lib/auth/redirect";
import { redeemHandoff } from "@/lib/offline/devices";
import { clientIp } from "@/lib/auth/sign-in";

/**
 * Where the app sends its browser after a sign-in on its own screen. Spends
 * the one-minute code and answers with an ordinary website session, so from
 * here on the app is simply showing the website.
 *
 * The code travels in the URL because a navigation cannot carry a header. It
 * is single-use and dies in a minute, so the copy left in the browser history
 * opens nothing.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  const next = url.searchParams.get("next") ?? "";

  const redeemed = code ? await redeemHandoff(await getDb(), code) : null;
  if (!redeemed) redirect("/login");
  const { user, device } = redeemed;

  const { token, expiresAt } = await createSession(user.id, {
    ip: await clientIp(),
    userAgent: (await headers()).get("user-agent"),
  });
  await setSessionCookie(token, expiresAt);
  (await cookies()).set(LOCALE_COOKIE, user.locale, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  await recordAudit({
    userId: user.id,
    actorLabel: user.username,
    action: "device.handoff",
    entityType: "devices",
    entityId: device.id,
  });

  if (user.mustChangePassword) redirect("/change-password");
  redirect(isSafeNextPath(next) ? next : device.role === "till" ? "/sell" : "/");
}
