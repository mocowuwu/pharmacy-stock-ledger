import type { Permission } from "@/lib/auth/permissions";
import { addDays, today } from "@/lib/format/date";
import type { DateRange } from "./queries";

/**
 * Which reports exist, what each one needs, and what a period means.
 *
 * Plain data with no database or session imports, for the same reason
 * `src/lib/catalogue/enums.ts` is: the nav, the pages, the export route and the
 * tests all need this, and only some of them run on the server.
 */

export const REPORTS = [
  "sales",
  "margin",
  "valuation",
  "expiry",
  "suppliers",
] as const;

export type ReportSlug = (typeof REPORTS)[number];

/**
 * The permission split that is the point of this whole screen group:
 * **`reports.sales` shows what sold; `reports.financial` shows what it cost.**
 * A manager can hold the first without the second, which is the default.
 */
export const REPORT_PERMISSION = {
  sales: "reports.sales",
  margin: "reports.financial",
  valuation: "reports.financial",
  expiry: "reports.financial",
  suppliers: "reports.financial",
} as const satisfies Record<ReportSlug, Permission>;

export function isReportSlug(value: string): value is ReportSlug {
  return (REPORTS as readonly string[]).includes(value);
}

export const PRESETS = ["today", "7d", "30d", "month", "lastMonth", "90d"] as const;
export type Preset = (typeof PRESETS)[number];

/**
 * Turns a preset or a pair of typed dates into a window.
 *
 * Anything unparseable falls back to the last 30 days rather than throwing: a
 * mistyped URL should show a sensible report, not an error page. Reversed dates
 * are swapped rather than refused, because typing them the wrong way round is a
 * slip, not a request for an empty report.
 */
export function resolveRange(input: {
  preset?: string;
  from?: string;
  to?: string;
  /** Overridable so the behaviour can be tested on a fixed day. */
  on?: string;
}): DateRange & { preset: Preset | "custom" } {
  const isDate = (value?: string) => !!value && /^\d{4}-\d{2}-\d{2}$/u.test(value);

  if (isDate(input.from) && isDate(input.to)) {
    const [from, to] =
      input.from! <= input.to! ? [input.from!, input.to!] : [input.to!, input.from!];
    return { from, to, preset: "custom" };
  }

  const now = input.on ?? today();
  const preset = (PRESETS as readonly string[]).includes(input.preset ?? "")
    ? (input.preset as Preset)
    : "30d";

  switch (preset) {
    case "today":
      return { from: now, to: now, preset };
    case "7d":
      return { from: addDays(now, -6), to: now, preset };
    case "90d":
      return { from: addDays(now, -89), to: now, preset };
    case "month":
      return { from: `${now.slice(0, 7)}-01`, to: now, preset };
    case "lastMonth": {
      const [year, month] = now.split("-").map(Number);
      const previous = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
      const first = `${previous.y}-${String(previous.m).padStart(2, "0")}-01`;
      // The day before this month's first is the last day of the previous one,
      // whatever its length and whether or not it is a leap year.
      return { from: first, to: addDays(`${now.slice(0, 7)}-01`, -1), preset };
    }
    default:
      return { from: addDays(now, -29), to: now, preset: "30d" };
  }
}
