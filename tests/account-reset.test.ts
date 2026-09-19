import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLog, sessions, users } from "@/db/schema";
import type { Database } from "@/db/client";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { resetPasswordByUsername } from "../scripts/account-reset";
import { createTestDb, type TestDb } from "./helpers/db";

/**
 * The control panel's "Kata sandi" section and `reset-password.ts` both go
 * through this. It is the only way to recover the owner, so it has to do all
 * of what the Users screen's reset does -- not most of it.
 */
describe("resetting a password from the machine", () => {
  let db: TestDb;
  let close: () => Promise<void>;
  let ownerId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    const [owner] = await db
      .insert(users)
      .values({
        username: "pemilik",
        fullName: "Pemilik Apotek",
        passwordHash: await hashPassword("the-old-password-1"),
        isOwner: true,
        mustChangePassword: false,
        failedLoginCount: 7,
        lockedUntil: new Date(Date.now() + 60 * 60 * 1000),
      })
      .returning({ id: users.id });
    ownerId = owner.id;
    await db.insert(sessions).values({
      tokenHash: "live-session",
      userId: ownerId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
  });

  afterAll(() => close());

  it("issues a working temporary password, forces a change, and clears the lockout", async () => {
    const result = await resetPasswordByUsername(db as unknown as Database, "PEMILIK", "control panel");
    expect(result).not.toBeNull();
    expect(result!.isOwner).toBe(true);
    expect(result!.sessionsRevoked).toBe(1);

    const [row] = await db.select().from(users).where(eq(users.id, ownerId));
    expect(await verifyPassword(row.passwordHash, result!.temporaryPassword)).toBe(true);
    expect(await verifyPassword(row.passwordHash, "the-old-password-1")).toBe(false);
    expect(row.mustChangePassword).toBe(true);
    expect(row.failedLoginCount).toBe(0);
    expect(row.lockedUntil).toBeNull();

    const [session] = await db.select().from(sessions).where(eq(sessions.userId, ownerId));
    expect(session.revokedAt).not.toBeNull();
  });

  it("records which door the reset came through", async () => {
    const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, ownerId));
    expect(rows.at(-1)?.action).toBe("auth.password.reset");
    expect(rows.at(-1)?.after).toMatchObject({ via: "control panel" });
  });

  it("answers null for an account that does not exist", async () => {
    expect(await resetPasswordByUsername(db as unknown as Database, "nobody", "test")).toBeNull();
  });
});
