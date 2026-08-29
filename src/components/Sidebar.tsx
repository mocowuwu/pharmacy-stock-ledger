"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export type NavEntry = { key: string; href: string; label: string };

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
};

function Icon({ name }: { name: string }) {
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

export function SidebarNav({ entries }: { entries: NavEntry[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-col gap-0.5 px-3">
      {entries.map((entry) => {
        const active = isActive(pathname, entry.href, entries);
        return (
          <Link
            key={entry.key}
            href={entry.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
              active
                ? "bg-accent text-accent-contrast font-medium"
                : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-ink"
            }`}
          >
            <Icon name={entry.key} />
            <span className="truncate">{entry.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** Horizontal version for narrow screens, where a fixed sidebar would eat the width. */
export function TopNav({ entries }: { entries: NavEntry[] }) {
  const pathname = usePathname();

  return (
    <nav className="overflow-x-auto border-b border-sidebar-rule bg-sidebar md:hidden">
      <ul className="flex gap-1 px-3 py-2">
        {entries.map((entry) => {
          const active = isActive(pathname, entry.href, entries);
          return (
            <li key={entry.key}>
              <Link
                href={entry.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm ${
                  active
                    ? "bg-accent text-accent-contrast font-medium"
                    : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-ink"
                }`}
              >
                <Icon name={entry.key} />
                {entry.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
