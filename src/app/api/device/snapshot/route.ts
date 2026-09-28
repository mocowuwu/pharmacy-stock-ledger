import { z } from "zod";
import { getDb } from "@/db";
import { authenticateDevice, fail, json, preflight } from "@/lib/offline/http";
import { buildSnapshot } from "@/lib/offline/devices";

const Body = z.object({ userIds: z.array(z.uuid()).max(200) });

/**
 * The till's copy of the catalogue, and a fresh day's pass to sell from it.
 *
 * Only a device set up as the till gets one: management phones and tablets
 * never hold an offline copy.
 */
export async function POST(request: Request) {
  const auth = await authenticateDevice(request);
  if ("refusal" in auth) return auth.refusal;
  if (auth.device.role !== "till") return fail(request, 403, "not_till");

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(request, 400, "bad_request");

  return json(request, await buildSnapshot(await getDb(), auth.device, parsed.data.userIds));
}

export const OPTIONS = preflight;
