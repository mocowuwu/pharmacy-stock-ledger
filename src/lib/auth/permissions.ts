/**
 * The permission catalogue.
 *
 * Owners hold every permission implicitly and are never listed in
 * `user_permissions`. Everyone else holds exactly what has been ticked for
 * them: templates below are a starting point when creating an account, not a
 * fixed role, and every box stays individually editable afterwards.
 */

export const PERMISSION_GROUPS = {
  catalogue: [
    "items.view",
    "items.create",
    "items.edit",
    "items.set_price",
    "items.archive",
    "items.import",
  ],
  stock: [
    "batches.receive",
    "batches.edit",
    "stock.adjust",
    "stock.dispose",
    "stock.count",
    "suppliers.manage",
  ],
  selling: [
    "sales.create",
    "sales.discount",
    "sales.price_override",
    "sales.batch_override",
    "sales.return",
    "sales.void",
    "sales.view_all",
  ],
  alerts: ["alerts.view", "alerts.manage"],
  administration: [
    "reports.sales",
    "reports.financial",
    "narkotika.manage",
    "users.manage",
    "settings.manage",
    "audit.view",
  ],
} as const;

export type PermissionGroup = keyof typeof PERMISSION_GROUPS;

export const ALL_PERMISSIONS = Object.values(PERMISSION_GROUPS).flat();

export type Permission = (typeof PERMISSION_GROUPS)[PermissionGroup][number];

const PERMISSION_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}

/**
 * Permissions that expose cost prices, margins and stock valuation -- what the
 * pharmacy pays and what it makes. Off for managers by default: it is the
 * information most owners would rather not have visible on the shop floor.
 */
export const FINANCIAL_PERMISSIONS: readonly Permission[] = ["reports.financial"];

/**
 * Permissions only an owner should normally hold. Not enforced as a rule --
 * the owner can grant any of these to anyone -- but the users screen warns
 * before handing them out.
 */
export const SENSITIVE_PERMISSIONS: readonly Permission[] = [
  "reports.financial",
  "narkotika.manage",
  "users.manage",
  "settings.manage",
  "audit.view",
  "items.import",
];

/**
 * Starting points offered when creating an account. Chosen to match how the
 * work actually divides: a cashier sells but does not price, a stock clerk
 * receives and counts but does not sell, a manager does both but does not see
 * margins or touch accounts.
 */
export const PERMISSION_TEMPLATES = {
  cashier: [
    "items.view",
    "sales.create",
    "sales.batch_override",
    "alerts.view",
  ],
  stock_clerk: [
    "items.view",
    "items.create",
    "items.edit",
    "batches.receive",
    "stock.adjust",
    "stock.dispose",
    "stock.count",
    "suppliers.manage",
    "alerts.view",
    "alerts.manage",
  ],
  manager: [
    "items.view",
    "items.create",
    "items.edit",
    "items.set_price",
    "items.archive",
    "batches.receive",
    "batches.edit",
    "stock.adjust",
    "stock.dispose",
    "stock.count",
    "suppliers.manage",
    "sales.create",
    "sales.discount",
    "sales.price_override",
    "sales.batch_override",
    "sales.return",
    "sales.void",
    "sales.view_all",
    "alerts.view",
    "alerts.manage",
    "reports.sales",
  ],
} as const satisfies Record<string, readonly Permission[]>;

export type PermissionTemplate = keyof typeof PERMISSION_TEMPLATES;

/** What a signed-in user may do. Owners short-circuit every check. */
export type Grant = { isOwner: boolean; permissions: ReadonlySet<string> };

export function can(grant: Grant, permission: Permission): boolean {
  return grant.isOwner || grant.permissions.has(permission);
}

export function canAny(grant: Grant, permissions: readonly Permission[]): boolean {
  return grant.isOwner || permissions.some((p) => grant.permissions.has(p));
}

export function canAll(grant: Grant, permissions: readonly Permission[]): boolean {
  return grant.isOwner || permissions.every((p) => grant.permissions.has(p));
}
