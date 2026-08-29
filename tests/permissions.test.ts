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
import {
  isReportSlug,
  REPORTS,
  REPORT_PERMISSION,
  resolveRange,
} from "@/lib/reports/catalogue";

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

describe("report permissions", () => {
  it("puts every report that exposes cost behind reports.financial", async () => {
    const id = await makeUser({
      username: "sales-only",
      permissions: ["reports.sales"],
    });
    const grant = await grantFor(id);

    // What sold, yes. What it cost, no -- that is the whole point of the split,
    // and this asserts the routing map has not drifted away from it.
    expect(can(grant, REPORT_PERMISSION.sales)).toBe(true);
    for (const slug of ["margin", "valuation", "expiry", "suppliers"] as const) {
      expect(REPORT_PERMISSION[slug], slug).toBe("reports.financial");
      expect(can(grant, REPORT_PERMISSION[slug]), slug).toBe(false);
    }
  });

  it("names a permission for every report and refuses an unknown slug", () => {
    for (const slug of REPORTS) {
      expect(REPORT_PERMISSION[slug], slug).toBeDefined();
      expect(isReportSlug(slug)).toBe(true);
    }
    expect(isReportSlug("everything")).toBe(false);
    expect(isReportSlug("../../etc/passwd")).toBe(false);
  });
});

describe("report periods", () => {
  const on = "2026-03-15";

  it("resolves each preset to a window ending today", () => {
    expect(resolveRange({ preset: "today", on })).toMatchObject({
      from: "2026-03-15",
      to: "2026-03-15",
    });
    expect(resolveRange({ preset: "7d", on })).toMatchObject({ from: "2026-03-09" });
    expect(resolveRange({ preset: "30d", on })).toMatchObject({ from: "2026-02-14" });
    expect(resolveRange({ preset: "month", on })).toMatchObject({
      from: "2026-03-01",
      to: "2026-03-15",
    });
  });

  it("ends last month on its own last day, whatever its length", () => {
    // February 2026 has 28 days. Subtracting a fixed 30 would land in January.
    expect(resolveRange({ preset: "lastMonth", on })).toMatchObject({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    // And across a year boundary.
    expect(resolveRange({ preset: "lastMonth", on: "2026-01-10" })).toMatchObject({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("swaps a range typed the wrong way round instead of returning nothing", () => {
    expect(resolveRange({ from: "2026-03-31", to: "2026-03-01" })).toMatchObject({
      from: "2026-03-01",
      to: "2026-03-31",
      preset: "custom",
    });
  });

  it("falls back to a sensible window rather than failing on a bad URL", () => {
    expect(resolveRange({ preset: "last-fortnight", on }).preset).toBe("30d");
    expect(resolveRange({ from: "yesterday", to: "today", on }).preset).toBe("30d");
  });
});
