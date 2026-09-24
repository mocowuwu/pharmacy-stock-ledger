import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { SESSION_COOKIE, STALE_SESSION_PARAM } from "@/lib/auth/session";

function request(path: string, cookie?: string) {
  return new NextRequest(new URL(path, "http://pharmacy.local"), {
    headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
  });
}

describe("proxy", () => {
  it("sends a signed-out visitor to sign in", () => {
    const res = proxy(request("/items"));
    expect(res.headers.get("location")).toBe("http://pharmacy.local/login?next=%2Fitems");
  });

  it("sends a browser holding a cookie away from the sign-in form", () => {
    const res = proxy(request("/login", "token"));
    expect(res.headers.get("location")).toBe("http://pharmacy.local/");
  });

  // The loop this guards against: a revoked session's cookie made every page
  // redirect to /login, and /login redirect back to /, until the browser gave
  // up. A page that finds the session dead marks the redirect; the proxy must
  // then show the form and drop the cookie, not bounce it again.
  it("drops a cookie a page has found dead, and shows the form", () => {
    const res = proxy(request(`/login?${STALE_SESSION_PARAM}=1`, "revoked"));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("set-cookie")).toMatch(
      new RegExp(`^${SESSION_COOKIE}=;.*Expires=Thu, 01 Jan 1970`),
    );
  });
});
