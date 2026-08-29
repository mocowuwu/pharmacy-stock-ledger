import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, type TestDb } from "./helpers/db";
import { users, userPermissions, sessions } from "@/db/schema";
import { hashPassword, hashToken } from "@/lib/auth/password";
import {
  ALL_PERMISSIONS,
  can,
  PERMISSION_TEMPLATES,
  type Grant,
  type Permission,
} from "@/lib/auth/permissions";

let db: TestDb;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
});
afterAll(async () => {
  await close();
});

async function makeUser(opts: {
  username: string;
  isOwner?: boolean;
  permissions?: readonly Permission[];
}) {
  const [user] = await db
    .insert(users)
    .values({
      username: opts.username,
      fullName: opts.username,
      passwordHash: await hashPassword("a-long-enough-password"),
      isOwner: opts.isOwner ?? false,
    })
    .returning({ id: users.id });

  if (opts.permissions?.length) {
    await db.insert(userPermissions).values(
      opts.permissions.map((permission) => ({ userId: user.id, permission })),
    );
  }
  return user.id;
}

/** Mirrors what resolveSession() builds, without needing a cookie store. */
async function grantFor(userId: string): Promise<Grant> {
  const [user] = await db
    .select({ isOwner: users.isOwner })
    .from(users)
    .where(eq(users.id, userId));
  const rows = await db
    .select({ permission: userPermissions.permission })
    .from(userPermissions)
    .where(eq(userPermissions.userId, userId));
  return { isOwner: user.isOwner, permissions: new Set(rows.map((r) => r.permission)) };
}

describe("permission grants", () => {
  it("gives an owner every permission without storing any", async () => {
    const id = await makeUser({ username: "owner", isOwner: true });
    const grant = await grantFor(id);

    expect(grant.permissions.size).toBe(0);
    for (const permission of ALL_PERMISSIONS) {
      expect(can(grant, permission), permission).toBe(true);
    }
  });

  it("gives a cashier exactly the template and nothing more", async () => {
    const id = await makeUser({
      username: "cashier",
      permissions: PERMISSION_TEMPLATES.cashier,
    });
    const grant = await grantFor(id);

    for (const permission of PERMISSION_TEMPLATES.cashier) {
      expect(can(grant, permission), permission).toBe(true);
    }

    const denied = ALL_PERMISSIONS.filter(
      (p) => !(PERMISSION_TEMPLATES.cashier as readonly string[]).includes(p),
    );
    for (const permission of denied) {
      expect(can(grant, permission), permission).toBe(false);
    }
    // The permissions that expose cost, margin and account control.
    expect(can(grant, "reports.financial")).toBe(false);
    expect(can(grant, "users.manage")).toBe(false);
    expect(can(grant, "sales.void")).toBe(false);
  });

  it("withholds financial reporting from the manager template by default", async () => {
    const id = await makeUser({
      username: "manager",
      permissions: PERMISSION_TEMPLATES.manager,
    });
    const grant = await grantFor(id);

    expect(can(grant, "reports.sales")).toBe(true);
    // Cost prices and margins are what most owners would rather not have
    // visible on the shop floor.
    expect(can(grant, "reports.financial")).toBe(false);
    expect(can(grant, "users.manage")).toBe(false);
    expect(can(grant, "settings.manage")).toBe(false);
    expect(can(grant, "audit.view")).toBe(false);
    expect(can(grant, "narkotika.manage")).toBe(false);
  });

  it("reflects a revoked permission on the next request, not the next sign-in", async () => {
    const id = await makeUser({
      username: "clerk",
      permissions: PERMISSION_TEMPLATES.stock_clerk,
    });
    expect(can(await grantFor(id), "stock.dispose")).toBe(true);

    await db
      .delete(userPermissions)
      .where(eq(userPermissions.userId, id));

    // The grant is read per request rather than baked into the session, so no
    // sign-out is needed for a change to take effect.
    expect(can(await grantFor(id), "stock.dispose")).toBe(false);
  });
});

describe("session storage", () => {
  it("stores only a hash of the session token", async () => {
    const id = await makeUser({ username: "session-user" });
    const token = "a-token-that-should-never-be-stored-verbatim";

    await db.insert(sessions).values({
      tokenHash: hashToken(token),
      userId: id,
      expiresAt: new Date(Date.now() + 3_600_000),
    });

    const [row] = await db
      .select({ tokenHash: sessions.tokenHash })
      .from(sessions)
      .where(eq(sessions.userId, id));

    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toBe(hashToken(token));
    expect(row.tokenHash).toHaveLength(64);
  });
});
