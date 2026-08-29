import { randomInt, timingSafeEqual, createHash } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";

/**
 * NODE ONLY. Never import this module from a client component -- doing so pulls
 * argon2 and `node:crypto` into the browser bundle and the build fails on a
 * missing wasm target rather than on anything that names the real problem.
 *
 * It carries no `server-only` guard because the migrate and seed scripts run as
 * plain Node processes and need `hashPassword`. Anything the UI needs -- the
 * minimum length, the policy check -- lives in `./password-policy` instead.
 */

/**
 * Password hashing.
 *
 * argon2id at the OWASP-recommended minimum: 19 MiB of memory, two passes,
 * one lane. There is no screen, export, report or log anywhere in this system
 * that displays a password -- the owner issues a temporary one and can reset
 * it, but never reads the working one. That is what keeps a sale attributable
 * to the cashier who rang it.
 */
const ARGON_OPTIONS = {
  // 2 is Argon2id. The library exports this as an ambient const enum, which
  // cannot be referenced under `isolatedModules`, so the value is inlined.
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return argonHash(plain, ARGON_OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argonVerify(hash, plain);
  } catch {
    // A malformed stored hash must read as "wrong password", never as an
    // exception that a caller might treat as success.
    return false;
  }
}

/**
 * Excludes *both* members of every confusable pair -- 0/O, 1/l/I, 5/S, 2/Z --
 * rather than just one.
 *
 * Dropping only the digit would look sufficient, but the person transcribing
 * has no idea which characters the generator avoids: shown a handwritten "z"
 * they may still type "2". A temporary password is written down and typed by a
 * different person exactly once, so the ambiguity has to be removed from the
 * alphabet rather than reasoned away.
 *
 * 21 letters and 6 digits still give roughly 43 bits over 8 letters and 3
 * digits, which is ample for a credential that is replaced at first sign-in.
 */
const TEMP_ALPHABET = "abcdefghjkmnpqrtuvwxy";
const TEMP_DIGITS = "346789";

/**
 * Generates a temporary password for a new or reset account. Readable aloud,
 * and replaced by the user's own at first sign-in.
 */
export function generateTemporaryPassword(): string {
  const letters = Array.from(
    { length: 8 },
    () => TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)],
  ).join("");
  const digits = Array.from(
    { length: 3 },
    () => TEMP_DIGITS[randomInt(TEMP_DIGITS.length)],
  ).join("");
  return `${letters.slice(0, 4)}-${letters.slice(4)}-${digits}`;
}

/** Session tokens are stored as a hash, so a database leak yields no live sessions. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// Re-exported so server-side callers have a single import for both.
export {
  MIN_PASSWORD_LENGTH,
  checkPasswordPolicy,
  type PasswordProblem,
} from "./password-policy";
