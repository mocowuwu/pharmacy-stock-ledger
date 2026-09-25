import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/dal/session";
import { canAny, type Permission } from "@/lib/auth/permissions";
import { cookies } from "next/headers";
import { SidebarNav, SignOutIcon, type NavEntry, type NavGroup } from "@/components/Sidebar";
import { SidebarShell } from "@/components/SidebarShell";
import { SIDEBAR_COOKIE } from "@/lib/ui/sidebar";
import { alertBadge } from "@/lib/dal/alerts";
import { getSettings } from "@/lib/dal/settings";
import { MAKER } from "@/lib/brand";
import { MODULE_NAV, moduleFlags, type ModuleKey } from "@/lib/catalogue/modules";
import { TutorialLauncher, TutorialProvider } from "@/components/Tutorial";
import { signOut } from "../actions";
import { markTutorialSeenAction } from "./tutorial-actions";
import { isDemo } from "@/lib/demo";

/**
 * Navigation is generated from the signed-in user's permissions: a cashier does
 * not see a locked Reports link, they see no Reports link.
 *
 * Only built sections appear, so the nav can never advertise a screen that does
 * not exist.
 */
const NAV: Array<{ key: string; href: string; group: NavGroup; permissions: Permission[] }> = [
  { key: "dashboard", href: "/", group: "home", permissions: ["items.view"] },
  { key: "sell", href: "/sell", group: "home", permissions: ["sales.create"] },
  { key: "sales", href: "/sales", group: "sales", permissions: ["sales.create"] },
  { key: "returns", href: "/returns", group: "sales", permissions: ["sales.return"] },
  { key: "items", href: "/items", group: "stock", permissions: ["items.view"] },
  { key: "receive", href: "/receive", group: "stock", permissions: ["batches.receive"] },
  { key: "alerts", href: "/alerts", group: "stock", permissions: ["alerts.view"] },
  { key: "counts", href: "/counts", group: "stock", permissions: ["stock.count"] },
  { key: "dispose", href: "/dispose", group: "stock", permissions: ["stock.dispose"] },
  // Reports appears for anyone holding either half of the split: a manager may
  // be able to see what sold without being able to see what it cost.
  { key: "reports", href: "/reports", group: "records", permissions: ["reports.sales", "reports.financial"] },
  { key: "suppliers", href: "/suppliers", group: "records", permissions: ["items.view"] },
  { key: "categories", href: "/categories", group: "records", permissions: ["items.view"] },
  { key: "users", href: "/users", group: "admin", permissions: ["users.manage"] },
  { key: "settings", href: "/settings", group: "admin", permissions: ["settings.manage"] },
];

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  const t = await getTranslations();

  // Two filters, and they are not the same kind of thing. Permissions decide
  // what somebody may do; the module switches only decide what is worth showing
  // them. A hidden screen is still reachable by URL and still works -- that is
  // the difference between a courtesy and a control.
  const settings = await getSettings();
  const flags = moduleFlags(settings);
  const hidden = new Set(
    (Object.keys(MODULE_NAV) as ModuleKey[])
      .filter((module) => !flags[module])
      .flatMap((module) => MODULE_NAV[module] ?? []),
  );

  const entries: NavEntry[] = NAV.filter(
    (entry) => canAny(session.grant, entry.permissions) && !hidden.has(entry.key),
  ).map((entry) => ({
    key: entry.key,
    href: entry.href,
    group: entry.group,
    label: t(`nav.${entry.key}`),
    hint: t(`nav.hints.${entry.key}`),
  }));

  // A number on the Alerts entry is what makes the menu answer "is anything
  // wrong?" without opening a screen. Only for people who may see alerts.
  const badge = entries.some((e) => e.key === "alerts") ? await alertBadge() : null;
  const groupLabels: Record<NavGroup, string> = {
    home: "",
    sales: t("nav.groups.sales"),
    stock: t("nav.groups.stock"),
    records: t("nav.groups.records"),
    admin: t("nav.groups.admin"),
  };

  const businessName = settings.businessName || t("app.name");
  // Read here so the first paint is already the width the person chose.
  const collapsedInitially = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";

  const initials = session.user.fullName
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <TutorialProvider
      chapters={entries}
      isOwner={session.user.isOwner}
      seen={session.user.tutorialSeenAt !== null}
      onSeen={markTutorialSeenAction}
    >
      <SidebarShell
        collapsedInitially={collapsedInitially}
        labels={{
          open: t("nav.openMenu"),
          close: t("nav.closeMenu"),
          collapse: t("nav.collapse"),
          expand: t("nav.expand"),
        }}
        brand={
          <div className="flex items-center gap-3">
            {/* The mark is the business's own initial, not a logo we invented:
                the name is the owner's, and a fixed glyph would go stale the
                moment they rename the pharmacy in Settings. */}
            <span
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-lg font-bold text-accent-contrast shadow-[0_4px_14px_-4px_var(--accent)]"
            >
              {businessName.trim().charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 md:group-data-[collapsed=true]/side:sr-only">
              <span className="flex items-center gap-2">
                <span className="truncate text-[0.95rem] leading-tight font-semibold tracking-tight text-sidebar-ink">
                  {businessName}
                </span>
                {isDemo() && (
                  <span title={t("app.demoHint")} className="shrink-0 rounded-md border border-warning/30 bg-warning-soft px-1.5 py-0.5 text-[0.65rem] font-semibold tracking-wide text-warning-ink uppercase">
                    {t("app.demoBadge")}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block truncate text-xs text-sidebar-muted">
                {settings.businessTagline || t("app.tagline")}
              </span>
            </span>
          </div>
        }
        mobileTitle={businessName}
        mobileActions={<TutorialLauncher variant="compact" />}
        sidebar={
          <>
            <SidebarNav
              entries={entries}
              groupLabels={groupLabels}
              ariaLabel={t("nav.menu")}
              sellCta={{ label: t("nav.sellCta"), hint: t("nav.sellCtaHint") }}
              alerts={
                badge && badge.total > 0
                  ? {
                      ...badge,
                      label: t("nav.alertsBadge", { count: badge.total, critical: badge.critical }),
                    }
                  : null
              }
            />

            <div className="mt-3 shrink-0 border-t border-sidebar-rule px-3 pt-3 md:group-data-[collapsed=true]/side:px-2.5">
              <div
                title={session.user.fullName}
                className="flex items-center gap-3 rounded-xl bg-sidebar-hover/60 px-3 py-2.5 md:group-data-[collapsed=true]/side:justify-center md:group-data-[collapsed=true]/side:bg-transparent md:group-data-[collapsed=true]/side:px-0"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                  {initials}
                </span>
                <span className="min-w-0 md:group-data-[collapsed=true]/side:sr-only">
                  <span className="block truncate text-sm font-medium text-sidebar-ink">
                    {session.user.fullName}
                  </span>
                  <span className="block text-xs text-sidebar-muted">
                    {session.user.isOwner ? t("account.owner") : t("account.staff")}
                  </span>
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1 md:group-data-[collapsed=true]/side:grid-cols-1">
                <TutorialLauncher variant="block" />
                <form action={signOut}>
                  <button
                    type="submit"
                    title={t("nav.signOut")}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-ink md:group-data-[collapsed=true]/side:justify-center md:group-data-[collapsed=true]/side:px-0"
                  >
                    <SignOutIcon />
                    <span className="md:group-data-[collapsed=true]/side:sr-only">{t("nav.signOut")}</span>
                  </button>
                </form>
              </div>
              <p className="px-3 pt-2 text-[0.7rem] font-medium tracking-[0.2em] text-sidebar-muted/70 select-none md:group-data-[collapsed=true]/side:hidden">
                {MAKER}
              </p>
            </div>
          </>
        }
      >
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-7 sm:px-8 sm:py-9">
          {children}
        </main>
        {/* On a phone the sidebar is tucked away, so the maker's mark sits
            under the page too. Never printed: the receipt belongs to the
            pharmacy. */}
        <p className="pb-5 text-center text-[0.7rem] font-medium tracking-[0.2em] text-faint select-none md:hidden print:hidden">
          {MAKER}
        </p>
      </SidebarShell>
    </TutorialProvider>
  );
}
