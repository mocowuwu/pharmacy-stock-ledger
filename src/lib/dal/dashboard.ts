import "server-only";

import { asc, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { userPermissions, users } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { assertSession } from "./session";
import { DashboardError, layoutFor, saveLayout, storedLayout } from "@/lib/dashboard/layouts";
import { resolveLayout, visibleWidgets, WIDGETS, type WidgetKey } from "@/lib/dashboard/widgets";

/**
 * Each account's own Beranda.
 *
 * Reading your own layout needs only a session -- it is what draws the first
 * screen. **Setting anyone's layout is the owner's alone**, not a permission
 * that can be handed out: what each person's first screen holds is the
 * owner's decision about the pharmacy, in the same way the owner alone
 * manages the owner's account. The check is on the account's `isOwner` flag
 * and not on `settings.manage`, which a manager can hold.
 */

async function assertOwner() {
  const session = await assertSession();
  if (!session.user.isOwner) throw new DashboardError("not_owner");
  return session;
}

/** The signed-in account's layout, in order, before permissions are applied. */
export async function myLayout(): Promise<WidgetKey[]> {
  const session = await assertSession();
  return layoutFor(await getDb(), session.user.id);
}

export type DashboardAccount = {
  id: string;
  fullName: string;
  username: string;
  isOwner: boolean;
  status: "active" | "suspended";
  /** Null when the account is on the default layout. */
  custom: WidgetKey[] | null;
  /** What this account's permissions would let it see, whatever is listed. */
  allowed: WidgetKey[];
};

/** Every account with its layout and what it may see. Owner only. */
export async function dashboardAccounts(): Promise<DashboardAccount[]> {
  await assertOwner();
  const db = await getDb();

  const accounts = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      username: users.username,
      isOwner: users.isOwner,
      status: users.status,
    })
    .from(users)
    .orderBy(sql`${users.isOwner} desc`, asc(users.fullName));

  const granted = await db
    .select({ userId: userPermissions.userId, permission: userPermissions.permission })
    .from(userPermissions);
  const byUser = new Map<string, Set<string>>();
  for (const row of granted) {
    const set = byUser.get(row.userId) ?? new Set<string>();
    set.add(row.permission);
    byUser.set(row.userId, set);
  }

  return Promise.all(
    accounts.map(async (account): Promise<DashboardAccount> => {
      const stored = await storedLayout(db, account.id);
      const grant = { isOwner: account.isOwner, permissions: byUser.get(account.id) ?? new Set<string>() };
      const everything = visibleWidgets(WIDGETS, grant);
      return {
        ...account,
        custom: stored === null ? null : resolveLayout(stored),
        allowed: everything,
      };
    }),
  );
}

/** Sets an account's dashboard, or returns it to the default with `null`. */
export async function setDashboard(userId: string, widgets: string[] | null) {
  const session = await assertOwner();
  const db = await getDb();

  await db.transaction(async (tx) => {
    const { before } = await saveLayout(
      tx as unknown as typeof db,
      { id: session.user.id, isOwner: session.user.isOwner },
      userId,
      widgets,
    );
    await recordAudit(
      {
        userId: session.user.id,
        actorLabel: session.user.username,
        action: "dashboard.set",
        entityType: "user",
        entityId: userId,
        before: { widgets: before },
        after: { widgets },
      },
      tx as unknown as typeof db,
    );
  });
}
