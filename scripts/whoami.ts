import "./env";
import { desc } from "drizzle-orm";
import { getDbHandle } from "../src/db/client";
import { auditLog, users } from "../src/db/schema";

async function main() {
  const { db, close } = await getDbHandle();
  const rows = await db.select().from(users);
  console.log("accounts:");
  for (const u of rows) {
    console.log(
      `  ${u.username.padEnd(10)} owner=${u.isOwner}  status=${u.status}` +
      `  mustChange=${u.mustChangePassword}  failed=${u.failedLoginCount}` +
      `  lockedUntil=${u.lockedUntil ? u.lockedUntil.toISOString() : "-"}`,
    );
  }
  const recent = await db
    .select({ a: auditLog.action, who: auditLog.actorLabel, at: auditLog.createdAt })
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(10);
  console.log("\nrecent auth events (newest first):");
  for (const r of recent) console.log(`  ${r.at.toISOString()}  ${r.a}  ${r.who ?? ""}`);
  await close();
}
main().catch((e) => { console.error(e); process.exit(1); });
