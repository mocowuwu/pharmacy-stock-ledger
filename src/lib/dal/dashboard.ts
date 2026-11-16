import "server-only";

import { asc, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { userPermissions, users } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { assertPermission, assertSession } from "./session";
import { getSettings } from "./settings";
import { today } from "@/lib/format/date";
import { readAlertConfig } from "@/lib/alerts/config";
import * as reports from "@/lib/reports/queries";
import { previousRange } from "@/lib/reports/catalogue";
import { expiryCalendar, stockHealth, trailingRange } from "@/lib/dashboard/queries";
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

/* ------------------------------------------------------- what the widgets read */

/**
 * How many days the dashboard's "recent" widgets look back over. One window
 * for all of them, so the best-seller list and the payment split describe the
 * same month and can be read against each other.
 */
export const DASHBOARD_DAYS = 30;

/**
 * Who sold what, when and how it was paid, over the last 30 days.
 *
 * `reports.sales`, like the report it is a corner of. Each part is fetched
 * only when its widget will be drawn: `itemSales` in particular is the
 * heaviest query in the project, and a dashboard that does not show the
 * best-seller list must not pay for it.
 */
export async function dashboardSales(want: {
  hours: boolean;
  products: boolean;
  payments: boolean;
  cashiers: boolean;
}) {
  await assertPermission("reports.sales");
  const db = await getDb();
  const { timezone } = await getSettings();
  const options = { ...trailingRange(today(), DASHBOARD_DAYS), timezone };

  return {
    byHour: want.hours ? await reports.salesByHour(db, options) : [],
    // Ranked on what the pharmacy kept from each product, not on units: a
    // strip of paracetamol outsells an inhaler twenty to one and earns less.
    topProducts: want.products
      ? (await reports.itemSales(db, options))
          .filter((row) => row.revenueNet > 0)
          .sort((a, b) => b.revenueNet - a.revenueNet)
          .slice(0, 6)
          .map((row) => ({
            key: row.key,
            itemId: row.itemId,
            name: row.name,
            strength: row.strength,
            unit: row.unit,
            qty: row.qtyNet,
            revenue: row.revenueNet,
          }))
      : [],
    byPayment: want.payments ? await reports.salesByPaymentMethod(db, options) : [],
    byCashier: want.cashiers ? await reports.salesByCashier(db, options) : [],
  };
}

/**
 * The shelf: what expires when, and how much of the catalogue is in trouble.
 * Batch counts and item counts only -- no cost price -- so `alerts.view`.
 */
export async function dashboardStock(want: { calendar: boolean; health: boolean; rules: boolean }) {
  await assertPermission("alerts.view");
  const db = await getDb();
  await getSettings(); // adopts the pharmacy's timezone before `today()` is read

  const config = want.calendar || want.rules ? await readAlertConfig(db) : null;
  return {
    calendar:
      want.calendar && config
        ? await expiryCalendar(db, { on: today(), thresholds: config.thresholds, rules: config.rules })
        : null,
    health: want.health ? await stockHealth(db) : null,
    rules: config?.rules ?? null,
  };
}

/**
 * What it cost and what is tied up on the shelf: `reports.financial`, and
 * fetched for nobody else.
 */
export async function dashboardMoney() {
  await assertPermission("reports.financial");
  const db = await getDb();
  const { timezone } = await getSettings();
  const range = trailingRange(today(), DASHBOARD_DAYS);
  const options = { ...range, timezone };
  const previous = { ...previousRange(range), timezone };

  const byCategory = await reports.valuationByCategory(db);
  return {
    margin: await reports.marginSummary(db, options),
    previousMargin: await reports.marginSummary(db, previous),
    stockValue: byCategory.reduce((sum, row) => sum + row.value, 0),
    expiryLoss: (await reports.expiryLoss(db, options)).reduce((sum, row) => sum + row.value, 0),
    atRisk: await reports.valuationByExpiry(db, today()),
  };
}
