import "server-only";

import { headers } from "next/headers";
import { getDb, type Database } from "@/db";
import { auditLog } from "@/db/schema";

/**
 * Append-only record of every write that is not already a stock ledger row,
 * plus every authentication event.
 *
 * Never updated, never deleted, never purged: pharmacy records carry
 * multi-year retention requirements, so there is deliberately no function here
 * that removes anything.
 */
export type AuditEntry = {
  userId?: string | null;
  /** Username as typed, for events where no user resolved (a failed sign-in). */
  actorLabel?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
};

/** Best-effort request metadata. Absent outside a request, e.g. in a cron job. */
async function requestMeta(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for");
    return {
      ip: forwarded?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null,
      userAgent: h.get("user-agent"),
    };
  } catch {
    return { ip: null, userAgent: null };
  }
}

export async function recordAudit(entry: AuditEntry, tx?: Database): Promise<void> {
  const db = tx ?? (await getDb());
  const meta = await requestMeta();
  await db.insert(auditLog).values({
    userId: entry.userId ?? null,
    actorLabel: entry.actorLabel ?? null,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
}

/**
 * Authentication events. Failed sign-ins are recorded against the username as
 * typed, because an attempt on an account that does not exist is exactly the
 * thing worth being able to see later.
 */
export const AuthEvents = {
  signInSucceeded: "auth.sign_in.succeeded",
  signInFailed: "auth.sign_in.failed",
  signInBlocked: "auth.sign_in.blocked",
  signedOut: "auth.sign_out",
  passwordChanged: "auth.password.changed",
  passwordReset: "auth.password.reset",
} as const;
