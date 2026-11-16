import { z } from "zod";
import { getDb } from "@/db";
import { recordAudit } from "@/lib/audit";
import { resolveSession } from "@/lib/auth/session";
import { authenticateDevice, fail, json, preflight, TILL_SESSION_HEADER } from "@/lib/offline/http";
import { bookTillSale } from "@/lib/offline/till-sale";
import { PAYMENT_METHODS, type ApiError } from "@/lib/offline/contract";

const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const Body = z.object({
  clientId: z.uuid(),
  lines: z
    .array(z.object({ itemId: z.uuid(), qty: z.number().int().positive(), unitPrice: money }))
    .min(1)
    .max(200),
  discount: money,
  paymentMethod: z.enum(PAYMENT_METHODS),
  tendered: money.nullable(),
  notes: z.string().max(500).nullable(),
  total: money,
});

/**
 * A sale from the Android till while it is online. Two credentials: the
 * device token says which phone, the till session says which cashier -- the
 * person is never taken from the request body. Booked at once, or refused at
 * once; an offline-style review list is for medicine that has already left.
 */
export async function POST(request: Request) {
  const auth = await authenticateDevice(request);
  if ("refusal" in auth) return auth.refusal;

  const token = request.headers.get(TILL_SESSION_HEADER) ?? "";
  const session = token ? await resolveSession(token) : null;
  if (!session || session.user.mustChangePassword) return fail(request, 401, "session_ended");

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(request, 400, "bad_request");

  const db = await getDb();
  const outcome = await bookTillSale(
    db,
    auth.device,
    { id: session.user.id, isPharmacist: session.user.isPharmacist, grant: session.grant },
    parsed.data,
  );
  if (!outcome.ok) {
    if (outcome.code === "not_till") return fail(request, 403, "not_till");
    const body: ApiError = { error: "refused", code: outcome.code, ...(outcome.detail ? { detail: outcome.detail } : {}) };
    return json(request, body, 409);
  }

  if (outcome.response.status === "posted") {
    await recordAudit({
      userId: session.user.id,
      actorLabel: session.user.username,
      action: "sale.created",
      entityType: "sales",
      entityId: outcome.saleId,
      after: {
        saleNumber: outcome.response.saleNumber,
        total: outcome.response.total,
        via: "android_app",
        deviceId: auth.device.id,
      },
    });
  }
  return json(request, outcome.response);
}

export const OPTIONS = preflight;
