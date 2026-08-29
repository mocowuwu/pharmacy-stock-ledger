import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { resolveSession, readSessionCookie, type ActiveSession } from "@/lib/auth/session";
import { can, type Permission } from "@/lib/auth/permissions";

/**
 * The Data Access Layer.
 *
 * Authorization is enforced here, next to the data, and never in navigation or
 * in `proxy.ts`. Hiding a link is a courtesy to the user; it is not a control.
 * Every reader and every mutation goes through one of these functions.
 *
 * `cache` memoises for the duration of a single render pass, so a page that
 * checks permissions in five places still performs one session lookup.
 */
export const getCurrentSession = cache(async (): Promise<ActiveSession | null> => {
  const token = await readSessionCookie();
  if (!token) return null;
  return resolveSession(token);
});

export class PermissionError extends Error {
  constructor(readonly permission: Permission) {
    super(`Missing permission: ${permission}`);
    this.name = "PermissionError";
  }
}

export class AuthenticationError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "AuthenticationError";
  }
}

type RequireOptions = {
  /**
   * Set only by the change-password screen itself. Everywhere else, a user who
   * still holds a temporary password is sent there and nothing else loads.
   */
  allowPendingPasswordChange?: boolean;
};

/** For pages: redirects rather than throwing, so the user lands somewhere useful. */
export async function requireSession(
  options: RequireOptions = {},
): Promise<ActiveSession> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.mustChangePassword && !options.allowPendingPasswordChange) {
    redirect("/change-password");
  }
  return session;
}

/** For pages. Renders nothing rather than a locked-looking screen. */
export async function requirePermission(
  permission: Permission,
  options: RequireOptions = {},
): Promise<ActiveSession> {
  const session = await requireSession(options);
  if (!can(session.grant, permission)) redirect("/");
  return session;
}

/**
 * For server actions: throws instead of redirecting, so the action can return a
 * form error. An action must call this even when its screen is already gated --
 * the screen is not what protects the data.
 */
export async function assertPermission(
  permission: Permission,
  options: RequireOptions = {},
): Promise<ActiveSession> {
  const session = await getCurrentSession();
  if (!session) throw new AuthenticationError();
  if (session.user.mustChangePassword && !options.allowPendingPasswordChange) {
    throw new AuthenticationError();
  }
  if (!can(session.grant, permission)) throw new PermissionError(permission);
  return session;
}

export async function assertSession(
  options: RequireOptions = {},
): Promise<ActiveSession> {
  const session = await getCurrentSession();
  if (!session) throw new AuthenticationError();
  if (session.user.mustChangePassword && !options.allowPendingPasswordChange) {
    throw new AuthenticationError();
  }
  return session;
}
