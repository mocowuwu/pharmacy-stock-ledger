/**
 * Issuing a temporary password from the machine the database runs on.
 *
 * Shared by `reset-password.ts` (a terminal) and `accounts.ts` (the control
 * panel), so the two recovery paths cannot drift apart: both do exactly what
 * the Users screen does -- a new temporary password, a forced change at next
 * sign-in, every session revoked, the lockout cleared, and an audit row that
 * says which door it came through.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "../src/db/client";
import { auditLog, sessions, users } from "../src/db/schema";
import { generateTemporaryPassword, hashPassword } from "../src/lib/auth/password";

export type ResetResult = {
  username: string;
  isOwner: boolean;
  temporaryPassword: string;
  sessionsRevoked: number;
};

export async function resetPasswordByUsername(
  db: Database,
  username: string,
  via: string,
): Promise<ResetResult | null> {
  const [user] = await db
    .select({ id: users.id, username: users.username, isOwner: users.isOwner })
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username})`)
    .limit(1);

  if (!user) return null;

  const temporaryPassword = generateTemporaryPassword();
  // Hashed outside the transaction: argon2 takes a noticeable fraction of a
  // second, and nothing about it needs a row held.
  const passwordHash = await hashPassword(temporaryPassword);

  const sessionsRevoked = await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        passwordHash,
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));

    // Anyone holding a session for this account is signed out, which is the
    // point: a reset is also how you evict someone.
    const revoked = await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });

    // There is no signed-in person here to attribute it to -- whoever is at
    // the machine is acting as the account being reset, and the row says
    // which door they came through.
    await tx.insert(auditLog).values({
      userId: user.id,
      actorLabel: user.username,
      action: "auth.password.reset",
      entityType: "users",
      entityId: user.id,
      after: { via, sessionsRevoked: revoked.length },
    });

    return revoked.length;
  });

  return {
    username: user.username,
    isOwner: user.isOwner,
    temporaryPassword,
    sessionsRevoked,
  };
}
