"use server";

import { and, eq, gte, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { getDb } from "@/db";
import { auditLog, users } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSession, setSessionCookie } from "@/lib/auth/session";
import { AuthEvents, recordAudit } from "@/lib/audit";
import { LOCALE_COOKIE } from "@/i18n/config";

export type SignInState = {
  error?: "invalid" | "suspended" | "locked";
  minutes?: number;
};

const MAX_USER_ATTEMPTS = 5;
const USER_LOCK_MINUTES = 15;
const MAX_IP_ATTEMPTS = 20;
const IP_WINDOW_MINUTES = 15;

/**
 * A hash of a value nobody knows, verified against when the username does not
 * exist. Without it, a missing account returns noticeably faster than a wrong
 * password and the sign-in form becomes a way to enumerate staff usernames.
 */
let decoyHash: string | null = null;
async function getDecoyHash(): Promise<string> {
  decoyHash ??= await hashPassword(
    `decoy-${Math.random()}-${Date.now()}-not-a-real-password`,
  );
  return decoyHash;
}

async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}

/**
 * Counts recent failures from one address. Uses the audit log rather than a
 * dedicated table: every attempt is already recorded there with its IP, and a
 * second store of the same facts could only drift from the first.
 */
async function recentFailuresFromIp(ip: string | null): Promise<number> {
  if (!ip) return 0;
  const db = await getDb();
  const since = new Date(Date.now() - IP_WINDOW_MINUTES * 60_000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.action, AuthEvents.signInFailed),
        eq(auditLog.ip, ip),
        gte(auditLog.createdAt, since),
      ),
    );
  return row?.n ?? 0;
}

export async function signIn(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");
  const ip = await clientIp();

  if (!username || !password) return { error: "invalid" };

  if ((await recentFailuresFromIp(ip)) >= MAX_IP_ATTEMPTS) {
    await recordAudit({
      action: AuthEvents.signInBlocked,
      actorLabel: username,
      after: { reason: "ip_rate_limit" },
    });
    return { error: "locked", minutes: IP_WINDOW_MINUTES };
  }

  const db = await getDb();
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username})`)
    .limit(1);

  if (!user) {
    // Spend the same time as a real verification before answering.
    await verifyPassword(await getDecoyHash(), password);
    await recordAudit({ action: AuthEvents.signInFailed, actorLabel: username });
    return { error: "invalid" };
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.max(
      1,
      Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000),
    );
    await recordAudit({
      action: AuthEvents.signInBlocked,
      userId: user.id,
      actorLabel: username,
      after: { reason: "account_locked" },
    });
    return { error: "locked", minutes };
  }

  const ok = await verifyPassword(user.passwordHash, password);

  if (!ok) {
    const failed = user.failedLoginCount + 1;
    const locked = failed >= MAX_USER_ATTEMPTS;
    await db
      .update(users)
      .set({
        failedLoginCount: locked ? 0 : failed,
        lockedUntil: locked ? new Date(Date.now() + USER_LOCK_MINUTES * 60_000) : null,
      })
      .where(eq(users.id, user.id));
    await recordAudit({
      action: AuthEvents.signInFailed,
      userId: user.id,
      actorLabel: username,
      after: { attempt: failed, locked },
    });
    return locked
      ? { error: "locked", minutes: USER_LOCK_MINUTES }
      : { error: "invalid" };
  }

  // Suspension is checked after the password, so a suspended account cannot be
  // distinguished from a wrong password by someone guessing.
  if (user.status !== "active") {
    await recordAudit({
      action: AuthEvents.signInBlocked,
      userId: user.id,
      actorLabel: username,
      after: { reason: "suspended" },
    });
    return { error: "suspended" };
  }

  await db
    .update(users)
    .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
    .where(eq(users.id, user.id));

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
  redirect(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
}
