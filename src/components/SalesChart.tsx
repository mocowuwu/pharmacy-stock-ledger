"use client";

import { useId, useMemo, useState } from "react";
import { useChartWidth } from "./useChartWidth";
import { formatMoney } from "@/lib/format/money";
import { formatExpiry } from "@/lib/format/date";
import type { Locale } from "@/i18n/config";

export type DayPoint = { day: string; total: number; count: number };

/**
 * Daily takings, optionally against the period before.
 *
 * The period in view is the one line in the brand's colour; the comparison is
 * the same shape in the muted ink, so the eye goes to this month and measures
 * it against last month rather than weighing two equal lines. The pair was
 * checked with the dataviz validator in both themes: they separate for every
 * kind of colour vision, and the grey is grey on purpose. With two lines
 * there is a legend; with one, the heading names it.
 *
 * Empty days are plotted as zero rather than skipped -- a line that hops over
 * quiet days would slope through them and imply trade that never happened.
 * The comparison is aligned day by day from the start of each window, so day
 * 3 of this month sits over day 3 of last month.
 *
 * Drawn as inline SVG. A chart library would be a dependency and a bundle for
 * two charts, and none of this needs one.
 */
const FALLBACK_WIDTH = 720;
/** Pixels from a date label to the last one, which hangs left from its point: "27 Agu" is about 40 wide. */
const MIN_LABEL_GAP = 72;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 64 };

/**
 * Rounds a maximum up to a readable axis ceiling -- 1, 2 or 5 times a power of
 * ten. Without it the gridlines carry values like "Rp 61.200" and "Rp 30.600",
 * which are precise and unreadable; a person scanning an axis wants round
 * numbers to measure against.
 */
export function niceCeiling(max: number): number {
  if (max <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalised = max / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/** "Rp 1,5 jt" on an axis, where the full figure would crowd the labels. */
export function compactMoney(amount: number, locale: Locale): string {
  if (Math.abs(amount) < 10_000) return formatMoney(amount);
  const formatted = new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-GB", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount);
  return `Rp ${formatted}`;
}

export function SalesChart({
  data,
  locale,
  emptyLabel,
  salesLabel,
  previous,
  labels,
}: {
  data: DayPoint[];
  locale: Locale;
  emptyLabel: string;
  salesLabel: string;
  /** The window before, same length or near it; aligned by position. */
  previous?: DayPoint[];
  labels?: { current: string; previous: string; transactions: string };
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);
  const compare = !!previous && !!labels;
  const { ref: frame, width: W } = useChartWidth<HTMLDivElement>(FALLBACK_WIDTH);

  const geometry = useMemo(() => {
    const prior = compare ? (previous ?? []).slice(0, data.length) : [];
    const max = Math.max(...data.map((d) => d.total), ...prior.map((d) => d.total), 0);
    // A flat-zero series still needs a scale, or every point lands on the axis.
    const ceiling = max === 0 ? 1 : niceCeiling(max);
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;

    const x = (i: number) =>
      PAD.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
    const y = (v: number) => PAD.top + innerH - (v / ceiling) * innerH;

    const points = data.map((d, i) => ({ ...d, cx: x(i), cy: y(d.total) }));
    const priorPoints = prior.map((d, i) => ({ ...d, cx: x(i), cy: y(d.total) }));
    const path = (list: Array<{ cx: number; cy: number }>) =>
      list.map((p, i) => `${i === 0 ? "M" : "L"}${p.cx} ${p.cy}`).join(" ");
    const line = path(points);
    const area =
      points.length > 0
        ? `${line} L${points[points.length - 1].cx} ${PAD.top + innerH} L${points[0].cx} ${
            PAD.top + innerH
          } Z`
        : "";

    // Three gridlines is enough to read a level against without becoming a
    // table. With no trade at all there is nothing to measure, so a single
    // baseline is shown rather than three identical labels.
    const fractions = max === 0 ? [0] : [0, 0.5, 1];
    const ticks = fractions.map((f) => ({ value: ceiling * f, y: y(ceiling * f) }));

    return { points, priorPoints, line, priorLine: path(priorPoints), area, ticks, max };
  }, [data, previous, compare, W]);

  const active = hover === null ? null : geometry.points[hover];
  const activePrior = hover === null ? null : geometry.priorPoints[hover];
  const last = geometry.points[geometry.points.length - 1];
  const hasTrade = geometry.max > 0;
  const step = (W - PAD.left - PAD.right) / Math.max(data.length, 1);
  // Fewer date labels on a narrow screen, where six would collide.
  const labelStep = Math.max(1, Math.ceil(data.length / (W < 480 ? 4 : 6)));

  return (
    <figure className="m-0">
      {compare && hasTrade && (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded bg-accent" />
            {labels.current}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded bg-faint" />
            {labels.previous}
          </span>
        </div>
      )}
      <div ref={frame} className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={salesLabel}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.16" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Grid and axis labels stay recessive: the data is the loud part. */}
          {geometry.ticks.map((tick) => (
            <g key={tick.y}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={tick.y}
                y2={tick.y}
                stroke="var(--rule)"
                strokeWidth="1"
              />
              <text
                x={PAD.left - 10}
                y={tick.y + 4}
                textAnchor="end"
                className="tabular"
                fontSize="11"
                fill="var(--faint)"
              >
                {compactMoney(Math.round(tick.value), locale)}
              </text>
            </g>
          ))}

          {hasTrade && <path d={geometry.area} fill={`url(#${gradientId})`} />}

          {compare && geometry.priorPoints.length > 1 && (
            <path
              d={geometry.priorLine}
              fill="none"
              stroke="var(--faint)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          <path
            d={geometry.line}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* The endpoint is marked rather than every point. */}
          {last && hasTrade && (
            <circle
              cx={last.cx}
              cy={last.cy}
              r="4.5"
              fill="var(--accent)"
              stroke="var(--surface)"
              strokeWidth="2"
            />
          )}

          {active && (
            <>
              <line
                x1={active.cx}
                x2={active.cx}
                y1={PAD.top}
                y2={H - PAD.bottom}
                stroke="var(--rule)"
                strokeWidth="1"
              />
              {activePrior && compare && (
                <circle
                  cx={activePrior.cx}
                  cy={activePrior.cy}
                  r="4"
                  fill="var(--faint)"
                  stroke="var(--surface)"
                  strokeWidth="2"
                />
              )}
              <circle
                cx={active.cx}
                cy={active.cy}
                r="5"
                fill="var(--accent)"
                stroke="var(--surface)"
                strokeWidth="2"
              />
            </>
          )}

          {/* Hit targets are whole columns, so hovering finds the day rather
              than requiring a landing on a 4px dot. */}
          {geometry.points.map((point, i) => (
            <rect
              key={point.day}
              x={point.cx - step / 2}
              y={PAD.top}
              width={step}
              height={H - PAD.top - PAD.bottom}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}

          {geometry.points.map((point, i) =>
            // Every sixth or so, plus the last -- but never one so close to
            // the last that the two labels run into each other.
            (i % labelStep === 0 && (last?.cx ?? 0) - point.cx >= MIN_LABEL_GAP) || i === data.length - 1 ? (
              <text
                key={`label-${point.day}`}
                x={point.cx}
                y={H - 8}
                // The outermost labels hang inward, so neither is cut by the frame.
                textAnchor={
                  data.length === 1 ? "middle" : i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"
                }
                fontSize="11"
                fill="var(--faint)"
              >
                {formatExpiry(point.day, locale).replace(/ \d{4}$/u, "")}
              </text>
            ) : null,
          )}
        </svg>

        {active && (
          <div
            className={`pointer-events-none absolute -translate-y-full rounded-lg border border-rule bg-surface px-3 py-2 text-xs shadow-lg ${
              active.cx / W > 0.7 ? "-translate-x-full" : active.cx / W < 0.3 ? "" : "-translate-x-1/2"
            }`}
            style={{
              left: `${(active.cx / W) * 100}%`,
              top: `${(Math.min(active.cy, activePrior?.cy ?? active.cy) / H) * 100}%`,
            }}
          >
            <div className="text-muted">{formatExpiry(active.day, locale)}</div>
            <div className="tabular font-semibold">{formatMoney(active.total)}</div>
            <div className="tabular text-faint">
              {active.count}× {labels?.transactions ?? ""}
            </div>
            {compare && activePrior && (
              <div className="mt-1.5 border-t border-rule pt-1.5">
                <div className="flex items-center gap-1.5 text-muted">
                  <span aria-hidden="true" className="inline-block h-0.5 w-3 rounded bg-faint" />
                  {formatExpiry(activePrior.day, locale)}
                </div>
                <div className="tabular">{formatMoney(activePrior.total)}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {!hasTrade && (
        <figcaption className="mt-1 text-center text-sm text-muted">
          {emptyLabel}
        </figcaption>
      )}
    </figure>
  );
}
