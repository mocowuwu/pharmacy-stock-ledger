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

/**
 * What to say about a row that names no catalogue item. Imported history and
 * Panel Apotek entries both produce them, and "history, not in catalogue" on an
 * order the pharmacist typed in by hand would be a wrong label on a right row.
 */
export function notInCatalogueTag(
  row: { itemId: string | null; panelRevenue: number; historyRevenue: number },
  t: (key: string, values?: Record<string, string | number>) => string,
): string | undefined {
  if (row.itemId) return undefined;
  return row.panelRevenue > 0 && row.historyRevenue === 0
    ? t("reports.panel.notInCatalogue")
    : t("reports.history.notInCatalogue");
}

/** "Paracetamol 500 mg" -- a product's name as the shelf label has it. */
export function productName(row: { name: string; strength: string | null }): string {
  return `${row.name}${row.strength ? ` ${row.strength}` : ""}`;
}
