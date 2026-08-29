/**
 * Date handling.
 *
 * Expiry is a calendar-day concept, not an instant. Batches store it as a
 * plain `YYYY-MM-DD` string and every comparison here works on those strings
 * or on whole days, so no timezone offset can shift a batch across a day
 * boundary and make it look a day fresher or a day staler than it is.
 */

export const DEFAULT_TIMEZONE = "Asia/Jakarta";

export function pharmacyTimezone(): string {
  return process.env.PHARMACY_TIMEZONE || DEFAULT_TIMEZONE;
}

/**
 * Today's calendar date in the pharmacy's own timezone, as `YYYY-MM-DD`.
 *
 * `en-CA` is used purely because it formats as ISO; the locale is an
 * implementation detail and never reaches the screen.
 */
export function today(timezone: string = pharmacyTimezone()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Parses `YYYY-MM-DD` to a UTC-midnight epoch, for whole-day arithmetic only. */
function dayEpoch(isoDate: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(isoDate);
  if (!m) throw new Error(`Not a calendar date: ${isoDate}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const DAY_MS = 86_400_000;

/** Whole days from `from` to `to`. Negative when `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  return Math.round((dayEpoch(to) - dayEpoch(from)) / DAY_MS);
}

/** Days until a batch expires. Negative once it has expired. */
export function daysUntilExpiry(
  expiryDate: string,
  timezone: string = pharmacyTimezone(),
): number {
  return daysBetween(today(timezone), expiryDate);
}

/**
 * A batch is expired once the calendar day after its expiry date has begun in
 * the pharmacy's timezone -- that is, stock is good through the whole of its
 * expiry date.
 */
export function isExpired(
  expiryDate: string,
  timezone: string = pharmacyTimezone(),
): boolean {
  return expiryDate < today(timezone);
}

export function addDays(isoDate: string, days: number): string {
  return new Date(dayEpoch(isoDate) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Boxes print an expiry month, not a day, so entering "03/2027" means the stock
 * is good to the end of March. Callers convert with this rather than each
 * guessing at a day of the month.
 */
export function endOfMonth(year: number, month1to12: number): string {
  // Day 0 of the following month is the last day of this one.
  const d = new Date(Date.UTC(year, month1to12, 0));
  return d.toISOString().slice(0, 10);
}

const MONTHS_ID = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
const MONTHS_EN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/**
 * Expiry dates render as "15 Mar 2027" in both locales, never as a numeric
 * date. "03/04/2027" is two different days depending on who reads it, and a
 * misread expiry is a safety problem rather than a cosmetic one. The month
 * name is the only part that differs between languages.
 */
export function formatExpiry(isoDate: string, locale: "id" | "en" = "id"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(isoDate);
  if (!m) return isoDate;
  const months = locale === "id" ? MONTHS_ID : MONTHS_EN;
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

/** Ordinary (non-expiry) dates follow the locale's own conventions. */
export function formatDate(value: Date | string, locale: "id" | "en" = "id"): string {
  const d = typeof value === "string" ? new Date(dayEpoch(value)) : value;
  return new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: typeof value === "string" ? "UTC" : pharmacyTimezone(),
  }).format(d);
}

export function formatDateTime(value: Date, locale: "id" | "en" = "id"): string {
  return new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: pharmacyTimezone(),
  }).format(value);
}
