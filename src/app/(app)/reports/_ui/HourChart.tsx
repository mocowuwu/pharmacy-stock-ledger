"use client";

import { useState } from "react";
import { formatMoney } from "@/lib/format/money";
import { niceCeiling } from "@/components/SalesChart";
import { useChartWidth } from "@/components/useChartWidth";

export type HourPoint = { hour: number; total: number; count: number };

const FALLBACK_WIDTH = 720;
const H = 180;
const PAD = { top: 12, right: 8, bottom: 26, left: 36 };

/**
 * When the counter is busy: transactions per hour of the day.
 *
 * One measure, one colour -- a column per hour, thin, rounded at the data end
 * and square at the baseline, with the hour it stands for as the hit target so
 * a hover never has to land on the bar itself. Counts rather than rupiah,
 * because the question this answers is how many people to have on shift, and
 * one large sale is still one customer. The takings are in the tooltip.
 *
 * The axis runs from opening to closing as the data shows it -- never
 * narrower than 07.00 to 21.00, so a quiet week does not look like a
 * different shop.
 */
export function HourChart({
  data,
  label,
  transactionsLabel,
  emptyLabel,
}: {
  data: HourPoint[];
  label: string;
  transactionsLabel: string;
  emptyLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const { ref: frame, width: W } = useChartWidth<HTMLDivElement>(FALLBACK_WIDTH);

  const active = data.filter((point) => point.count > 0).map((point) => point.hour);
  const first = Math.min(7, ...active);
  const last = Math.max(21, ...active);
  const hours = data.filter((point) => point.hour >= first && point.hour <= last);
  const max = Math.max(0, ...hours.map((point) => point.count));
  const ceiling = max === 0 ? 1 : Math.max(niceCeiling(max), 1);

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / hours.length;
  const barWidth = Math.min(20, slot * 0.62);
  const y = (count: number) => PAD.top + innerH - (count / ceiling) * innerH;
  const ticks = max === 0 ? [0] : [0, ceiling / 2, ceiling].filter((v) => Number.isInteger(v));

  const hovered = hover === null ? null : hours.find((point) => point.hour === hover) ?? null;
  const hoveredIndex = hovered ? hours.indexOf(hovered) : -1;
  const clock = (hour: number) => `${String(hour).padStart(2, "0")}.00`;

  if (max === 0) {
    return <p className="py-10 text-center text-sm text-muted">{emptyLabel}</p>;
  }

  return (
    <figure className="m-0">
      <div ref={frame} className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={label}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke="var(--rule)"
                strokeWidth="1"
              />
              <text
                x={PAD.left - 8}
                y={y(tick) + 4}
                textAnchor="end"
                fontSize="11"
                className="tabular"
                fill="var(--faint)"
              >
                {tick}
              </text>
            </g>
          ))}

          {hours.map((point, i) => {
            const cx = PAD.left + slot * i + slot / 2;
            const top = y(point.count);
            const base = PAD.top + innerH;
            const height = base - top;
            const r = Math.min(4, height, barWidth / 2);
            const x0 = cx - barWidth / 2;
            const x1 = cx + barWidth / 2;
            return (
              <g key={point.hour}>
                {point.count > 0 && (
                  <path
                    d={`M${x0} ${base} L${x0} ${top + r} Q${x0} ${top} ${x0 + r} ${top} L${x1 - r} ${top} Q${x1} ${top} ${x1} ${top + r} L${x1} ${base} Z`}
                    fill="var(--accent)"
                    opacity={hover === null || hover === point.hour ? 1 : 0.55}
                  />
                )}
                {(point.hour % (slot < 24 ? 6 : 3) === 0) && (
                  <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--faint)">
                    {clock(point.hour)}
                  </text>
                )}
                <rect
                  x={PAD.left + slot * i}
                  y={PAD.top}
                  width={slot}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setHover(point.hour)}
                />
              </g>
            );
          })}
        </svg>

        {hovered && (
          <div
            className={`pointer-events-none absolute top-0 rounded-lg border border-rule bg-surface px-3 py-2 text-xs shadow-lg ${
              hoveredIndex / hours.length > 0.7 ? "-translate-x-full" : hoveredIndex / hours.length < 0.3 ? "" : "-translate-x-1/2"
            }`}
            style={{ left: `${((PAD.left + slot * hoveredIndex + slot / 2) / W) * 100}%` }}
          >
            <div className="text-muted">
              {clock(hovered.hour)}–{clock((hovered.hour + 1) % 24)}
            </div>
            <div className="tabular font-semibold">
              {hovered.count}× {transactionsLabel}
            </div>
            <div className="tabular text-faint">{formatMoney(hovered.total)}</div>
          </div>
        )}
      </div>
    </figure>
  );
}
