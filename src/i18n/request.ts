import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "./config";

/**
 * Resolves the locale for a render.
 *
 * The source of truth is `users.locale`, but this runs on every request, so it
 * reads a cookie that mirrors that column instead of querying. The cookie is
 * rewritten at sign-in and whenever the user changes their preference, so it
 * cannot drift for longer than one sign-in.
 *
 * Before sign-in there is no user, so the browser's own preference is used --
 * falling back to Indonesian rather than English, which is the right default
 * for the people who work here.
 */
async function resolveLocale(): Promise<Locale> {
  const fromCookie = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(fromCookie)) return fromCookie;

  const accept = (await headers()).get("accept-language") ?? "";
  if (/^en\b/iu.test(accept.trim())) return "en";

  return DEFAULT_LOCALE;
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
    timeZone: process.env.PHARMACY_TIMEZONE || "Asia/Jakarta",
    now: new Date(),
  };
});
