import type { Permission } from "@/lib/auth/permissions";
import { addDays, daysBetween, endOfMonth, today } from "@/lib/format/date";
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
  "movements",
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
  // Quantities and names, no cost prices: the movement ledger is the check a
  // manager runs on the shop floor, so it sits on the same side of the split
  // as the sales report rather than behind the financial half.
  movements: "reports.sales",
  margin: "reports.financial",
  valuation: "reports.financial",
  expiry: "reports.financial",
  suppliers: "reports.financial",
} as const satisfies Record<ReportSlug, Permission>;

/** Each report's glyph, from the sidebar's icon set. */
export const REPORT_ICON: Record<ReportSlug, string> = {
  sales: "sales",
  movements: "movements",
  margin: "margin",
  valuation: "valuation",
  expiry: "expiry",
  suppliers: "suppliers",
};

/** Which half of the hub a report is listed under. */
export const REPORT_GROUP: Record<ReportSlug, "selling" | "money"> = {
  sales: "selling",
  movements: "selling",
  margin: "money",
  valuation: "money",
  expiry: "money",
  suppliers: "money",
};

export function isReportSlug(value: string): value is ReportSlug {
  return (REPORTS as readonly string[]).includes(value);
}

export const PRESETS = ["today", "7d", "30d", "month", "lastMonth", "90d"] as const;

/** The longest window a report covers: three years and a day. */
export const MAX_RANGE_DAYS = 1_096;

/**
 * A day a report can start or end on: a real calendar date, written
 * YYYY-MM-DD, from 2000 on. "2026-02-30" passes a pattern check and then fails
 * in the database as a server error, so it is checked here and treated like
 * any other unreadable date -- the report falls back to its default period.
 */
export function isReportDay(value?: string): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/u.test(value) || value < "2000-01-01") return false;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value;
}
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
  if (isReportDay(input.from) && isReportDay(input.to)) {
    const [from, to] =
      input.from! <= input.to! ? [input.from!, input.to!] : [input.to!, input.from!];
    // A window of decades would draw a chart of ten thousand days; three years
    // is more than any comparison an owner makes, and the subtitle shows the
    // period actually reported.
    const earliest = addDays(to, -(MAX_RANGE_DAYS - 1));
    return { from: from < earliest ? earliest : from, to, preset: "custom" };
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

/**
 * The window a report is compared against: the one just before it.
 *
 * For most periods that is the same number of days immediately earlier --
 * the last 30 days against the 30 before them. Calendar months are compared
 * as calendar months instead, because that is how an owner thinks about
 * them: last month against the month before, and this month so far against
 * the same days of last month (the 1st to the 25th against the 1st to the
 * 25th), clamped where last month was shorter.
 */
export function previousRange(range: DateRange & { preset?: Preset | "custom" }): DateRange {
  const [year, month] = range.from.split("-").map(Number);
  const prior = month === 1 ? { y: year - 1, m: 12 } : { y: year, m: month - 1 };
  const priorFirst = `${prior.y}-${String(prior.m).padStart(2, "0")}-01`;
  const priorLast = endOfMonth(prior.y, prior.m);

  if (range.preset === "lastMonth") {
    return { from: priorFirst, to: priorLast };
  }
  if (range.preset === "month") {
    const day = Number(range.to.slice(8, 10));
    const candidate = `${priorFirst.slice(0, 8)}${String(day).padStart(2, "0")}`;
    return { from: priorFirst, to: candidate > priorLast ? priorLast : candidate };
  }

  const length = daysBetween(range.from, range.to) + 1;
  return { from: addDays(range.from, -length), to: addDays(range.from, -1) };
}
