import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { dashboardLayouts, users } from "@/db/schema";
import { refusalToSaveLayout, resolveLayout, type WidgetKey } from "./widgets";

/**
 * Reading and writing an account's dashboard layout, against an executor and
 * with no session -- the DAL adds the permission and the audit around it.
 */

export class DashboardError extends Error {
  constructor(readonly code: "unknown_widget" | "duplicate_widget" | "not_owner" | "user_not_found") {
    super(code);
    this.name = "DashboardError";
  }
}

/** The stored list, or null when the account is on the default layout. */
export async function storedLayout(ex: Database, userId: string): Promise<string[] | null> {
  const [row] = await ex
    .select({ widgets: dashboardLayouts.widgets })
    .from(dashboardLayouts)
    .where(eq(dashboardLayouts.userId, userId))
    .limit(1);
  return row?.widgets ?? null;
}

export async function layoutFor(ex: Database, userId: string): Promise<WidgetKey[]> {
  return resolveLayout(await storedLayout(ex, userId));
}

/**
 * Sets an account's layout, or returns it to the default with `null`.
 * Returns what was stored before, for the audit entry.
 *
 * Resetting writes null rather than deleting the row: nothing here is purged,
 * and the row keeps who last decided.
 */
export async function saveLayout(
  ex: Database,
  actor: { id: string; isOwner: boolean },
  userId: string,
  widgets: readonly string[] | null,
): Promise<{ before: string[] | null }> {
  const refusal = refusalToSaveLayout(actor, widgets ?? []);
  if (refusal) throw new DashboardError(refusal);

  const [target] = await ex.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!target) throw new DashboardError("user_not_found");

  const before = await storedLayout(ex, userId);
  const now = new Date();
  await ex
    .insert(dashboardLayouts)
    .values({ userId, widgets: widgets ? [...widgets] : null, updatedBy: actor.id, updatedAt: now })
    .onConflictDoUpdate({
      target: dashboardLayouts.userId,
      set: { widgets: widgets ? [...widgets] : null, updatedBy: actor.id, updatedAt: now },
    });
  return { before };
}
