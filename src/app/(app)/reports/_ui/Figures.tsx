import type { ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import { changeBps } from "@/lib/reports/analysis";

/**
 * Headline figures and the sales statement: the parts of a report that are
 * numbers rather than charts. Server components -- nothing here moves.
 */

/** Renders basis points as a percentage: 6000 -> "60,0%". */
export function percentFromBps(bps: number, locale: Locale): string {
  return (
    new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-GB", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(bps / 100) + "%"
  );
}

function percentText(bps: number, locale: Locale): string {
  return (
    new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-GB", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(Math.abs(bps) / 100) + "%"
  );
}

/**
 * A figure with its change against the period before.
 *
 * The change carries an arrow as well as a colour, so it reads without the
 * colour; the colour says whether the direction is good news, which depends on
 * the figure -- more sales is good, more stock thrown away is not. No
 * comparison is shown as a dash with the reason, never as +100%.
 */
export function KpiTile({
  label,
  value,
  current,
  previous,
  previousLabel,
  noComparison,
  goodWhen = "up",
  locale,
  hint,
  emphasis = false,
  pointsLabel,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  current?: number;
  /** Null when there is a period before but nothing in it to compare with. */
  previous?: number | null;
  /** "vs Rp 3,2 jt the period before". */
  previousLabel?: string;
  noComparison?: string;
  /** Which direction is good news; "neutral" for a figure that simply follows sales, like cost. */
  goodWhen?: "up" | "down" | "neutral";
  locale: Locale;
  hint?: string;
  emphasis?: boolean;
  /**
   * For a figure that is itself a percentage: the change is shown in
   * percentage points ("▲ 3,0 poin"), never as a percentage of a percentage.
   * `current` and `previous` are then basis points.
   */
  pointsLabel?: string;
  /** A figure that is itself a problem: money in expired stock, say. */
  tone?: "default" | "critical" | "warning" | "quiet";
}) {
  const bps =
    current === undefined || previous === undefined
      ? undefined
      : previous === null
        ? null
        : pointsLabel
          ? current - previous
          : changeBps(current, previous);
  const direction = bps === undefined || bps === null ? null : bps > 0 ? "up" : bps < 0 ? "down" : "flat";
  const deltaTone =
    direction === null || direction === "flat" || goodWhen === "neutral"
      ? "text-muted"
      : direction === goodWhen
        ? "text-accent"
        : "text-critical";

  return (
    <div
      className={`rounded-2xl border px-5 py-4 shadow-[var(--shadow-card),var(--edge)] print:shadow-none ${
        emphasis
          ? "border-accent/25 bg-accent-soft"
          : tone === "critical"
            ? "border-critical/25 bg-critical-soft"
            : tone === "warning"
              ? "border-warning/25 bg-warning-soft"
              : "border-rule bg-surface"
      }`}
    >
      <div className="text-sm font-medium text-muted">{label}</div>
      <div
        className={`mt-2 text-[1.625rem] leading-tight font-semibold tracking-[-0.03em] [overflow-wrap:anywhere] sm:text-[1.75rem] sm:leading-none ${
          emphasis
            ? "text-accent"
            : tone === "critical"
              ? "text-critical"
              : tone === "warning"
                ? "text-warning-ink"
                : tone === "quiet"
                  ? "text-faint"
                  : "text-foreground"
        }`}
      >
        {value}
      </div>
      {bps !== undefined && (
        <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
          {bps === null ? (
            <span className="text-faint">— {noComparison}</span>
          ) : (
            <span className={`tabular font-semibold ${deltaTone}`}>
              {direction === "up" ? "▲" : direction === "down" ? "▼" : "■"}{" "}
              {pointsLabel ? `${percentText(bps, locale).replace("%", "")} ${pointsLabel}` : percentText(bps, locale)}
            </span>
          )}
          {previousLabel && bps !== null && <span className="text-faint">{previousLabel}</span>}
        </div>
      )}
      {hint && <div className="mt-1.5 text-xs text-faint">{hint}</div>}
    </div>
  );
}

export type StatementLine = {
  label: string;
  value: number;
  /** How the line enters the sum; `total` lines close a block. */
  kind: "base" | "minus" | "plus" | "total" | "grand";
  note?: string;
};

/**
 * A statement, laid out the way an accountant reads one: each deduction on
 * its own line with its sign, and the running figure it arrives at set apart
 * beneath. The lines are the arithmetic, so the reader can check it.
 */
export function Statement({
  lines,
  format,
}: {
  lines: StatementLine[];
  format: (value: number) => string;
}) {
  return (
    <dl className="flex flex-col text-sm">
      {lines.map((line, index) => {
        const strong = line.kind === "total" || line.kind === "grand";
        return (
          <div
            key={`${line.label}-${index}`}
            className={`flex items-baseline justify-between gap-4 py-2 ${
              strong ? "border-t border-rule font-semibold" : ""
            } ${line.kind === "grand" ? "border-t-2 text-base" : ""}`}
          >
            <dt className={`min-w-0 ${strong ? "text-foreground" : "text-muted"} ${line.kind === "minus" || line.kind === "plus" ? "pl-4" : ""}`}>
              {line.label}
              {line.note && <span className="block text-xs font-normal text-faint">{line.note}</span>}
            </dt>
            <dd
              className={`tabular shrink-0 ${
                line.kind === "grand" ? "text-accent" : strong ? "text-foreground" : line.kind === "minus" ? "text-muted" : ""
              }`}
            >
              {line.kind === "minus" && line.value !== 0 ? "−" : line.kind === "plus" && line.value !== 0 ? "+" : ""}
              {format(Math.abs(line.value))}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** A titled card section of a report, printed without its shadow. */
export function Panel({
  title,
  note,
  actions,
  children,
  className = "",
}: {
  title: string;
  note?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      // min-w-0: a grid item otherwise refuses to shrink below its widest
      // table, and the whole page scrolls sideways on a phone.
      className={`report-panel min-w-0 rounded-2xl border border-rule bg-surface px-4 py-4 shadow-[var(--shadow-card),var(--edge)] sm:px-5 print:shadow-none ${className}`}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** A heading over a full-width table, matching `Panel`'s. */
export function TableHeading({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
    </div>
  );
}
