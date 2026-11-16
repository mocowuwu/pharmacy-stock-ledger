import { can, type Grant, type Permission } from "@/lib/auth/permissions";

/**
 * The Beranda widget catalogue, and the rules for turning an account's saved
 * layout into what it actually sees.
 *
 * Pure on purpose (no database, no session): the same split as `src/lib/stock`.
 *
 * **A layout is a choice of what to show, never a grant.** `visibleWidgets`
 * drops any widget the account has no permission for, and the page fetches data
 * only for what survives -- so the owner listing "takings" on a cashier's
 * dashboard who cannot see sales shows nothing and reads nothing.
 */

export const WIDGETS = [
  "panel_waiting",
  "alerts_summary",
  "takings_today",
  "sales_period",
  "sales_chart",
  "busy_hours",
  "top_products",
  "payment_mix",
  "cashier_sales",
  "expiry_calendar",
  "stock_health",
  "alerts_worklist",
  "recent_sales",
  "money_overview",
  "catalogue_counts",
] as const;

export type WidgetKey = (typeof WIDGETS)[number];

/**
 * The permission an account needs for the widget to render for it.
 *
 * The split follows the reports: what the till already shows a cashier
 * (today's takings, the daily line, their own receipts) needs `sales.create`;
 * who sold what and how it was paid needs `reports.sales`; anything with a
 * cost price in it needs `reports.financial`.
 */
export const WIDGET_PERMISSION: Record<WidgetKey, Permission> = {
  panel_waiting: "panel.approve",
  alerts_summary: "alerts.view",
  takings_today: "sales.create",
  sales_period: "sales.create",
  sales_chart: "sales.create",
  busy_hours: "reports.sales",
  top_products: "reports.sales",
  payment_mix: "reports.sales",
  cashier_sales: "reports.sales",
  expiry_calendar: "alerts.view",
  stock_health: "alerts.view",
  alerts_worklist: "alerts.view",
  recent_sales: "sales.create",
  money_overview: "reports.financial",
  catalogue_counts: "items.view",
};

/**
 * How much of the row a widget takes where the dashboard is wide enough for
 * two columns. Below that every widget is a full row, whatever it says here.
 */
export const WIDGET_SIZE: Record<WidgetKey, "full" | "half"> = {
  panel_waiting: "full",
  alerts_summary: "full",
  takings_today: "full",
  sales_period: "full",
  sales_chart: "full",
  busy_hours: "half",
  top_products: "half",
  payment_mix: "half",
  cashier_sales: "half",
  expiry_calendar: "half",
  stock_health: "half",
  alerts_worklist: "half",
  recent_sales: "half",
  money_overview: "full",
  catalogue_counts: "full",
};

/**
 * Lays the visible widgets out in rows of two halves or one full.
 *
 * A half with no partner -- the next widget is full-width, or there is none --
 * is widened to the whole row instead of sitting beside a hole. Worked out
 * here rather than left to the grid, because which widgets survive depends on
 * the account's permissions and a cashier's dashboard must not look like the
 * owner's with pieces missing.
 */
export function layoutSpans(layout: readonly WidgetKey[]): Array<{ key: WidgetKey; wide: boolean }> {
  const placed: Array<{ key: WidgetKey; wide: boolean }> = [];
  let pending: number | null = null;

  for (const key of layout) {
    if (WIDGET_SIZE[key] === "full") {
      if (pending !== null) placed[pending]!.wide = true;
      pending = null;
      placed.push({ key, wide: true });
    } else if (pending === null) {
      pending = placed.length;
      placed.push({ key, wide: false });
    } else {
      pending = null;
      placed.push({ key, wide: false });
    }
  }
  if (pending !== null) placed[pending]!.wide = true;
  return placed;
}

/**
 * What an account sees until the owner sets its dashboard: everything, in this
 * order, filtered by permission. An account the owner has arranged keeps the
 * list it was given -- a widget added in a later version appears there only
 * when the owner adds it.
 */
export const DEFAULT_LAYOUT: readonly WidgetKey[] = WIDGETS;

const WIDGET_SET: ReadonlySet<string> = new Set(WIDGETS);

export function isWidgetKey(value: string): value is WidgetKey {
  return WIDGET_SET.has(value);
}

export type LayoutRefusal = "unknown_widget" | "duplicate_widget" | "not_owner";

/**
 * Whether a layout may be saved. Only the owner sets dashboards; and a list
 * naming a widget that does not exist, or one twice, is a bug in the caller
 * rather than a preference.
 */
export function refusalToSaveLayout(
  actor: { isOwner: boolean },
  widgets: readonly string[],
): LayoutRefusal | null {
  if (!actor.isOwner) return "not_owner";
  const seen = new Set<string>();
  for (const key of widgets) {
    if (!isWidgetKey(key)) return "unknown_widget";
    if (seen.has(key)) return "duplicate_widget";
    seen.add(key);
  }
  return null;
}

/**
 * Reads a stored list defensively. A widget retired in a later version must
 * not break the page of an account that still lists it, so unknown and
 * repeated keys are dropped rather than refused. `null` is the default layout.
 */
export function resolveLayout(stored: unknown): WidgetKey[] {
  if (!Array.isArray(stored)) return [...DEFAULT_LAYOUT];
  const seen = new Set<WidgetKey>();
  for (const key of stored) {
    if (typeof key === "string" && isWidgetKey(key)) seen.add(key);
  }
  return [...seen];
}

/** The layout, in order, minus whatever this account may not see. */
export function visibleWidgets(layout: readonly WidgetKey[], grant: Grant): WidgetKey[] {
  return layout.filter((key) => can(grant, WIDGET_PERMISSION[key]));
}
