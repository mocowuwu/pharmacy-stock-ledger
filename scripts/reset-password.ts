/**
 * Issues a new temporary password for an account, and clears any lockout.
 *
 * This is the recovery path for the one account nobody else can rescue: the
 * owner. Every other account can be reset by the owner from the Users screen,
 * but if the owner is locked out there is no one above them -- so it has to be
 * possible from the machine the database runs on. The control panel's
 * "Kata sandi" section does the same thing with a button; see accounts.ts.
 *
 * It does exactly what the Users screen will do: issue a temporary password,
 * force a change at next sign-in, revoke every existing session, and record it
 * in the audit log. It cannot read the existing password, because nothing can.
 *
 *   npx tsx scripts/reset-password.ts <username>
 */
import "./env";
import { getDbHandle } from "../src/db/client";
import { resetPasswordByUsername } from "./account-reset";

async function main() {
  const username = process.argv[2];
  if (!username) {
    console.error("usage: reset-password.ts <username>");
    process.exit(1);
  }

  const { db, close } = await getDbHandle();
  const result = await resetPasswordByUsername(db, username, "reset-password script");
  await close();

  if (!result) {
    console.error(`No account named "${username}".`);
    process.exit(1);
  }

  console.log("\n" + "=".repeat(58));
  console.log(`  Password reset for ${result.username}${result.isOwner ? " (owner)" : ""}`);
  console.log("=".repeat(58));
  console.log(`  Temporary password : ${result.temporaryPassword}`);
  console.log(`  Sessions revoked   : ${result.sessionsRevoked}`);
  console.log("=".repeat(58));
  console.log("  Shown once. You will be asked to replace it at sign-in.");
  console.log("=".repeat(58) + "\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
