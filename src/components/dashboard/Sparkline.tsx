/**
 * The last fortnight as a row of thin columns, today's in the brand colour.
 *
 * A trend beside a headline figure, not a chart: no axis, no labels, no hover.
 * It answers "is today ordinary?" and nothing else, and the full line with its
 * dates is the next card down. Hidden from assistive technology for the same
 * reason -- the figure and its comparison are in the text beside it.
 */
export function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(...values, 0);
  if (max === 0) return null;
  const W = 6;
  const GAP = 3;
  const H = 44;

  return (
    <svg
      aria-hidden="true"
      width={values.length * (W + GAP) - GAP}
      height={H}
      viewBox={`0 0 ${values.length * (W + GAP) - GAP} ${H}`}
      className="shrink-0"
    >
      {values.map((value, i) => {
        // A day with trade never draws shorter than two pixels: a column that
        // vanishes reads as a closed shop.
        const height = value > 0 ? Math.max((value / max) * H, 2) : 1;
        return (
          <rect
            key={i}
            x={i * (W + GAP)}
            y={H - height}
            width={W}
            height={height}
            rx={Math.min(2, height / 2)}
            fill={i === values.length - 1 ? "var(--accent)" : "var(--mark-quiet)"}
          />
        );
      })}
    </svg>
  );
}
