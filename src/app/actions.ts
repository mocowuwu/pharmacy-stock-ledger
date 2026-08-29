"use server";

import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/dal/session";
import { clearSessionCookie, revokeSession } from "@/lib/auth/session";
import { AuthEvents, recordAudit } from "@/lib/audit";

export async function signOut() {
  const session = await getCurrentSession();
  if (session) {
    await revokeSession(session.sessionId);
    await recordAudit({
      action: AuthEvents.signedOut,
      userId: session.user.id,
      actorLabel: session.user.username,
    });
  }
  await clearSessionCookie();
  redirect("/login");
}
