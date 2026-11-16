import Link from "next/link";

export type HealthPart = {
  key: "healthy" | "low" | "out";
  label: string;
  count: number;
  href: string;
};

const FILL: Record<HealthPart["key"], string> = {
  healthy: "bg-accent",
  low: "bg-warning",
  out: "bg-critical",
};

/**
 * The catalogue split three ways: fine, running low, empty.
 *
 * A thin bar over a list that already gives each part's name and count, so the
 * bar carries no text of its own and each row's swatch is the legend. The
 * three colours are the till's own status colours plus the brand purple for
 * "nothing wrong", a set checked with the dataviz validator in both themes.
 * Every row is a link to the items it is counting.
 */
export function StockHealthBar({
  parts,
  total,
  shareOf,
}: {
  parts: HealthPart[];
  total: number;
  /** "12%" -- formatted by the caller, which knows the locale. */
  shareOf: (count: number) => string;
}) {
  return (
    <div>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-surface-2" aria-hidden="true">
        {parts
          .filter((part) => part.count > 0)
          .map((part) => (
            <span
              key={part.key}
              className={`h-full ${FILL[part.key]}`}
              style={{ width: `${(part.count / Math.max(total, 1)) * 100}%`, minWidth: "4px" }}
            />
          ))}
      </div>

      <ul className="mt-4 flex flex-col">
        {parts.map((part) => (
          <li key={part.key} className="border-t border-rule first:border-t-0">
            <Link
              href={part.href}
              className="flex min-h-11 items-center gap-3 py-2 text-sm hover:text-accent"
            >
              <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${FILL[part.key]}`} />
              <span className="min-w-0 flex-1">{part.label}</span>
              <span className="tabular shrink-0 font-semibold">{part.count}</span>
              <span className="tabular w-12 shrink-0 text-right text-xs text-faint">
                {shareOf(part.count)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
