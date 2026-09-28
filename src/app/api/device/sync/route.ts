import { z } from "zod";
import { getDb } from "@/db";
import { recordAudit } from "@/lib/audit";
import { authenticateDevice, fail, json, preflight } from "@/lib/offline/http";
import { replayOfflineSale } from "@/lib/offline/replay";
import { PAYMENT_METHODS, type SyncResult } from "@/lib/offline/contract";

const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

const Sale = z.object({
  clientId: z.uuid(),
  offlineNumber: z.string().regex(/^OFF-[A-Z0-9]{3}-\d{4,}$/u),
  passId: z.uuid(),
  elapsedMs: z.number().int(),
  deviceTime: z.string().max(40),
  cashierId: z.uuid(),
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

const Body = z.object({ sales: z.array(Sale).max(1000) });

/**
 * The offline queue, arriving. Sales are booked in the order the phone rang
 * them, each in its own transaction, so one that cannot be booked does not hold
 * back the rest. Every sale gets an answer -- booked, sent to review, or
 * already received -- and the phone may forget it once it has one.
 */
export async function POST(request: Request) {
  const auth = await authenticateDevice(request);
  if ("refusal" in auth) return auth.refusal;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(request, 400, "bad_request");

  const db = await getDb();
  const results: SyncResult[] = [];
  for (const sale of parsed.data.sales) {
    const { saleId, actorId, ...result } = await replayOfflineSale(db, auth.device, sale);
    results.push(result);
    if (result.status === "duplicate") continue;
    await recordAudit({
      userId: actorId,
      action: result.saleNumber ? "sale.created_offline" : "sale.offline_held",
      entityType: saleId ? "sales" : "devices",
      entityId: saleId ?? auth.device.id,
      after: {
        offlineNumber: sale.offlineNumber,
        saleNumber: result.saleNumber ?? null,
        total: sale.total,
        flags: result.flags,
      },
    });
  }

  return json(request, { results });
}

export const OPTIONS = preflight;
