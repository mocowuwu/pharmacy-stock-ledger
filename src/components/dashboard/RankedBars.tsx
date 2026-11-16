import Link from "next/link";
import type { ReactNode } from "react";

export type RankedRow = {
  key: string;
  label: ReactNode;
  /** A second, quieter line under the label: units sold, a share. */
  detail?: string;
  /** What the bar is drawn from. */
  value: number;
  /** The figure as the reader should see it. */
  display: string;
  href?: string;
};

/**
 * A ranked list with a bar per row: best sellers, payment methods, cashiers.
 *
 * One measure and one colour, largest first, every bar on the same baseline --
 * the form for comparing parts with each other, where a donut would ask the
 * reader to compare angles. Each row carries its own name and figure, so there
 * is nothing left for a legend or a tooltip to say; the bar sits under the
 * name rather than beside it because this card is a phone's width even on a
 * laptop.
 */
export function RankedBars({ rows, emptyLabel }: { rows: RankedRow[]; emptyLabel: string }) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted">{emptyLabel}</p>;
  }
  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <ol className="flex flex-col gap-3.5">
      {rows.map((row) => {
        const body = (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-sm font-medium">{row.label}</span>
              <span className="tabular shrink-0 text-sm font-semibold">{row.display}</span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-surface-2" aria-hidden="true">
              <div
                className="h-full rounded-full bg-accent"
                // A sliver for anything above zero: a bar too thin to see says
                // "nothing", and the figure beside it says otherwise.
                style={{ width: `${Math.max((row.value / max) * 100, row.value > 0 ? 1.5 : 0)}%` }}
              />
            </div>
            {row.detail && <div className="mt-1 text-xs text-faint">{row.detail}</div>}
          </>
        );
        return (
          <li key={row.key}>
            {row.href ? (
              <Link href={row.href} className="block rounded-lg hover:text-accent">
                {body}
              </Link>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ol>
  );
}
