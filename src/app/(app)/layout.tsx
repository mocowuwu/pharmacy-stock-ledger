import { getTranslations } from "next-intl/server";
import { requireSession } from "@/lib/dal/session";
import { canAny, type Permission } from "@/lib/auth/permissions";
import { SidebarNav, TopNav, type NavEntry } from "@/components/Sidebar";
import { signOut } from "../actions";

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
];

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  const t = await getTranslations();

  const entries: NavEntry[] = NAV.filter((entry) =>
    canAny(session.grant, entry.permissions),
  ).map((entry) => ({ key: entry.key, href: entry.href, label: t(`nav.${entry.key}`) }));

  const initials = session.user.fullName
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <div className="flex min-h-screen">
      {/* The sidebar keeps its dark scale in both themes, so the content area
          carries the theme and the navigation stays a constant anchor. */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-sidebar py-5 md:flex">
        <div className="px-6 pb-6">
          <span className="text-lg font-semibold tracking-tight text-sidebar-ink">
            {t("app.name")}
          </span>
          <span className="mt-0.5 block text-xs text-sidebar-muted">
            {t("app.tagline")}
          </span>
        </div>

        <SidebarNav entries={entries} />

        <div className="mt-4 border-t border-sidebar-rule px-3 pt-4">
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
          <form action={signOut}>
            <button
              type="submit"
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-ink"
            >
              {t("nav.signOut")}
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 bg-sidebar px-4 py-3 md:hidden">
          <span className="font-semibold text-sidebar-ink">{t("app.name")}</span>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-lg px-3 py-1.5 text-sm text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-ink"
            >
              {t("nav.signOut")}
            </button>
          </form>
        </header>
        <TopNav entries={entries} />

        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-7 sm:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
