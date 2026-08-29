"use client";

import { useId, useMemo, useState } from "react";
import { formatMoney } from "@/lib/format/money";
import { formatExpiry } from "@/lib/format/date";
import type { Locale } from "@/i18n/config";

export type DayPoint = { day: string; total: number; count: number };

/**
 * Daily takings.
 *
 * A single series over time, so: a line, one y-axis, no legend (the heading
 * names it), and a recessive grid. Empty days are plotted as zero rather than
 * skipped -- a line that hops over quiet days would slope through them and
 * imply trade that never happened.
 *
 * Drawn as inline SVG. A chart library would be a dependency and a bundle for
 * one chart, and none of this needs one.
 */
const W = 720;
const H = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 64 };

/**
 * Rounds a maximum up to a readable axis ceiling -- 1, 2 or 5 times a power of
 * ten. Without it the gridlines carry values like "Rp 61.200" and "Rp 30.600",
 * which are precise and unreadable; a person scanning an axis wants round
 * numbers to measure against.
 */
function niceCeiling(max: number): number {
  if (max <= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalised = max / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

export function SalesChart({
  data,
  locale,
  emptyLabel,
  salesLabel,
}: {
  data: DayPoint[];
  locale: Locale;
  emptyLabel: string;
  salesLabel: string;
}) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const max = Math.max(...data.map((d) => d.total), 0);
    // A flat-zero series still needs a scale, or every point lands on the axis.
    const ceiling = max === 0 ? 1 : niceCeiling(max);
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;

    const x = (i: number) =>
      PAD.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
    const y = (v: number) => PAD.top + innerH - (v / ceiling) * innerH;

    const points = data.map((d, i) => ({ ...d, cx: x(i), cy: y(d.total) }));
    const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.cx} ${p.cy}`).join(" ");
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

    return { points, line, area, ticks, max };
  }, [data]);

  const active = hover === null ? null : geometry.points[hover];
  const last = geometry.points[geometry.points.length - 1];
  const hasTrade = geometry.max > 0;

  return (
    <figure className="m-0">
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={salesLabel}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
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
                {formatMoney(Math.round(tick.value))}
              </text>
            </g>
          ))}

          {hasTrade && <path d={geometry.area} fill={`url(#${gradientId})`} />}

          <path
            d={geometry.line}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* The endpoint is labelled directly rather than every point. */}
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
                stroke="var(--accent)"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.6"
              />
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

          {/* Hit targets are wider than the marks, so hovering does not require
              landing on a 4px dot. */}
          {geometry.points.map((point, i) => (
            <rect
              key={point.day}
              x={point.cx - (W - PAD.left - PAD.right) / (data.length * 2)}
              y={PAD.top}
              width={(W - PAD.left - PAD.right) / data.length}
              height={H - PAD.top - PAD.bottom}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}

          {geometry.points.map((point, i) =>
            i % Math.ceil(data.length / 6) === 0 || i === data.length - 1 ? (
              <text
                key={`label-${point.day}`}
                x={point.cx}
                y={H - 8}
                textAnchor="middle"
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
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-rule bg-surface px-3 py-2 text-xs shadow-lg"
            style={{
              left: `${(active.cx / W) * 100}%`,
              top: `${(active.cy / H) * 100}%`,
            }}
          >
            <div className="text-muted">{formatExpiry(active.day, locale)}</div>
            <div className="tabular font-semibold">{formatMoney(active.total)}</div>
            <div className="tabular text-faint">{active.count}×</div>
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
