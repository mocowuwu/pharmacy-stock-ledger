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
  "sales_chart",
  "catalogue_counts",
] as const;

export type WidgetKey = (typeof WIDGETS)[number];

/** The permission an account needs for the widget to render for it. */
export const WIDGET_PERMISSION: Record<WidgetKey, Permission> = {
  panel_waiting: "panel.approve",
  alerts_summary: "alerts.view",
  takings_today: "sales.create",
  sales_chart: "sales.create",
  catalogue_counts: "items.view",
};

/**
 * What an account sees until the owner sets its dashboard: everything, in the
 * order the single shared dashboard always had, filtered by permission.
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
