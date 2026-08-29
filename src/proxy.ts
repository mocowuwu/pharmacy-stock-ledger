import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

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

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!hasCookie && !isPublic) {
    const url = new URL("/login", request.url);
    // So a signed-out user who followed a link lands where they meant to.
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (hasCookie && isPublic) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
