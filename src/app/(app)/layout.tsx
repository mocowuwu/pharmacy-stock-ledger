import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/dal/session";
import { canAny, type Permission } from "@/lib/auth/permissions";
import { SidebarNav, TopNav, type NavEntry } from "@/components/Sidebar";
import { getSettings } from "@/lib/dal/settings";
import { MODULE_NAV, moduleFlags, type ModuleKey } from "@/lib/catalogue/modules";
import { TutorialLauncher, TutorialProvider } from "@/components/Tutorial";
import { signOut } from "../actions";
import { markTutorialSeenAction } from "./tutorial-actions";

/**
 * Navigation is generated from the signed-in user's permissions: a cashier does
 * not see a locked Reports link, they see no Reports link.
 *
 * Only built sections appear, so the nav can never advertise a screen that does
 * not exist.
 */
const NAV: Array<{ key: string; href: string; permissions: Permission[] }> = [
  { key: "dashboard", href: "/", permissions: ["items.view"] },
  { key: "sell", href: "/sell", permissions: ["sales.create"] },
  { key: "items", href: "/items", permissions: ["items.view"] },
  { key: "receive", href: "/receive", permissions: ["batches.receive"] },
  { key: "sales", href: "/sales", permissions: ["sales.create"] },
  { key: "returns", href: "/returns", permissions: ["sales.return"] },
  { key: "dispose", href: "/dispose", permissions: ["stock.dispose"] },
  { key: "counts", href: "/counts", permissions: ["stock.count"] },
  { key: "alerts", href: "/alerts", permissions: ["alerts.view"] },
  { key: "suppliers", href: "/suppliers", permissions: ["items.view"] },
  { key: "categories", href: "/categories", permissions: ["items.view"] },
  // Reports appears for anyone holding either half of the split: a manager may
  // be able to see what sold without being able to see what it cost.
  { key: "reports", href: "/reports", permissions: ["reports.sales", "reports.financial"] },
  { key: "users", href: "/users", permissions: ["users.manage"] },
  { key: "settings", href: "/settings", permissions: ["settings.manage"] },
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
  ).map((entry) => ({ key: entry.key, href: entry.href, label: t(`nav.${entry.key}`) }));

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
      <div className="flex min-h-screen">
        {/* The sidebar keeps its dark scale in both themes, so the content area
            carries the theme and the navigation stays a constant anchor. */}
        <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col bg-sidebar py-5 md:flex">
          <div className="flex items-center gap-3 px-5 pb-6">
            {/* The mark is the business's own initial, not a logo we invented:
                the name is the owner's, and a fixed glyph would go stale the
                moment they rename the pharmacy in Settings. */}
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-base font-bold text-accent-contrast"
            >
              {(settings.businessName || t("app.name")).trim().charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[0.95rem] leading-tight font-semibold tracking-tight text-sidebar-ink">
                {settings.businessName || t("app.name")}
              </span>
              <span className="mt-0.5 block truncate text-xs text-sidebar-muted">
                {settings.businessTagline || t("app.tagline")}
              </span>
            </span>
          </div>

          <SidebarNav entries={entries} />

          <div className="mt-4 shrink-0 border-t border-sidebar-rule px-3 pt-4">
            <div className="flex items-center gap-3 px-3 pb-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                {initials}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm text-sidebar-ink">
                  {session.user.fullName}
                </span>
                <span className="block text-xs text-sidebar-muted">
                  {session.user.isOwner ? t("account.owner") : t("account.staff")}
                </span>
              </span>
            </div>
            <TutorialLauncher variant="block" />
            <form action={signOut}>
              <button
                type="submit"
                className="w-full rounded-xl px-3 py-2 text-left text-sm text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-ink"
              >
                {t("nav.signOut")}
              </button>
            </form>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Sticky on a phone: the section links are how you move around when
              there is no sidebar, and hunting for them means scrolling a long
              table back to the top. */}
          <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-sidebar-rule bg-sidebar px-4 py-3 md:hidden">
            <span className="font-semibold text-sidebar-ink">
              {settings.businessName || t("app.name")}
            </span>
            <div className="flex items-center gap-1">
              <TutorialLauncher variant="compact" />
              <form action={signOut}>
                <button
                  type="submit"
                  className="rounded-lg px-3 py-1.5 text-sm text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-ink"
                >
                  {t("nav.signOut")}
                </button>
              </form>
            </div>
          </header>
          <TopNav entries={entries} />

          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-7 sm:px-8 sm:py-9">
            {children}
          </main>
        </div>
      </div>
    </TutorialProvider>
  );
}
