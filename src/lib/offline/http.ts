import "server-only";

import { getDb } from "@/db";
import { APP_ORIGINS, type ApiError } from "./contract";
import { deviceForToken, type DeviceRow } from "./devices";

/**
 * The plumbing shared by the `/api/device/*` routes.
 *
 * The app's own screens are served from `https://localhost` inside the phone,
 * so every call they make to the pharmacy server is cross-origin and needs
 * CORS. Only that origin is allowed: no website can script these routes from
 * someone's browser. No cookies are involved -- the phone authenticates with a
 * bearer token -- so credentials are never allowed either.
 */

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !(APP_ORIGINS as readonly string[]).includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

export function preflight(request: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request) });
}

export function json(request: Request, body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders(request), "Cache-Control": "no-store" },
  });
}

export function fail(
  request: Request,
  status: number,
  error: ApiError["error"],
  minutes?: number,
): Response {
  return json(request, minutes === undefined ? { error } : { error, minutes }, status);
}

export function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/iu.exec(header);
  return match ? match[1] : null;
}

/** The calling device, or the response that refuses it. */
export async function authenticateDevice(
  request: Request,
): Promise<{ device: DeviceRow } | { refusal: Response }> {
  const result = await deviceForToken(await getDb(), bearer(request));
  if (result.ok) return { device: result.device };
  return {
    refusal: fail(request, result.error === "device_revoked" ? 403 : 401, result.error),
  };
}
