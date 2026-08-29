/**
 * Issues a new temporary password for an account, and clears any lockout.
 *
 * This is the recovery path for the one account nobody else can rescue: the
 * owner. Every other account can be reset by the owner from the Users screen,
 * but if the owner is locked out there is no one above them -- so it has to be
 * possible from the machine the database runs on.
 *
 * It does exactly what the Users screen will do: issue a temporary password,
 * force a change at next sign-in, revoke every existing session, and record it
 * in the audit log. It cannot read the existing password, because nothing can.
 *
 *   npx tsx scripts/reset-password.ts <username>
 */
import "./env";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDbHandle } from "../src/db/client";
import { auditLog, sessions, users } from "../src/db/schema";
import { generateTemporaryPassword, hashPassword } from "../src/lib/auth/password";

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error("usage: reset-password.ts <username>");
    process.exit(1);
  }

  const { db, close } = await getDbHandle();

  const [user] = await db
    .select({ id: users.id, username: users.username, isOwner: users.isOwner })
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username})`)
    .limit(1);

  if (!user) {
    console.error(`No account named "${username}".`);
    await close();
    process.exit(1);
  }

  const temporary = generateTemporaryPassword();

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(temporary),
      mustChangePassword: true,
      failedLoginCount: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  // Anyone holding a session for this account is signed out, which is the
  // point: a reset is also how you evict someone.
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });

  await db.insert(auditLog).values({
    userId: user.id,
    actorLabel: user.username,
    action: "auth.password.reset",
    entityType: "users",
    entityId: user.id,
    after: { via: "reset-password script", sessionsRevoked: revoked.length },
  });

  console.log("\n" + "=".repeat(58));
  console.log(`  Password reset for ${user.username}${user.isOwner ? " (owner)" : ""}`);
  console.log("=".repeat(58));
  console.log(`  Temporary password : ${temporary}`);
  console.log(`  Sessions revoked   : ${revoked.length}`);
  console.log("=".repeat(58));
  console.log("  Shown once. You will be asked to replace it at sign-in.");
  console.log("=".repeat(58) + "\n");

  await close();
}

main().catch((e) => { console.error(e); process.exit(1); });
