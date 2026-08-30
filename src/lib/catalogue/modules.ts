/**
 * Optional modules.
 *
 * The pharmacy does not use every part of the system, and a menu full of
 * screens nobody opens makes the ones that matter harder to find. These
 * switches decide what is *shown*.
 *
 * **A module switch is a courtesy, never a control.** Turning one off hides its
 * menu entry and its entry points. It does not refuse a request, and it does
 * not hide data already recorded: a return booked last month still appears on
 * its sale after returns are switched off, and an item already classed as
 * psikotropika still shows that class. A courtesy that starts refusing is a
 * control with no audit trail behind it -- and permissions are the control.
 *
 * That is also why nothing safety-related is listed here. Expired stock is
 * refused at the till, expired-stock alerts cannot be dismissed, and the ledger
 * records every movement, whatever is switched on.
 */

export const MODULES = [
  "returns",
  "barcodes",
  "tax",
  "narkotika",
  "suppliers",
  "categories",
  "counts",
  "dispose",
] as const;

export type ModuleKey = (typeof MODULES)[number];

/** The settings column each switch reads. */
export const MODULE_SETTING = {
  returns: "returnsEnabled",
  barcodes: "barcodesEnabled",
  tax: "taxEnabled",
  narkotika: "narkotikaEnabled",
  suppliers: "suppliersEnabled",
  categories: "categoriesEnabled",
  counts: "countsEnabled",
  dispose: "disposeEnabled",
} as const satisfies Record<ModuleKey, string>;

export type ModuleFlags = Record<ModuleKey, boolean>;

/** Reads the switches off a settings row, so callers need not know the columns. */
export function moduleFlags(settings: {
  returnsEnabled: boolean;
  barcodesEnabled: boolean;
  taxEnabled: boolean;
  narkotikaEnabled: boolean;
  suppliersEnabled: boolean;
  categoriesEnabled: boolean;
  countsEnabled: boolean;
  disposeEnabled: boolean;
}): ModuleFlags {
  return {
    returns: settings.returnsEnabled,
    barcodes: settings.barcodesEnabled,
    tax: settings.taxEnabled,
    narkotika: settings.narkotikaEnabled,
    suppliers: settings.suppliersEnabled,
    categories: settings.categoriesEnabled,
    counts: settings.countsEnabled,
    dispose: settings.disposeEnabled,
  };
}

/**
 * Nav entries a switched-off module hides. Anything not listed is always shown.
 *
 * The screens themselves stay reachable by URL: somebody following a link from
 * an old receipt to a return should find it, not a dead end.
 */
export const MODULE_NAV: Partial<Record<ModuleKey, readonly string[]>> = {
  returns: ["returns"],
  suppliers: ["suppliers"],
  categories: ["categories"],
  counts: ["counts"],
  dispose: ["dispose"],
};

/**
 * Drug classes that only appear in the item form while their module is on.
 *
 * Hidden from the *options*, never from a saved value -- an item already
 * carrying one of these keeps showing it, or the catalogue would start lying
 * about what is on the shelf.
 */
export const MODULE_DRUG_CLASSES: Partial<Record<ModuleKey, readonly string[]>> = {
  narkotika: ["psikotropika", "narkotika"],
};
