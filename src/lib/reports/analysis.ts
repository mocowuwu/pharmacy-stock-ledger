/**
 * Arithmetic on finished report rows: comparisons and rankings. Plain
 * functions with no database, so the screens, the exports and the tests all
 * get the same answer.
 */

/**
 * Change from one period to the next, in basis points, or null when there is
 * nothing to compare against -- "up from nothing" is not a percentage, and
 * showing it as +100% or infinity would be a made-up number.
 */
export function changeBps(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 10_000);
}

export type AbcClass = "A" | "B" | "C";

/**
 * Pareto classes by share of net sales, the way pharmacy stock is usually
 * ranked: the products that together make the first 80% of sales are A, the
 * next 15% are B, the long tail is C. A decides what must never run out; C is
 * where slow stock and expiry losses hide.
 *
 * A product straddling a boundary takes the better class -- the first product
 * alone may be 85% of sales, and it is still an A. Anything that earned
 * nothing is C.
 */
export function abcClasses<T extends { key: string; revenueNet: number }>(
  rows: readonly T[],
): Map<string, AbcClass> {
  const ranked = rows
    .filter((row) => row.revenueNet > 0)
    .sort((a, b) => b.revenueNet - a.revenueNet);
  const total = ranked.reduce((sum, row) => sum + row.revenueNet, 0);

  const classes = new Map<string, AbcClass>();
  let before = 0;
  for (const row of ranked) {
    const shareBefore = total > 0 ? before / total : 1;
    classes.set(row.key, shareBefore < 0.8 ? "A" : shareBefore < 0.95 ? "B" : "C");
    before += row.revenueNet;
  }
  for (const row of rows) if (!classes.has(row.key)) classes.set(row.key, "C");
  return classes;
}

/** A row's share of a total, in basis points; zero when the total is. */
export function shareBps(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 10_000) : 0;
}
