/**
 * Display helpers for the shell. Money and expiry come from the server's own
 * formatters, so a receipt reads the same on the phone as on the website.
 */
export { formatMoney, parseMoney } from "@/lib/format/money";
export { formatExpiry } from "@/lib/format/date";

/**
 * A moment in the pharmacy's timezone -- the snapshot's, never the phone's.
 * Offline times are server time carried forward (see lib/pass.ts), so this is
 * what the receipt prints.
 */
export function formatMoment(epochMs: number, locale: "id" | "en", timezone: string): string {
  return new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(epochMs));
}

/** Basis points as a percentage: 1100 -> "11%". */
export function formatRate(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}
