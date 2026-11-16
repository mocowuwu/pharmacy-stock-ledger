"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { niceCeiling } from "@/components/SalesChart";
import { useChartWidth } from "@/components/useChartWidth";
import type { ExpiryBand, ExpiryMonth } from "@/lib/dashboard/queries";
import type { Locale } from "@/i18n/config";

const FALLBACK_WIDTH = 520;
const H = 200;
const PAD = { top: 12, right: 8, bottom: 26, left: 30 };
/** The surface showing between the parts of a column, in place of an outline. */
const GAP = 2;

/** Bottom of the column first: the nearest trouble sits on the baseline. */
const ORDER: ExpiryBand[] = ["expired", "urgent", "notice", "later"];

const FILL: Record<ExpiryBand, string> = {
  expired: "var(--critical)",
  urgent: "var(--warning)",
  notice: "var(--notice)",
  later: "var(--mark-quiet)",
};

/**
 * Batches by the month they expire in, a column per month for the year ahead.
 *
 * The colours are the alert list's own -- red for what is already past its
 * date, amber and blue for the two windows the pharmacy has set -- so a column
 * turning amber here is the same fact as an amber row there. Everything
 * further out is a quiet neutral: it is on the chart to show the shape of the
 * year, not to ask for anything. The four were checked together with the
 * dataviz validator in both themes, and none of them is the only cue: the
 * legend names each band and the tooltip spells out the counts.
 *
 * Batches rather than units, because a batch is one thing to pull off a shelf
 * and a count of them adds up across tablets and bottles; the units are in the
 * tooltip.
 */
export function ExpiryChart({
  months,
  windows,
  locale,
  label,
  emptyLabel,
}: {
  months: ExpiryMonth[];
  windows: { urgent: number; notice: number };
  locale: Locale;
  label: string;
  emptyLabel: string;
}) {
  const t = useTranslations("dashboard.expiry");
  const [hover, setHover] = useState<number | null>(null);
  const { ref: frame, width: W } = useChartWidth<HTMLDivElement>(FALLBACK_WIDTH);

  // The "already expired" column only earns its place when there is something
  // in it; an empty one would push twelve real months to the right for nothing.
  const columns = months.filter(
    (month) => month.key !== "expired" || month.batches.expired > 0,
  );
  const totalOf = (month: ExpiryMonth) => ORDER.reduce((sum, band) => sum + month.batches[band], 0);
  const max = Math.max(0, ...columns.map(totalOf));
  const present = ORDER.filter((band) => columns.some((month) => month.batches[band] > 0));

  if (max === 0) {
    return <p className="py-10 text-center text-sm text-muted">{emptyLabel}</p>;
  }

  const tag = locale === "id" ? "id-ID" : "en-GB";
  const short = new Intl.DateTimeFormat(tag, { month: "short", timeZone: "UTC" });
  const long = new Intl.DateTimeFormat(tag, { month: "long", year: "numeric", timeZone: "UTC" });
  const dateOf = (key: string) => new Date(`${key}-01T00:00:00Z`);
  const tick = (month: ExpiryMonth, index: number) => {
    if (month.key === "expired") return t("pastShort");
    const name = short.format(dateOf(month.key));
    // The year only where it changes, and on the first month shown.
    return month.key.endsWith("-01") || index === 0 ? `${name} ’${month.key.slice(2, 4)}` : name;
  };
  const title = (month: ExpiryMonth) =>
    month.key === "expired" ? t("band.expired") : long.format(dateOf(month.key));
  const bandLabel = (band: ExpiryBand) =>
    band === "urgent"
      ? t("band.urgent", { days: windows.urgent })
      : band === "notice"
        ? t("band.notice", { days: windows.notice })
        : t(`band.${band}`);

  const ceiling = Math.max(niceCeiling(max), 1);
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / columns.length;
  const barWidth = Math.min(24, slot * 0.62);
  const base = PAD.top + innerH;
  const y = (count: number) => base - (count / ceiling) * innerH;
  const ticks = [0, ceiling / 2, ceiling].filter((value) => Number.isInteger(value));
  // "Nov ’26" is about 44px wide; below that a label per column collides.
  const labelEvery = slot >= 46 ? 1 : slot >= 24 ? 2 : 3;

  const hovered = hover === null ? null : columns[hover] ?? null;

  return (
    <figure className="m-0">
      {present.length > 1 && (
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          {present.map((band) => (
            <li key={band} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 rounded-[3px]"
                style={{ background: FILL[band] }}
              />
              {bandLabel(band)}
            </li>
          ))}
        </ul>
      )}

      <div ref={frame} className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={label}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((value) => (
            <g key={value}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(value)}
                y2={y(value)}
                stroke="var(--rule)"
                strokeWidth="1"
              />
              <text
                x={PAD.left - 8}
                y={y(value) + 4}
                textAnchor="end"
                fontSize="11"
                className="tabular"
                fill="var(--faint)"
              >
                {value}
              </text>
            </g>
          ))}

          {columns.map((month, i) => {
            const cx = PAD.left + slot * i + slot / 2;
            const x0 = cx - barWidth / 2;
            const x1 = cx + barWidth / 2;
            const parts = ORDER.filter((band) => month.batches[band] > 0);
            let stacked = 0;

            return (
              <g key={month.key} opacity={hover === null || hover === i ? 1 : 0.55}>
                {parts.map((band, index) => {
                  const bottom = y(stacked);
                  stacked += month.batches[band];
                  const top = y(stacked);
                  const last = index === parts.length - 1;
                  // Every part but the lowest gives up two pixels to the gap,
                  // so the column's total height stays true to the count.
                  const floor = index === 0 ? bottom : bottom - GAP;
                  if (floor - top < 1) return null;
                  const r = last ? Math.min(4, floor - top, barWidth / 2) : 0;
                  return (
                    <path
                      key={band}
                      d={`M${x0} ${floor} L${x0} ${top + r} Q${x0} ${top} ${x0 + r} ${top} L${x1 - r} ${top} Q${x1} ${top} ${x1} ${top + r} L${x1} ${floor} Z`}
                      fill={FILL[band]}
                    />
                  );
                })}
                {(i % labelEvery === 0 || month.key === "expired") && (
                  <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--faint)">
                    {tick(month, i)}
                  </text>
                )}
                {/* The whole slot is the target, so a hover finds an empty month too. */}
                <rect
                  x={PAD.left + slot * i}
                  y={PAD.top}
                  width={slot}
                  height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onClick={() => setHover(hover === i ? null : i)}
                />
              </g>
            );
          })}
        </svg>

        {hovered && hover !== null && (
          <div
            className={`pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border border-rule bg-surface px-3 py-2 text-xs shadow-lg ${
              hover / columns.length > 0.6 ? "-translate-x-full" : hover / columns.length < 0.3 ? "" : "-translate-x-1/2"
            }`}
            style={{ left: `${((PAD.left + slot * hover + slot / 2) / W) * 100}%` }}
          >
            <div className="font-medium">{title(hovered)}</div>
            {totalOf(hovered) === 0 ? (
              <div className="mt-1 text-faint">{t("nothing")}</div>
            ) : (
              <>
                <ul className="mt-1.5 flex flex-col gap-1">
                  {ORDER.filter((band) => hovered.batches[band] > 0).map((band) => (
                    <li key={band} className="flex items-center gap-1.5">
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 shrink-0 rounded-[2px]"
                        style={{ background: FILL[band] }}
                      />
                      <span className="text-muted">{bandLabel(band)}</span>
                      <span className="tabular ml-auto pl-3 font-semibold">
                        {t("batches", { count: hovered.batches[band] })}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="tabular mt-1.5 border-t border-rule pt-1.5 text-faint">
                  {t("units", { count: hovered.units })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* The same figures as a table, for a screen reader and for anyone who
          cannot use the colours. */}
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">{t("month")}</th>
            {present.map((band) => (
              <th key={band} scope="col">
                {bandLabel(band)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {columns.map((month) => (
            <tr key={month.key}>
              <th scope="row">{title(month)}</th>
              {present.map((band) => (
                <td key={band}>{month.batches[band]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
