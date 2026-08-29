"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import {
  checkPasswordPolicy,
  hashPassword,
  verifyPassword,
  type PasswordProblem,
} from "@/lib/auth/password";
import { revokeAllSessions } from "@/lib/auth/session";
import { assertSession } from "@/lib/dal/session";
import { AuthEvents, recordAudit } from "@/lib/audit";

export type ChangePasswordState = {
  problems?: (PasswordProblem | "mismatch" | "wrong_current")[];
};

export async function changePassword(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const session = await assertSession({ allowPendingPasswordChange: true });

  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  const db = await getDb();
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!user) redirect("/login");

  if (!(await verifyPassword(user.passwordHash, current))) {
    return { problems: ["wrong_current"] };
  }

  const problems: ChangePasswordState["problems"] = [];
  if (next !== confirm) problems.push("mismatch");
  problems.push(...checkPasswordPolicy(next, { username: user.username }));
  if (current === next) problems.push("same_as_current");
  if (problems.length > 0) return { problems };

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(next),
      mustChangePassword: false,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  // Anyone else holding this account's session -- including whoever issued the
  // temporary password -- is signed out. The current session is kept so the
  // user is not bounced back to the sign-in screen mid-task.
  await revokeAllSessions(user.id, session.sessionId);

  await recordAudit({
    action: AuthEvents.passwordChanged,
    userId: user.id,
    actorLabel: user.username,
    entityType: "users",
    entityId: user.id,
  });

  redirect("/");
}
