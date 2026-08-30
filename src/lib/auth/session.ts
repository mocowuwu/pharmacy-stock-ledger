import "server-only";

import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt, ne, or } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { sessions, userPermissions, users } from "@/db/schema";
import { hashToken } from "./password";
import type { Grant } from "./permissions";

export const SESSION_COOKIE = "pharmacy_session";

/** Re-extend a sliding session at most this often, to avoid a write per request. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

function ttlMs(): number {
  const hours = Number(process.env.SESSION_TTL_HOURS ?? 12);
  return (Number.isFinite(hours) && hours > 0 ? hours : 12) * 60 * 60 * 1000;
}

/**
 * A `secure` cookie is only sent over HTTPS. That is right for any deployment
 * reachable from outside, but an on-premise install served over plain HTTP on
 * the clinic LAN would never receive the cookie and nobody could sign in --
 * so it is configurable rather than hardcoded.
 *
 * Setting COOKIE_SECURE=false is a real reduction in security and should be
 * paired with a network nobody else is on. Terminating TLS locally, even with
 * a certificate from a private CA, is the better answer.
 */
function cookieSecure(): boolean {
  const explicit = process.env.COOKIE_SECURE;
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  return process.env.NODE_ENV === "production";
}

export type SessionUser = {
  id: string;
  username: string;
  fullName: string;
  isOwner: boolean;
  isPharmacist: boolean;
  mustChangePassword: boolean;
  locale: "id" | "en";
  tutorialSeenAt: Date | null;
};

export type ActiveSession = {
  sessionId: string;
  user: SessionUser;
  grant: Grant;
};

/**
 * Issues a session. The cookie carries a 256-bit random token; only its SHA-256
 * is stored, so read access to the database yields no usable sessions.
 */
export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlMs());

  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return { token, expiresAt };
}

/**
 * Resolves a token to its user and permission grant, or null.
 *
 * Permission changes take effect on the user's next request rather than their
 * next sign-in, because the grant is read here every time rather than baked
 * into the cookie.
 */
export async function resolveSession(token: string): Promise<ActiveSession | null> {
  const db = await getDb();
  const now = new Date();

  const rows = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      username: users.username,
      fullName: users.fullName,
      isOwner: users.isOwner,
      isPharmacist: users.isPharmacist,
      mustChangePassword: users.mustChangePassword,
      locale: users.locale,
      tutorialSeenAt: users.tutorialSeenAt,
      status: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  // A suspended account's sessions are revoked at suspension, but this is the
  // backstop: a suspended user must never resolve, whatever the session says.
  if (row.status !== "active") return null;

  const granted = await db
    .select({ permission: userPermissions.permission })
    .from(userPermissions)
    .where(eq(userPermissions.userId, row.userId));

  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + ttlMs()) })
      .where(eq(sessions.id, row.sessionId));
  }

  return {
    sessionId: row.sessionId,
    user: {
      id: row.userId,
      username: row.username,
      fullName: row.fullName,
      isOwner: row.isOwner,
      isPharmacist: row.isPharmacist,
      mustChangePassword: row.mustChangePassword,
      locale: row.locale,
      tutorialSeenAt: row.tutorialSeenAt,
    },
    grant: {
      isOwner: row.isOwner,
      permissions: new Set(granted.map((g) => g.permission)),
    },
  };
}

export async function revokeSession(sessionId: string): Promise<void> {
  const db = await getDb();
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

/** Used when suspending an account or resetting a password. */
export async function revokeAllSessions(
  userId: string,
  exceptSessionId?: string,
): Promise<void> {
  const db = await getDb();
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(sessions.userId, userId),
        isNull(sessions.revokedAt),
        // Lets a user change their own password without signing themselves out
        // of the session they are currently using.
        exceptSessionId ? ne(sessions.id, exceptSessionId) : undefined,
      ),
    );
}

/** Housekeeping for the nightly job: expired and revoked rows have no further use. */
export async function purgeDeadSessions(): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(sessions)
    .where(or(lt(sessions.expiresAt, cutoff), lt(sessions.revokedAt, cutoff)))
    .returning({ id: sessions.id });
  return deleted.length;
}

/* ------------------------------------------------------------------ cookies */

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function readSessionCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}
