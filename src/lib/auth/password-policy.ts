/**
 * Password rules, with no cryptography and no Node built-ins.
 *
 * Kept separate from `password.ts` deliberately: the change-password form is a
 * client component and needs the minimum length and the problem labels, but
 * pulling those from the hashing module would drag argon2 and `node:crypto`
 * into the browser bundle. This module is safe to import from anywhere.
 */

export const MIN_PASSWORD_LENGTH = 10;

export type PasswordProblem =
  | "too_short"
  | "too_common"
  | "same_as_username"
  | "same_as_current";

/**
 * A deliberately short list. Length is the property that actually matters, and
 * a long blocklist gives a false impression that the check is thorough.
 */
const OBVIOUS_PASSWORDS = new Set([
  "password", "password1", "passw0rd", "12345678", "123456789", "1234567890",
  "qwertyuiop", "apotek123", "apoteker", "farmasi123", "adminadmin",
  "administrator", "rahasia123", "indonesia",
]);

export function checkPasswordPolicy(
  plain: string,
  ctx: { username?: string } = {},
): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  if (plain.length < MIN_PASSWORD_LENGTH) problems.push("too_short");
  if (OBVIOUS_PASSWORDS.has(plain.toLowerCase())) problems.push("too_common");
  if (ctx.username && plain.toLowerCase() === ctx.username.toLowerCase()) {
    problems.push("same_as_username");
  }
  return problems;
}
