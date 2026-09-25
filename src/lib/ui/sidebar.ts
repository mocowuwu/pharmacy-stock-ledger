/**
 * Shared between the server layout, which reads the cookie so the sidebar is
 * drawn at the right width on the first paint, and the client shell, which
 * writes it. Kept out of the "use client" module: a constant imported from one
 * into a server component arrives as a client reference, not as the string.
 */

/** "1" when the desktop sidebar is collapsed to its icon rail. A per-browser
 *  preference: the till by the door and the owner's laptop may want different
 *  ones, and it decides nothing about what anyone may do. */
export const SIDEBAR_COOKIE = "sidebar_collapsed";

/** Dispatched on `window` by the tutorial when it needs the menu on screen --
 *  on a phone the menu is a drawer, and a menu step cannot point at a link
 *  that is off the edge of the screen. */
export const REVEAL_NAV_EVENT = "pharmacy:reveal-nav";

/** The counterpart: a step on the page itself needs the drawer out of the way. */
export const HIDE_NAV_EVENT = "pharmacy:hide-nav";
