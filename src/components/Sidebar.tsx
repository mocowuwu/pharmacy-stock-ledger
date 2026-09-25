"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** "home" is the ungrouped top of the menu: the dashboard and the till. */
export type NavGroup = "home" | "sales" | "stock" | "records" | "admin";

export type NavEntry = {
  key: string;
  href: string;
  label: string;
  group?: NavGroup;
  /** One plain sentence of what the screen is for, for anyone new to it. */
  hint?: string;
};

export type AlertBadge = { total: number; critical: number; label: string };

/**
 * Line icons drawn inline rather than pulled from a package: eight glyphs is
 * less code than a dependency, and they inherit currentColor so the active and
 * hover states need no separate assets.
 */
const ICONS: Record<string, ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="8" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="11" width="7" height="10" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  sell: (
    <>
      <path d="M3 4h2l2.2 10.4a2 2 0 0 0 2 1.6h7.4a2 2 0 0 0 2-1.55L20.5 8H6" />
      <circle cx="10" cy="20" r="1.2" />
      <circle cx="17" cy="20" r="1.2" />
    </>
  ),
  items: (
    <>
      <path d="M12 3 3 7.5v9L12 21l9-4.5v-9L12 3Z" />
      <path d="M3 7.5 12 12l9-4.5M12 12v9" />
    </>
  ),
  receive: (
    <>
      <path d="M3 13h5l1.5 3h5L16 13h5" />
      <path d="M4.5 13 6.8 5.6A2 2 0 0 1 8.7 4.2h6.6a2 2 0 0 1 1.9 1.4L19.5 13v5a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18v-5Z" />
    </>
  ),
  sales: (
    <>
      <path d="M6 3.5 7.5 5 9 3.5 10.5 5 12 3.5 13.5 5 15 3.5 16.5 5 18 3.5v17L16.5 19 15 20.5 13.5 19 12 20.5 10.5 19 9 20.5 7.5 19 6 20.5v-17Z" />
      <path d="M9.5 9h5M9.5 13h5" />
    </>
  ),
  alerts: (
    <>
      <path d="M18 8.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5Z" />
      <path d="M13.7 19a2 2 0 0 1-3.4 0" />
    </>
  ),
  returns: (
    <>
      <path d="M4 9h11a5 5 0 0 1 0 10h-4" />
      <path d="M8 5 4 9l4 4" />
    </>
  ),
  dispose: (
    <>
      <path d="M4 7h16M10 4h4M9 7v11.5M15 7v11.5" />
      <path d="M6 7l1 12.2A1.8 1.8 0 0 0 8.8 21h6.4a1.8 1.8 0 0 0 1.8-1.8L18 7" />
    </>
  ),
  counts: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h5M8 16h3" />
      <path d="m15.2 16.3 1.4 1.4 2.6-2.8" />
    </>
  ),
  reports: (
    <>
      <path d="M4 20V10M9.5 20V4M15 20v-7M20.5 20V7" />
      <path d="M3 20h18" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M16.5 5.4a3.2 3.2 0 0 1 0 5.2M18 14.4a6 6 0 0 1 3 5.6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a2 2 0 0 1-4 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.5 14H3a2 2 0 0 1 0-4h.2A1.6 1.6 0 0 0 4.3 7.2l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 0 1 4 0v.2a1.6 1.6 0 0 0 2.8 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a2 2 0 0 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1Z" />
    </>
  ),
  suppliers: (
    <>
      <path d="M4 21V6.5L12 3l8 3.5V21" />
      <path d="M4 21h16M9.5 21v-5h5v5" />
      <path d="M9 10h1.5M13.5 10H15" />
    </>
  ),
  categories: (
    <>
      <path d="M3.5 11.5V5a1.5 1.5 0 0 1 1.5-1.5h6.5L20.5 12 12 20.5 3.5 11.5Z" />
      <circle cx="8" cy="8" r="1.3" />
    </>
  ),
  // Not menu entries: the report tabs and the history import.
  movements: (
    <>
      <path d="M7 20V5M3.5 8.5 7 5l3.5 3.5" />
      <path d="M17 4v15M13.5 15.5 17 19l3.5-3.5" />
    </>
  ),
  margin: (
    <>
      <path d="M3 17 9 11l4 4 8-8" />
      <path d="M15 7h6v6" />
    </>
  ),
  valuation: (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.8" />
      <path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6" />
      <path d="M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6" />
    </>
  ),
  expiry: (
    <>
      <path d="M7 3h10M7 21h10" />
      <path d="M8 3c0 4.5 8 5 8 9s-8 4.5-8 9M16 3c0 4.5-8 5-8 9s8 4.5 8 9" />
    </>
  ),
  import: (
    <>
      <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4 15v3.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V15" />
    </>
  ),
  // Not menu entries: the Tutorials page's first two guides.
  start: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2.2 4.8-4.8 2.2 2.2-4.8 4.8-2.2Z" />
    </>
  ),
  setup: (
    <>
      <path d="M9 5h11M9 12h11M9 19h11" />
      <path d="m3.5 5 1.2 1.2L7 4M3.5 12l1.2 1.2L7 11" />
      <circle cx="5" cy="19" r="1.3" />
    </>
  ),
};

export function NavIcon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {ICONS[name] ?? ICONS.dashboard}
    </svg>
  );
}

/** Longest matching href wins, so /items/new highlights Items and not the dashboard. */
function isActive(pathname: string, href: string, all: readonly NavEntry[]): boolean {
  const matches = all
    .filter((e) => pathname === e.href || pathname.startsWith(`${e.href}/`))
    .sort((a, b) => b.href.length - a.href.length);
  return matches[0]?.href === href;
}

function Badge({ alerts }: { alerts: AlertBadge }) {
  // Red while anything critical (expired stock) is live, amber otherwise --
  // the same two status colours the Alerts screen uses.
  const tone = alerts.critical > 0 ? "bg-critical text-white" : "bg-warning text-black";
  return (
    <span
      title={alerts.label}
      // On the icon rail it shrinks to a corner count on the bell.
      className={`ml-auto min-w-[1.35rem] shrink-0 rounded-full px-1.5 py-0.5 text-center text-[0.7rem] leading-none font-semibold tabular-nums md:group-data-[collapsed=true]/side:absolute md:group-data-[collapsed=true]/side:top-0.5 md:group-data-[collapsed=true]/side:right-1 md:group-data-[collapsed=true]/side:min-w-[1.1rem] md:group-data-[collapsed=true]/side:px-1 md:group-data-[collapsed=true]/side:text-[0.6rem] ${tone}`}
    >
      {alerts.total > 99 ? "99+" : alerts.total}
      <span className="sr-only"> {alerts.label}</span>
    </span>
  );
}

export function SidebarNav({
  entries,
  groupLabels,
  ariaLabel,
  sellCta,
  alerts,
}: {
  entries: NavEntry[];
  groupLabels: Record<NavGroup, string>;
  ariaLabel: string;
  sellCta: { label: string; hint: string };
  alerts: AlertBadge | null;
}) {
  const pathname = usePathname();

  // Sections keep the order of their first entry, and one left empty by
  // permissions or module switches is simply not drawn -- a heading over
  // nothing is noise.
  const groups: Array<{ group: NavGroup; items: NavEntry[] }> = [];
  for (const entry of entries) {
    const group = entry.group ?? "home";
    const last = groups.find((g) => g.group === group);
    if (last) last.items.push(entry);
    else groups.push({ group, items: [entry] });
  }

  return (
    // The link list scrolls, the sections around it do not: with every module
    // switched on this is fourteen entries, which is taller than a laptop
    // screen, and the sidebar is sticky -- so anything past the fold could not
    // be reached by scrolling the page either, sign-out included.
    //
    // `min-h-0` is what makes it scroll rather than overflow: a flex child's
    // default minimum is its content height, so without it the list refuses to
    // shrink and pushes the bottom section off the screen exactly as before.
    <nav
      aria-label={ariaLabel}
      className="sidebar-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 md:group-data-[collapsed=true]/side:gap-2 md:group-data-[collapsed=true]/side:px-2.5"
    >
      {groups.map(({ group, items }) => (
        <div key={group} className="flex flex-col gap-0.5">
          {groupLabels[group] ? (
            <>
              <p className="px-3 pb-1 text-[0.68rem] font-semibold tracking-[0.12em] text-sidebar-muted/80 uppercase select-none md:group-data-[collapsed=true]/side:hidden">
                {groupLabels[group]}
              </p>
              {/* On the icon rail a heading has no room; a rule keeps the groups apart. */}
              <hr className="mx-2 mb-1.5 hidden border-sidebar-rule md:group-data-[collapsed=true]/side:block" />
            </>
          ) : null}
          {items.map((entry) => {
            const active = isActive(pathname, entry.href, entries);

            // The till is the one screen used all day, so it is a button and
            // not one line among fourteen: whoever sits down should find it
            // without reading the menu.
            if (entry.key === "sell") {
              return (
                <Link
                  key={entry.key}
                  href={entry.href}
                  aria-current={active ? "page" : undefined}
                  title={`${sellCta.label}: ${sellCta.hint}`}
                  data-tour={`nav-${entry.key}`}
                  className={`my-1.5 flex items-center gap-3 rounded-xl px-3 py-2.5 transition-all duration-150 md:group-data-[collapsed=true]/side:justify-center md:group-data-[collapsed=true]/side:px-0 md:group-data-[collapsed=true]/side:py-2 ${
                    active
                      ? "bg-accent text-accent-contrast ring-2 ring-accent-contrast/40"
                      : "bg-accent text-accent-contrast shadow-[0_4px_16px_-4px_var(--accent)] hover:brightness-110"
                  }`}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-contrast/15">
                    <NavIcon name="sell" />
                  </span>
                  <span className="min-w-0 md:group-data-[collapsed=true]/side:sr-only">
                    <span className="block truncate text-sm font-semibold">{sellCta.label}</span>
                    <span className="block truncate text-xs opacity-80">{sellCta.hint}</span>
                  </span>
                </Link>
              );
            }

            return (
              <Link
                key={entry.key}
                href={entry.href}
                aria-current={active ? "page" : undefined}
                title={entry.hint ? `${entry.label}: ${entry.hint}` : entry.label}
                data-tour={`nav-${entry.key}`}
                // "You are here" is a light plate with an accent bar, not the
                // solid accent fill: that fill belongs to the till button, and
                // two solid purple shapes in one menu read as two things to
                // press. White at low alpha works because the sidebar is dark in
                // both themes; the bar is the solid accent, legible in either.
                className={`relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors duration-150 md:group-data-[collapsed=true]/side:justify-center md:group-data-[collapsed=true]/side:px-0 md:group-data-[collapsed=true]/side:py-2.5 ${
                  active
                    ? "bg-white/10 font-medium text-sidebar-ink before:absolute before:top-1.5 before:bottom-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-accent"
                    : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-ink"
                }`}
              >
                <NavIcon name={entry.key} />
                <span className="truncate md:group-data-[collapsed=true]/side:sr-only">{entry.label}</span>
                {entry.key === "alerts" && alerts ? <Badge alerts={alerts} /> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function SignOutIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4" />
      <path d="M10 16l-4-4 4-4M6 12h10" />
    </svg>
  );
}
