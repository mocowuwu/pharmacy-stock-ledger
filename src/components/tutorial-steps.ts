/**
 * What the guided tour points at on each screen.
 *
 * Every chapter starts with the menu entry itself -- the tour lights it up and
 * waits for the person to click it, so they learn where the screen lives by
 * going there. The stops below then point at the parts of that screen that
 * matter, in the order you would use them, and some go one level deeper: open
 * an item, open a receipt, open a report.
 *
 * Selectors are tried in order and the first *visible* match wins. A stop whose
 * target is not on the page -- a button this account may not press, a list
 * that is empty -- is skipped rather than shown pointing at nothing, which is
 * what keeps one tour correct for owners and cashiers alike, and for a
 * pharmacy whose demo data has already been cleared.
 *
 * `action` stops wait for the person to do the thing instead of offering Next:
 * "type" when two or more characters are in a field inside the target,
 * "click" when anything inside it is clicked, or -- with `until` -- once what
 * the action should produce is on the page. None of them ever submits: the
 * tour must be safe to follow on the live system.
 */
export type TourStop = {
  id: string;
  selectors: string[];
  action?: "type" | "click";
  /**
   * What must appear before an action counts as done. Without it a search for
   * something that is not stocked would move on to point at a results list
   * that does not exist.
   */
  until?: string[];
  /**
   * For a stop on a detail screen reached by clicking (one item, one receipt),
   * the pattern its path must match. Such a screen cannot be opened on the
   * person's behalf -- the tour does not know which receipt they chose -- so
   * if they are not on it the stop is skipped.
   */
  path?: string;
};

const LIST = ["main table", "main .border-dashed"];
const ITEM_PAGE = "^/items/(?!new$|import)[^/]+$";
const SALE_PAGE = "^/sales/[^/]+$";
const COUNT_PAGE = "^/counts/(?!new$)[^/]+$";
const REPORT_PAGE = "^/reports/[^/]+$";

export const TOUR: Record<string, TourStop[]> = {
  dashboard: [
    { id: "summary", selectors: ["main section:nth-of-type(1)"] },
    { id: "sales", selectors: ["main section:nth-of-type(2)"] },
    { id: "catalogue", selectors: ["main section:nth-of-type(3)"] },
  ],
  sell: [
    {
      id: "search",
      selectors: ['[data-tour="sell-search"]'],
      action: "type",
      until: ['[data-tour="sell-results"]'],
    },
    { id: "results", selectors: ['[data-tour="sell-results"]'], action: "click" },
    { id: "qty", selectors: ['[data-tour="sell-qty"]'], action: "click" },
    { id: "lot", selectors: ['[data-tour="sell-lot"]'] },
    { id: "summary", selectors: ['[data-tour="sell-summary"]'] },
    { id: "pay", selectors: ['[data-tour="sell-pay"]'] },
    {
      id: "tendered",
      selectors: ['[data-tour="sell-tendered"]'],
      action: "type",
      until: ['[data-tour="sell-change"]'],
    },
    { id: "checkout", selectors: ['[data-tour="sell-checkout"]'] },
  ],
  items: [
    { id: "search", selectors: ['main form[method="get"]'] },
    { id: "list", selectors: LIST },
    { id: "class", selectors: ["main table tbody tr:first-child td:nth-child(3)"] },
    { id: "stock", selectors: ["main table tbody tr:first-child td:nth-child(5)"] },
    {
      id: "open",
      selectors: ['main table tbody tr:first-child a[href^="/items/"]'],
      action: "click",
    },
    { id: "batches", selectors: ['[data-tour="item-batches"]'], path: ITEM_PAGE },
    { id: "movements", selectors: ['[data-tour="item-movements"]'], path: ITEM_PAGE },
    { id: "add", selectors: ['[data-tour="page-actions"]'] },
  ],
  receive: [
    { id: "scan", selectors: ['[data-tour="receive-scan"]'] },
    { id: "item", selectors: ['label:has(select[name="itemId"])', 'select[name="itemId"]'] },
    { id: "supplier", selectors: ['label:has(select[name="supplierId"])'] },
    { id: "lot", selectors: ['label:has(input[name="lotNumber"])'] },
    {
      id: "expiry",
      selectors: [':has(> select[name="expiryMonth"])', 'select[name="expiryMonth"]'],
    },
    { id: "quantity", selectors: ['label:has(input[name="quantity"])'] },
    { id: "cost", selectors: ['label:has(input[name="unitCost"])'] },
    { id: "opening", selectors: [':has(> label > input[name="isOpening"])'] },
    { id: "save", selectors: ['[data-tour="receive-form"] button[type="submit"]'] },
  ],
  sales: [
    { id: "list", selectors: LIST },
    {
      id: "open",
      selectors: ['main table tbody tr:first-child a[href^="/sales/"]'],
      action: "click",
    },
    { id: "receipt", selectors: ['[data-tour="sale-receipt"]'], path: SALE_PAGE },
    { id: "print", selectors: ['[data-tour="page-actions"]'], path: SALE_PAGE },
    { id: "return", selectors: ['[data-tour="sale-return"]'], path: SALE_PAGE },
    { id: "void", selectors: ['[data-tour="sale-void"]'], path: SALE_PAGE },
  ],
  returns: [{ id: "list", selectors: LIST }],
  dispose: [
    { id: "queue", selectors: LIST },
    { id: "history", selectors: ["main div.mt-8"] },
  ],
  counts: [
    { id: "start", selectors: ['[data-tour="page-actions"]'] },
    { id: "list", selectors: LIST },
    {
      id: "open",
      selectors: ['main table tbody tr:first-child a[href^="/counts/"]'],
      action: "click",
    },
    { id: "lines", selectors: ["main table"], path: COUNT_PAGE },
  ],
  alerts: [
    { id: "filter", selectors: ['main form[method="get"]'] },
    { id: "list", selectors: ['main form[method="get"] + *'] },
    { id: "first", selectors: ['main form[method="get"] + * > :first-child'] },
    { id: "actions", selectors: ['[data-tour="alert-actions"]'] },
    { id: "refresh", selectors: ['[data-tour="page-actions"]'] },
  ],
  suppliers: [
    { id: "list", selectors: ["main .divide-y", "main .border-dashed"] },
    { id: "add", selectors: ["main form"] },
  ],
  categories: [
    { id: "list", selectors: ["main .divide-y", "main .border-dashed"] },
    { id: "add", selectors: ["main form"] },
  ],
  reports: [
    { id: "range", selectors: ["main > :nth-child(2)"] },
    { id: "pick", selectors: ['main a[href^="/reports/"]'], action: "click" },
    { id: "tabs", selectors: ["main nav"], path: REPORT_PAGE },
    { id: "result", selectors: ["main table", "main .border-dashed"], path: REPORT_PAGE },
    { id: "export", selectors: ['[data-tour="page-actions"]'], path: REPORT_PAGE },
  ],
  users: [
    { id: "add", selectors: ['[data-tour="page-actions"]'] },
    { id: "list", selectors: ["main table"] },
  ],
  settings: [
    { id: "business", selectors: ["main form section:nth-of-type(1)"] },
    { id: "receipt", selectors: ["main form section:nth-of-type(2)"] },
    { id: "modules", selectors: ["main form section:nth-of-type(3)"] },
    { id: "alerts", selectors: ["main form section:nth-of-type(5)"] },
    { id: "demo", selectors: ["main section.mt-12"] },
  ],
};

/** The first match that is actually drawn: the sidebar and the phone nav both carry every link. */
export function findTarget(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    let found: NodeListOf<HTMLElement>;
    try {
      found = document.querySelectorAll<HTMLElement>(selector);
    } catch {
      continue; // a selector this browser cannot parse, such as :has() on an old one
    }
    for (const el of found) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return el;
    }
  }
  return null;
}
