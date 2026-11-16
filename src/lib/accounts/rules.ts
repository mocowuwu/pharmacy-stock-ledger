import {
  ALL_PERMISSIONS,
  isPermission,
  type Permission,
} from "@/lib/auth/permissions";

/**
 * The rules about accounts, as pure functions.
 *
 * They live here rather than inside the data access layer for the same reason
 * the ledger and the till do: anything welded to a session cannot be tested,
 * and these are precisely the rules worth testing. Every one of them exists to
 * prevent the same outcome -- a pharmacy nobody can get into.
 */

export type AccountRefusal =
  | "cannot_suspend_owner"
  | "cannot_suspend_self"
  | "cannot_manage_owner"
  | "invalid_username"
  | "name_required"
  | "user_not_found";

export type Actor = { id: string; isOwner: boolean };
export type Target = { id: string; isOwner: boolean; status: "active" | "suspended" };

/**
 * Whether an account may be suspended.
 *
 * Two refusals, both about lockout. The owner is the account nobody above can
 * rescue -- recovery needs `scripts/reset-password.ts` and access to the
 * machine. And nobody suspends themselves: an owner is already covered, but a
 * manager holding `users.manage` could otherwise end their own shift by
 * accident.
 */
export function refusalToSuspend(actor: Actor, target: Target): AccountRefusal | null {
  if (target.isOwner) return "cannot_suspend_owner";
  if (target.id === actor.id) return "cannot_suspend_self";
  return null;
}

/**
 * Whether an account may be edited, reset or signed out by this actor.
 *
 * Only the owner touches the owner. `users.manage` can be granted to a
 * manager, and without this it reached the owner's account like any other:
 * a manager could issue the owner a temporary password, sign in with it, and
 * *be* the owner -- the one account that cannot be suspended, demoted or
 * stripped -- while the real owner was locked out and needed the server
 * machine to get back in.
 */
export function refusalToManage(actor: Actor, target: { isOwner: boolean }): AccountRefusal | null {
  if (target.isOwner && !actor.isOwner) return "cannot_manage_owner";
  return null;
}

/** Usernames are lowercase, so the audit log cannot show "Budi" and "budi". */
export function normaliseUsername(input: string): string {
  return input.trim().toLowerCase();
}

export function isValidUsername(input: string): boolean {
  return /^[a-z0-9._-]{3,32}$/u.test(normaliseUsername(input));
}

/**
 * Keeps only permissions that exist, in catalogue order.
 *
 * A form posts strings. Anything unrecognised is dropped rather than stored: a
 * row naming a permission the code no longer checks grants nothing while
 * looking on screen as though it grants something.
 */
export function cleanPermissions(input: readonly string[]): Permission[] {
  const wanted = new Set(input.filter(isPermission));
  return ALL_PERMISSIONS.filter((permission) => wanted.has(permission));
}

/**
 * What to store for an account.
 *
 * The owner holds everything implicitly and is never listed in the table, so
 * their permission set is always empty -- storing rows for them would imply the
 * set could be edited, and it cannot.
 */
export function permissionsToStore(
  target: { isOwner: boolean },
  requested: readonly string[],
): Permission[] {
  return target.isOwner ? [] : cleanPermissions(requested);
}

export type SettingsRefusal = "digest_email_required" | "name_required";

/**
 * Checks the settings that can contradict each other.
 *
 * The alert thresholds used to be checked here. They are their own screen now,
 * behind their own permission, and `refusalToSaveAlertRules` in
 * `src/lib/alerts/rules.ts` checks them.
 */
export function refusalToSaveSettings(input: {
  businessName: string;
  digestEnabled: boolean;
  digestEmail?: string | null;
}): SettingsRefusal | null {
  if (!input.businessName.trim()) return "name_required";

  if (input.digestEnabled && !input.digestEmail?.trim()) {
    return "digest_email_required";
  }
  return null;
}
