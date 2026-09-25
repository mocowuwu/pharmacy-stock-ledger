/**
 * The words every report table needs, looked up once. The table is a client
 * component and carries no strings of its own, so each report hands it these.
 */
export function tableLabels(
  t: (key: string, values?: Record<string, string | number>) => string,
  count?: number,
) {
  return {
    empty: t("reports.noData"),
    search: t("reports.table.search"),
    total: t("reports.table.total"),
    showAll: t("reports.table.showAll", { count: count ?? 0 }),
    showLess: t("reports.table.showLess"),
    sortHint: t("reports.table.sortHint"),
    noMatch: t("reports.table.noMatch"),
  };
}

/** "Paracetamol 500 mg" -- a product's name as the shelf label has it. */
export function productName(row: { name: string; strength: string | null }): string {
  return `${row.name}${row.strength ? ` ${row.strength}` : ""}`;
}
