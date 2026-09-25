import type { Grant, Permission } from "@/lib/auth/permissions";
import { canAny } from "@/lib/auth/permissions";
import type { ModuleFlags, ModuleKey } from "@/lib/catalogue/modules";

/**
 * The written tutorials: one guide per job someone does here, each a set of
 * sections of numbered steps. The words live in the message catalogues under
 * `guides.items.<key>`; this module only says which guides exist, who they are
 * for, and which screens the "show me" tour should walk through.
 *
 * A guide is offered to whoever holds any of its permissions -- the same rule
 * the menu uses -- so a cashier's list is a cashier's list. A section can be
 * narrower than its guide: the cashier guide explains discounts only to
 * someone who may give one. Hiding a guide is a courtesy like hiding a menu
 * entry; the permissions are still what the server checks.
 *
 * A module switched off hides its guide or section too: a walkthrough of a
 * screen that is not in the menu teaches the person to look for something
 * that is not there.
 */
export type GuideSection = {
  id: string;
  /** Shown only to holders of any of these. Omitted means everyone who sees the guide. */
  permissions?: readonly Permission[];
  module?: ModuleKey;
  /** Owner-only, for things no permission grants (clearing the demo data). */
  ownerOnly?: boolean;
  tip?: boolean;
  warn?: boolean;
};

export type Guide = {
  key: string;
  icon: string;
  /** Any one of these makes the guide appear. Empty means everyone. */
  permissions: readonly Permission[];
  module?: ModuleKey;
  ownerOnly?: boolean;
  /** Sidebar entries the on-screen tour walks through for this guide. */
  tour: readonly string[];
  sections: readonly GuideSection[];
};

export const GUIDES: readonly Guide[] = [
  {
    key: "start",
    icon: "start",
    permissions: [],
    tour: [],
    sections: [
      { id: "signIn", tip: true },
      { id: "menu", tip: true },
      { id: "dashboard", permissions: ["items.view"] },
      { id: "alerts", permissions: ["alerts.view"] },
      { id: "rules", warn: true },
      { id: "help" },
    ],
  },
  {
    key: "setup",
    icon: "setup",
    permissions: ["settings.manage"],
    ownerOnly: true,
    tour: ["settings", "categories", "suppliers", "items", "receive", "users"],
    sections: [
      { id: "demo", warn: true },
      { id: "details" },
      { id: "lists", tip: true },
      { id: "catalogue" },
      { id: "opening", warn: true },
      { id: "staff" },
      { id: "count", tip: true },
    ],
  },
  {
    key: "cashier",
    icon: "sell",
    permissions: ["sales.create"],
    tour: ["sell", "sales"],
    sections: [
      { id: "open", tip: true },
      { id: "find", tip: true },
      { id: "basket", warn: true },
      { id: "batch", tip: true },
      { id: "batchOverride", permissions: ["sales.batch_override"] },
      { id: "price", permissions: ["sales.price_override"] },
      { id: "discount", permissions: ["sales.discount"] },
      { id: "pay" },
      { id: "finish", tip: true },
      { id: "classes", warn: true },
      { id: "mistakes", warn: true },
      { id: "history" },
    ],
  },
  {
    key: "returns",
    icon: "returns",
    permissions: ["sales.return", "sales.void"],
    tour: ["sales", "returns"],
    sections: [
      { id: "which", tip: true },
      { id: "void", permissions: ["sales.void"], warn: true },
      { id: "return", permissions: ["sales.return"], module: "returns" },
      { id: "quarantine", permissions: ["sales.return"], module: "returns", warn: true },
      { id: "after", permissions: ["sales.return"], module: "returns" },
    ],
  },
  {
    key: "delivery",
    icon: "receive",
    permissions: ["batches.receive"],
    tour: ["receive", "items"],
    sections: [
      { id: "before", warn: true },
      { id: "scan", module: "barcodes", tip: true },
      { id: "form" },
      { id: "lot", tip: true },
      { id: "expiry", warn: true },
      { id: "quantity", tip: true },
      { id: "save" },
      { id: "wrong", warn: true },
    ],
  },
  {
    key: "medicines",
    icon: "items",
    permissions: ["items.create", "items.edit", "items.import", "items.archive"],
    tour: ["items", "categories"],
    sections: [
      { id: "check", tip: true },
      { id: "basics", permissions: ["items.create"] },
      { id: "class", permissions: ["items.create", "items.edit"], warn: true },
      { id: "units", permissions: ["items.create", "items.edit"], tip: true },
      { id: "stockLevels", permissions: ["items.create", "items.edit"] },
      { id: "price", permissions: ["items.set_price"] },
      { id: "barcodes", permissions: ["items.create", "items.edit"], module: "barcodes" },
      { id: "then", permissions: ["items.create"], warn: true },
      { id: "import", permissions: ["items.import"], module: "import", tip: true },
      { id: "edit", permissions: ["items.edit", "items.archive"] },
    ],
  },
  {
    key: "suppliers",
    icon: "suppliers",
    permissions: ["suppliers.manage", "items.create"],
    tour: ["suppliers", "categories"],
    sections: [
      { id: "suppliers", permissions: ["suppliers.manage"], module: "suppliers" },
      { id: "categories", permissions: ["items.create"], module: "categories", tip: true },
    ],
  },
  {
    key: "alerts",
    icon: "alerts",
    permissions: ["alerts.view"],
    tour: ["dashboard", "alerts"],
    sections: [
      { id: "kinds" },
      { id: "routine", tip: true },
      { id: "act", permissions: ["alerts.manage"] },
      { id: "critical", warn: true },
    ],
  },
  {
    key: "disposal",
    icon: "dispose",
    permissions: ["stock.dispose"],
    module: "dispose",
    tour: ["dispose"],
    sections: [
      { id: "when" },
      { id: "steps", warn: true },
      { id: "why", tip: true },
    ],
  },
  {
    key: "counts",
    icon: "counts",
    permissions: ["stock.count"],
    module: "counts",
    tour: ["counts"],
    sections: [
      { id: "when", tip: true },
      { id: "start" },
      { id: "count", warn: true },
      { id: "enter" },
      { id: "post", warn: true },
    ],
  },
  {
    key: "reports",
    icon: "reports",
    permissions: ["reports.sales", "reports.financial"],
    tour: ["reports"],
    sections: [
      { id: "period" },
      { id: "sales", permissions: ["reports.sales"] },
      { id: "movements", permissions: ["reports.sales"], tip: true },
      { id: "money", permissions: ["reports.financial"] },
      { id: "export", tip: true },
      { id: "history", permissions: ["sales.import_history"], warn: true },
    ],
  },
  {
    key: "accounts",
    icon: "users",
    permissions: ["users.manage"],
    tour: ["users"],
    sections: [
      { id: "create", tip: true },
      { id: "permissions", warn: true },
      { id: "password", warn: true },
      { id: "manage" },
      { id: "owner" },
    ],
  },
  {
    key: "settings",
    icon: "settings",
    permissions: ["settings.manage"],
    tour: ["settings"],
    sections: [
      { id: "business" },
      { id: "receipt" },
      { id: "modules", tip: true },
      { id: "tax", warn: true },
      { id: "thresholds" },
      { id: "returns" },
      { id: "demo", ownerOnly: true, warn: true },
    ],
  },
];

type Access = { grant: Grant; flags: ModuleFlags };

function allowed(
  entry: { permissions?: readonly Permission[]; module?: ModuleKey; ownerOnly?: boolean },
  { grant, flags }: Access,
): boolean {
  if (entry.ownerOnly && !grant.isOwner) return false;
  if (entry.module && !flags[entry.module]) return false;
  return !entry.permissions?.length || canAny(grant, entry.permissions);
}

/** The guides this account is offered, each cut down to the sections that apply to it. */
export function guidesFor(access: Access): Guide[] {
  return GUIDES.filter((guide) => allowed(guide, access))
    .map((guide) => ({
      ...guide,
      sections: guide.sections.filter((section) => allowed(section, access)),
    }))
    .filter((guide) => guide.sections.length > 0);
}
