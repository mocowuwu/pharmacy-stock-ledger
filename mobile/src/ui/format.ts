/**
 * Display helpers for the shell. Money and expiry come from the server's own
 * formatters, so a receipt reads the same on the phone as on the website.
 */
export { formatMoney, parseMoney } from "@/lib/format/money";
export { formatExpiry } from "@/lib/format/date";

const momentFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * A moment in the pharmacy's timezone -- the snapshot's, never the phone's.
 * Offline times are server time carried forward (see lib/pass.ts), so this is
 * what the receipt prints.
 */
export function formatMoment(epochMs: number, locale: "id" | "en", timezone: string): string {
  // One formatter per locale and zone: the queue and history screens print a
  // time on every row, and building a formatter is slow on an old phone.
  const key = `${locale}|${timezone}`;
  let formatter = momentFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    });
    momentFormatters.set(key, formatter);
  }
  return formatter.format(new Date(epochMs));
}

/** Basis points as a percentage: 1100 -> "11%". */
export function formatRate(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}
