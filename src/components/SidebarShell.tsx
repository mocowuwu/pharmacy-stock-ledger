"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { HIDE_NAV_EVENT, REVEAL_NAV_EVENT, SIDEBAR_COOKIE } from "@/lib/ui/sidebar";

/**
 * One sidebar, two behaviours.
 *
 * - **Desktop (md and up):** always there, and collapsible to an icon rail for
 *   a narrow screen or a till that wants the room. The choice is a cookie so
 *   the server draws the right width on the first paint instead of the page
 *   jumping once the script runs.
 * - **Phone or portrait tablet:** hidden, and slides in over the page from a
 *   menu button. It replaced a horizontally scrolling strip of fourteen links,
 *   which nobody could read at a glance.
 *
 * It is the same element in both, not two copies, so the tutorial's anchors
 * and the links' state exist once. Whatever sits inside reacts to
 * `data-collapsed` through the `group/side` CSS variants, which lets the
 * server-rendered menu and footer change shape without becoming client code.
 */
export function SidebarShell({
  collapsedInitially,
  brand,
  mobileTitle,
  mobileActions,
  labels,
  sidebar,
  children,
}: {
  collapsedInitially: boolean;
  /** The mark and name at the top of the sidebar. */
  brand: ReactNode;
  /** What the phone's top bar says: the pharmacy's name. */
  mobileTitle: ReactNode;
  /** Small buttons on the right of the phone's top bar. */
  mobileActions: ReactNode;
  labels: { open: string; close: string; collapse: string; expand: string };
  /** The menu and the account section, below the brand. */
  sidebar: ReactNode;
  children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(collapsedInitially);
  const [open, setOpen] = useState(false);
  // Assumed desktop until measured, so the sidebar is never made inert on a
  // desktop for the moment before the script runs.
  const [isDesktop, setIsDesktop] = useState(true);
  const pathname = usePathname();

  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // Choosing a screen closes the drawer: the point of opening it was to leave.
  // Adjusted while rendering rather than in an effect, as React wants state
  // that follows a changed input.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    const reveal = () => setOpen(true);
    const hide = () => setOpen(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener(REVEAL_NAV_EVENT, reveal);
    window.addEventListener(HIDE_NAV_EVENT, hide);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(REVEAL_NAV_EVENT, reveal);
      window.removeEventListener(HIDE_NAV_EVENT, hide);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  // The page behind an open drawer should not scroll under the finger.
  const drawerOpen = open && !isDesktop;
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <div className="flex min-h-screen">
      {drawerOpen ? (
        <div
          aria-hidden="true"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px] md:hidden print:hidden"
        />
      ) : null}

      {/* The sidebar keeps its dark scale in both themes, so the content area
          carries the theme and the navigation stays a constant anchor. */}
      <aside
        id="app-sidebar"
        data-collapsed={collapsed}
        // Off-screen on a phone is still focusable and still read aloud;
        // inert takes it out of both until it is opened.
        inert={!isDesktop && !open}
        className={`group/side fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-sidebar py-5 shadow-2xl transition-transform duration-200 md:sticky md:top-0 md:z-auto md:h-screen md:max-w-none md:translate-x-0 md:shadow-none md:transition-[width] ${
          open ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "md:w-[4.75rem]" : "md:w-64"}`}
      >
        <div className="flex items-center gap-2 pr-3 pb-5 pl-5 md:group-data-[collapsed=true]/side:flex-col md:group-data-[collapsed=true]/side:gap-3 md:group-data-[collapsed=true]/side:px-0">
          <div className="min-w-0 flex-1 md:group-data-[collapsed=true]/side:flex-none">{brand}</div>

          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? labels.expand : labels.collapse}
            title={collapsed ? labels.expand : labels.collapse}
            aria-expanded={!collapsed}
            aria-controls="app-sidebar"
            className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sidebar-muted transition-colors hover:bg-sidebar-hover hover:text-sidebar-ink md:flex"
          >
            <PanelIcon flipped={collapsed} />
          </button>

          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={labels.close}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-ink md:hidden"
          >
            <CloseIcon />
          </button>
        </div>

        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Sticky on a phone, so the menu button is always one tap away, even
            at the bottom of a long table. */}
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-sidebar-rule bg-sidebar/90 px-2 py-2 backdrop-blur-md md:hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={labels.open}
            aria-expanded={open}
            aria-controls="app-sidebar"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sidebar-ink hover:bg-sidebar-hover"
          >
            <MenuIcon />
          </button>
          <span className="min-w-0 flex-1 truncate font-semibold text-sidebar-ink">{mobileTitle}</span>
          <div className="flex shrink-0 items-center">{mobileActions}</div>
        </header>

        {children}
      </div>
    </div>
  );
}

const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function MenuIcon() {
  return (
    <svg {...iconProps} width="22" height="22">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg {...iconProps} width="20" height="20">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

/** A panel with its edge, and an arrow saying which way pressing it moves it. */
function PanelIcon({ flipped }: { flipped: boolean }) {
  return (
    <svg {...iconProps} width="18" height="18">
      <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
      <path d="M9 4v16" />
      <path d={flipped ? "m13.5 10 2 2-2 2" : "m15.5 10-2 2 2 2"} />
    </svg>
  );
}
