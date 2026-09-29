import { publicBranding } from "@/lib/dal/settings";
import { json, preflight } from "@/lib/offline/http";
import type { PingResponse } from "@/lib/offline/contract";
import pkg from "../../../../../package.json";

/**
 * "Is the pharmacy server there?" -- asked by the app every few seconds while
 * it is offline. Open, like the sign-in screen: it says no more than that
 * screen already shows.
 */
export async function GET(request: Request) {
  const branding = await publicBranding();
  const body: PingResponse = {
    ok: true,
    app: "pharmacy-stock-ledger",
    version: pkg.version,
    businessName: branding.businessName ?? "",
    serverTime: new Date().toISOString(),
  };
  return json(request, body);
}

export const OPTIONS = preflight;
