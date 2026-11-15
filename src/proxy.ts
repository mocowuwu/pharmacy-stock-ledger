import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, STALE_SESSION_PARAM } from "@/lib/auth/session";

/**
 * Optimistic routing only.
 *
 * This runs on every request including prefetches, so it does nothing but look
 * for the presence of a session cookie -- no database call, no permission
 * check. It is a convenience that saves a signed-out visitor a round trip to a
 * page that would redirect them anyway.
 *
 * It is NOT a security control. Whether a cookie exists says nothing about
 * whether it is valid, whose it is, or what they may do. Every one of those
 * questions is answered in the data access layer, next to the data.
 */
const PUBLIC_PATHS = ["/login"];

/**
 * A redirect to the address the client actually used.
 *
 * Not `new URL(path, request.url)`: Next builds `request.url` from the address
 * the server listens on, not the one the client typed, so behind Tailscale
 * Serve it is `http://localhost:3000/...`. The pharmacy PC, where localhost is
 * the server, never notices; a phone is sent to its own localhost and the
 * Android app shows "localhost refused to connect". So the origin comes from
 * the request's own Host (or the proxy's forwarded one).
 *
 * Not a bare relative `Location` either: Next parses the header of a proxy
 * redirect with no base (`new NextURL(location)`) and throws "Invalid URL",
 * which turned every signed-out request into a 500. An absolute URL on the
 * client's own host is accepted, and Next trims it to a relative one itself.
 */
function redirectTo(request: NextRequest, location: string): NextResponse {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto =
    request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(/:$/u, "");
  const base = host ? `${proto}://${host}` : request.url;
  return NextResponse.redirect(new URL(location, base));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!hasCookie && !isPublic) {
    // So a signed-out user who followed a link lands where they meant to.
    const target = pathname !== "/" ? `/login?next=${encodeURIComponent(pathname)}` : "/login";
    return redirectTo(request, target);
  }

  // A page already looked the session up and found it dead: drop the cookie
  // and show the sign-in form, instead of sending it back to the page that
  // sent it here. The worst a forged link can do is sign this browser out.
  if (hasCookie && isPublic && request.nextUrl.searchParams.has(STALE_SESSION_PARAM)) {
    const response = NextResponse.next();
    response.cookies.delete(SESSION_COOKIE);
    return response;
  }

  if (hasCookie && isPublic) {
    return redirectTo(request, "/");
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
