/**
 * Locale is a property of the signed-in user, not of the URL. There is no
 * `/id/...` or `/en/...` segment: staff switch language on their own account
 * and every link in the app stays the same for everyone.
 *
 * Three separate things are easy to conflate here, so they are kept apart:
 *
 *   1. UI locale        -- per user, `users.locale`. Staff-facing.
 *   2. Receipt locale   -- a business setting. Customer-facing, and NOT the
 *                          cashier's preference: someone working in English
 *                          must not hand an Indonesian customer an English
 *                          receipt.
 *   3. Data             -- item names, lot numbers, suppliers, typed reasons.
 *                          Never translated, stored exactly as entered.
 */
export const LOCALES = ["id", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "id";

/** Mirrors the signed-in user's stored preference so rendering needs no query. */
export const LOCALE_COOKIE = "pharmacy_locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
