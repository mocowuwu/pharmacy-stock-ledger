/**
 * The accounts, as the control panel sees them.
 *
 *   npm run accounts -- list
 *   npm run accounts -- reset <username>
 *
 * The panel runs outside the Next application, with no session and no
 * database driver of its own, so this is how it reaches the users table --
 * the same way the backup and the daily jobs reach the database, through a
 * script under the app's own dependencies.
 *
 * **It cannot show anybody's working password, because nothing can.** They
 * are argon2 hashes: there is no readable copy anywhere to show, by design --
 * the owner issues a temporary password and never learns the working one,
 * which is what lets a sale be attributed to the cashier who rang it. What the
 * panel can do is what `reset-password.ts` does from a terminal: issue a new
 * temporary password, shown once.
 *
 * Output is one line of JSON behind a marker, so the lines npm prints around
 * a script never have to be told apart from the answer.
 */
import "./env";
import { asc, sql } from "drizzle-orm";
import { getDbHandle } from "../src/db/client";
import { users } from "../src/db/schema";
import { resetPasswordByUsername } from "./account-reset";

const MARKER = "ACCOUNTS_JSON:";

function answer(value: unknown) {
  console.log(MARKER + JSON.stringify(value));
}

async function main() {
  // Without it the client falls back to an empty in-memory database, and the
  // panel would report a pharmacy with no accounts at all rather than failing.
  if (!process.env.DATABASE_URL) {
    answer({ ok: false, code: "no-database", reason: "DATABASE_URL is not set" });
    process.exit(1);
  }

  const [command, username] = process.argv.slice(2);
  const { db, close } = await getDbHandle();

  try {
    if (command === "list") {
      const rows = await db
        .select({
          username: users.username,
          fullName: users.fullName,
          isOwner: users.isOwner,
          isPharmacist: users.isPharmacist,
          status: users.status,
          mustChangePassword: users.mustChangePassword,
          lastLoginAt: users.lastLoginAt,
          locked: sql<boolean>`coalesce(${users.lockedUntil} > now(), false)`,
        })
        .from(users)
        .orderBy(sql`${users.isOwner} desc`, asc(users.username));
      answer({ ok: true, accounts: rows });
      return;
    }

    if (command === "reset" && username) {
      const result = await resetPasswordByUsername(db, username, "control panel");
      answer(result ? { ok: true, ...result } : { ok: false, code: "no-account" });
      return;
    }

    answer({ ok: false, code: "usage", reason: "usage: accounts.ts list | reset <username>" });
    process.exitCode = 1;
  } finally {
    await close();
  }
}

main().catch((error) => {
  answer({ ok: false, code: "error", reason: String(error?.message ?? error) });
  process.exit(1);
});
