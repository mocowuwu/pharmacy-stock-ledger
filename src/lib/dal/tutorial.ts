import "server-only";

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { assertSession } from "./session";

/**
 * A self-service preference on the signed-in user's own row, not an
 * administrative action -- no `users.manage` permission required, and nothing
 * here is audited: it records that a screen was seen, not a decision that
 * shaped the pharmacy's data.
 *
 * Idempotent, so both "start the tutorial" and "dismiss the prompt" can call
 * it without checking which one fired first.
 */
export async function markTutorialSeen(): Promise<void> {
  const session = await assertSession();
  const db = await getDb();
  await db
    .update(users)
    .set({ tutorialSeenAt: new Date() })
    .where(eq(users.id, session.user.id));
}
