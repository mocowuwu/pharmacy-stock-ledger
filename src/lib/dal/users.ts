import "server-only";

import { and, asc, count, eq, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { sessions, userPermissions, users } from "@/db/schema";
import { assertPermission } from "./session";
import { recordAudit } from "@/lib/audit";
import { generateTemporaryPassword, hashPassword } from "@/lib/auth/password";
import {
  PERMISSION_TEMPLATES,
  type Permission,
  type PermissionTemplate,
} from "@/lib/auth/permissions";
import {
  cleanPermissions,
  isValidUsername,
  normaliseUsername,
  permissionsToStore,
  refusalToSuspend,
} from "@/lib/accounts/rules";

/**
 * Accounts and what each one may do.
 *
 * Two rules run through everything here, and both exist because of the same
 * failure -- an owner with no way back in:
 *
 * 1. **The owner cannot be suspended, demoted or stripped.** There is exactly
 *    one, they hold every permission implicitly, and nobody above them could
 *    rescue the account. `scripts/reset-password.ts` is the only recovery path
 *    and it needs access to the machine the database runs on.
 * 2. **Nobody can suspend themselves.** An owner is already protected by the
 *    first rule; this catches a manager with `users.manage` locking themselves
 *    out mid-shift.
 *
 * And one rule about passwords, which shapes the whole screen: **the owner
 * issues a temporary password and never learns the working one.** It is shown
 * once, at creation or reset, and the holder must replace it before any other
 * screen will load. Without that, a sale could not honestly be attributed to
 * the cashier who rang it.
 */

export class UserError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "UserError";
  }
}

export type NewUserInput = {
  username: string;
  fullName: string;
  locale: "id" | "en";
  isPharmacist: boolean;
  sipaNumber?: string | null;
  straNumber?: string | null;
  permissions: readonly string[];
};

export type EditUserInput = Omit<NewUserInput, "username">;

/* ------------------------------------------------------------------ reading */

export async function listUsers() {
  await assertPermission("users.manage");
  const db = await getDb();

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      status: users.status,
      isOwner: users.isOwner,
      isPharmacist: users.isPharmacist,
      locale: users.locale,
      mustChangePassword: users.mustChangePassword,
      lastLoginAt: users.lastLoginAt,
      lockedUntil: users.lockedUntil,
      permissions: sql<number>`(
        select count(*)::int from ${userPermissions}
        where ${userPermissions.userId} = ${users.id}
      )`,
    })
    .from(users)
    // The owner first, then everyone else by name: the list reads as the
    // pharmacy is organised rather than by whenever an account was made.
    .orderBy(sql`${users.isOwner} desc`, asc(users.fullName));

  return rows;
}

export async function getUser(id: string) {
  await assertPermission("users.manage");
  const db = await getDb();

  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) return null;

  const granted = await db
    .select({ permission: userPermissions.permission })
    .from(userPermissions)
    .where(eq(userPermissions.userId, id));

  const active = await db
    .select({ count: count() })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, id),
        sql`${sessions.revokedAt} is null`,
        sql`${sessions.expiresAt} > now()`,
      ),
    );

  return {
    ...user,
    // Never returned: passwordHash. Nothing above this layer has a use for it.
    passwordHash: undefined,
    permissions: granted.map((row) => row.permission),
    activeSessions: active[0]?.count ?? 0,
  };
}

/* ----------------------------------------------------------------- writing */

/**
 * Creates an account and returns its one-time password.
 *
 * The caller must show it once and then forget it; it is not stored anywhere in
 * readable form, and there is no way to ask for it again -- only to issue a
 * new one.
 */
export async function createUser(input: NewUserInput) {
  const session = await assertPermission("users.manage");
  const db = await getDb();

  const username = normaliseUsername(input.username);
  if (!isValidUsername(username)) throw new UserError("invalid_username");
  if (!input.fullName.trim()) throw new UserError("name_required");

  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.username}) = ${username}`)
    .limit(1);
  if (existing) throw new UserError("username_taken");

  const temporaryPassword = generateTemporaryPassword();
  const permissions = cleanPermissions(input.permissions);

  const created = await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        username,
        fullName: input.fullName.trim(),
        passwordHash: await hashPassword(temporaryPassword),
        locale: input.locale,
        isPharmacist: input.isPharmacist,
        sipaNumber: input.sipaNumber?.trim() || null,
        straNumber: input.straNumber?.trim() || null,
        // New accounts are never owners. There is one owner, made by the seed.
        isOwner: false,
        mustChangePassword: true,
        createdBy: session.user.id,
      })
      .returning({ id: users.id });

    if (permissions.length > 0) {
      await tx.insert(userPermissions).values(
        permissions.map((permission) => ({
          userId: user.id,
          permission,
          grantedBy: session.user.id,
        })),
      );
    }
    return user;
  });

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "user.created",
    entityType: "users",
    entityId: created.id,
    // The permissions granted are the point of the record; the password is
    // deliberately absent, here and everywhere else.
    after: { username, fullName: input.fullName, permissions },
  });

  return { userId: created.id, username, temporaryPassword };
}

export async function updateUser(id: string, input: EditUserInput) {
  const session = await assertPermission("users.manage");
  const db = await getDb();

  const target = await requireTarget(id);
  const permissions = permissionsToStore(target, input.permissions);

  const before = await db
    .select({ permission: userPermissions.permission })
    .from(userPermissions)
    .where(eq(userPermissions.userId, id));

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        fullName: input.fullName.trim(),
        locale: input.locale,
        isPharmacist: input.isPharmacist,
        sipaNumber: input.sipaNumber?.trim() || null,
        straNumber: input.straNumber?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));

    // The owner holds everything implicitly and is never listed, so writing
    // rows for them would be both meaningless and misleading.
    if (!target.isOwner) {
      await tx.delete(userPermissions).where(eq(userPermissions.userId, id));
      if (permissions.length > 0) {
        await tx.insert(userPermissions).values(
          permissions.map((permission) => ({
            userId: id,
            permission,
            grantedBy: session.user.id,
          })),
        );
      }
    }
  });

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "user.updated",
    entityType: "users",
    entityId: id,
    before: { fullName: target.fullName, permissions: before.map((p) => p.permission) },
    after: { fullName: input.fullName, permissions: target.isOwner ? null : permissions },
  });

  return { userId: id };
}

/**
 * Suspends or reactivates an account.
 *
 * Suspending revokes every live session, so it takes effect at the counter
 * immediately rather than whenever the person next signs in. Nothing is
 * deleted: a suspended account keeps its history and can be brought back.
 */
export async function setUserStatus(id: string, status: "active" | "suspended") {
  const session = await assertPermission("users.manage");
  const db = await getDb();

  const target = await requireTarget(id);

  if (status === "suspended") {
    const refusal = refusalToSuspend(
      { id: session.user.id, isOwner: session.user.isOwner },
      target,
    );
    if (refusal) throw new UserError(refusal);
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ status, updatedAt: new Date() })
      .where(eq(users.id, id));

    if (status === "suspended") {
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, id), sql`${sessions.revokedAt} is null`));
    }
  });

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: status === "suspended" ? "user.suspended" : "user.reactivated",
    entityType: "users",
    entityId: id,
    before: { status: target.status },
    after: { status },
  });

  return { userId: id, status };
}

/**
 * Issues a new temporary password and clears any lockout.
 *
 * Every existing session is revoked: if the reset is because somebody lost
 * control of the account, leaving their sessions alive would defeat it.
 */
export async function resetUserPassword(id: string) {
  const session = await assertPermission("users.manage");
  const db = await getDb();

  const target = await requireTarget(id);
  const temporaryPassword = generateTemporaryPassword();

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));

    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, id), sql`${sessions.revokedAt} is null`));
  });

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "user.password_reset",
    entityType: "users",
    entityId: id,
    after: { username: target.username },
  });

  return { username: target.username, temporaryPassword };
}

/** Signs an account out everywhere, without touching its password. */
export async function revokeUserSessions(id: string) {
  const session = await assertPermission("users.manage");
  const db = await getDb();
  await requireTarget(id);

  const revoked = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, id), sql`${sessions.revokedAt} is null`))
    .returning({ id: sessions.id });

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "user.sessions_revoked",
    entityType: "users",
    entityId: id,
    after: { revoked: revoked.length },
  });

  return { revoked: revoked.length };
}

/* ----------------------------------------------------------------- helpers */

async function requireTarget(id: string) {
  const db = await getDb();
  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      status: users.status,
      isOwner: users.isOwner,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);

  if (!user) throw new UserError("user_not_found");
  return user;
}

/** The starting sets offered when creating an account. */
export function templatePermissions(
  template: PermissionTemplate,
): readonly Permission[] {
  return PERMISSION_TEMPLATES[template];
}

export async function countOwners() {
  const db = await getDb();
  const [row] = await db
    .select({ count: count() })
    .from(users)
    .where(and(eq(users.isOwner, true), ne(users.status, "suspended")));
  return row?.count ?? 0;
}
