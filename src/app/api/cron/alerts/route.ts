import { getDb } from "@/db";
import { runAlertJob } from "@/lib/alerts/job";
import { cronAuthorized } from "@/lib/cron";

/**
 * The nightly alert job, for the hosted demo.
 *
 * On a clinic machine the installer's supervisor runs `scripts/run-alerts.ts`;
 * Vercel has no long-running process, so `vercel.json` schedules this instead.
 * Same function, same result: expired stock quarantined, alerts reconciled.
 */
export async function GET(request: Request) {
  if (!cronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const result = await runAlertJob(await getDb());
  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
