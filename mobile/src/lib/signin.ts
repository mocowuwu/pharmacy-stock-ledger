/**
 * Offline sign-in.
 *
 * Every sale carries the id of the person who rang it, offline as much as
 * online -- a shared "till" login would make the offline sales the one place
 * in the ledger nobody is answerable for. So the till keeps, for each person
 * who has signed in on it online, enough to check their password without the
 * server: a PBKDF2 verifier, never the password.
 *
 * The verifier is only as fresh as the last online sign-in, so it is bounded
 * three ways: it works for OFFLINE_SIGN_IN_HOURS after that sign-in (measured
 * in offline-now, not the phone's clock); a suspended or re-passworded user is
 * forgotten at the next snapshot; and a temporary password is never stored,
 * because it is about to stop being the password.
 */
import {
  OFFLINE_SIGN_IN_HOURS,
  type DeviceUser,
  type SnapshotResponse,
} from "@/lib/offline/contract";
import type { StateFile, StoredUser, UsersFile, Verifier } from "../storage-format";

export const PBKDF2_ITERATIONS = 210_000;
export const MAX_FAILURES = 5;
export const LOCKOUT_MS = 15 * 60_000;

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function makeVerifier(
  password: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<Verifier> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iterations);
  return { salt: toBase64(salt), hash: toBase64(hash), iterations };
}

export async function checkVerifier(password: string, verifier: Verifier): Promise<boolean> {
  const expected = fromBase64(verifier.hash);
  const actual = await derive(password, fromBase64(verifier.salt), verifier.iterations);
  if (actual.length !== expected.length) return false;
  // Compare every byte regardless of where the first difference is.
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

export function findUser(users: UsersFile, username: string): StoredUser | undefined {
  const wanted = username.trim().toLowerCase();
  return users.users.find((u) => u.username.toLowerCase() === wanted);
}

/**
 * Records a successful online sign-in. With a temporary password the verifier
 * is dropped rather than kept from an earlier sign-in: the credential stamp
 * has moved, so the old one is stale anyway.
 */
export function rememberUser(
  users: UsersFile,
  user: DeviceUser & { mustChangePassword: boolean },
  serverTime: string,
  verifier: Verifier | null,
): UsersFile {
  const record: StoredUser = {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    locale: user.locale,
    isOwner: user.isOwner,
    isPharmacist: user.isPharmacist,
    permissions: [...user.permissions],
    credentialStamp: user.credentialStamp,
    signedInAt: serverTime,
    verifier: user.mustChangePassword ? null : verifier,
  };
  return { users: [...users.users.filter((u) => u.id !== user.id), record] };
}

/**
 * Applies the server's current view of each user from a snapshot. Anyone
 * suspended, missing, or whose password changed is forgotten outright -- the
 * next online sign-in brings them back with a fresh verifier.
 */
export function reconcileUsers(
  users: UsersFile,
  current: SnapshotResponse["users"],
): UsersFile {
  const byId = new Map(current.map((u) => [u.id, u]));
  const kept: StoredUser[] = [];
  for (const stored of users.users) {
    const now = byId.get(stored.id);
    if (!now || !now.active || now.credentialStamp !== stored.credentialStamp) continue;
    kept.push({
      ...stored,
      username: now.username,
      fullName: now.fullName,
      locale: now.locale,
      isOwner: now.isOwner,
      isPharmacist: now.isPharmacist,
      permissions: [...now.permissions],
    });
  }
  return { users: kept };
}

export function hasPermission(
  user: Pick<StoredUser, "isOwner" | "permissions">,
  permission: string,
): boolean {
  return user.isOwner || user.permissions.includes(permission);
}

export type OfflineSignInProblem = "unknown" | "no_verifier" | "too_old" | "not_permitted";

/**
 * Whether this stored user may sign in offline at offline-now `now`, before
 * the password is even checked. Checked in this order so the message names the
 * reason the person can act on.
 */
export function offlineEligibility(
  user: StoredUser | undefined,
  now: number,
): "ok" | OfflineSignInProblem {
  if (!user) return "unknown";
  if (!user.verifier) return "no_verifier";
  const since = now - Date.parse(user.signedInAt);
  if (!(since < OFFLINE_SIGN_IN_HOURS * 3_600_000)) return "too_old";
  if (!hasPermission(user, "sales.create")) return "not_permitted";
  return "ok";
}

/* ------------------------------------------------------------ rate limit */

type SignInState = StateFile["signIn"];

/**
 * Minutes left on an offline sign-in lock, or 0. Measured on the monotonic
 * clock; a reboot clears it, but a reboot also ends the pass, so there is
 * nothing to sign in to until the server has been reached.
 */
export function lockMinutesLeft(s: SignInState, elapsed: number, bootCount: number): number {
  if (s.bootCount !== bootCount) return 0;
  const left = s.lockedUntilElapsed - elapsed;
  return left > 0 ? Math.ceil(left / 60_000) : 0;
}

export function recordFailure(s: SignInState, elapsed: number, bootCount: number): SignInState {
  const failures = (s.bootCount === bootCount ? s.failures : 0) + 1;
  if (failures >= MAX_FAILURES) {
    return { failures: 0, lockedUntilElapsed: elapsed + LOCKOUT_MS, bootCount };
  }
  return {
    failures,
    lockedUntilElapsed: s.bootCount === bootCount ? s.lockedUntilElapsed : 0,
    bootCount,
  };
}

export function recordSuccess(bootCount: number): SignInState {
  return { failures: 0, lockedUntilElapsed: 0, bootCount };
}
