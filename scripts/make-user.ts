/**
 * Creates a staff account from a permission template, the way the Users screen
 * will in phase 1's admin UI.
 *
 *   npx tsx scripts/make-user.ts <username> "<Full Name>" <cashier|stock_clerk|manager>
 */
import "./env";
import { sql } from "drizzle-orm";
import { getDbHandle } from "../src/db/client";
import { userPermissions, users } from "../src/db/schema";
import { generateTemporaryPassword, hashPassword } from "../src/lib/auth/password";
import { PERMISSION_TEMPLATES, type PermissionTemplate } from "../src/lib/auth/permissions";

async function main() {
  const [username, fullName, template] = process.argv.slice(2) as [
    string, string, PermissionTemplate,
  ];
  if (!username || !fullName || !PERMISSION_TEMPLATES[template]) {
    console.error("usage: make-user.ts <username> \"<Full Name>\" <cashier|stock_clerk|manager>");
    process.exit(1);
  }

  const { db, close } = await getDbHandle();
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.username}) = lower(${username})`)
    .limit(1);
  if (existing) {
    console.error(`A user named "${username}" already exists.`);
    await close();
    process.exit(1);
  }

  const temporary = generateTemporaryPassword();
  const [created] = await db
    .insert(users)
    .values({
      username,
      fullName,
      passwordHash: await hashPassword(temporary),
      mustChangePassword: true,
      status: "active",
    })
    .returning({ id: users.id });

  const perms = PERMISSION_TEMPLATES[template];
  await db.insert(userPermissions).values(
    perms.map((permission) => ({ userId: created.id, permission })),
  );

  console.log(`Created "${username}" (${fullName}) from template "${template}"`);
  console.log(`  permissions        : ${perms.length}`);
  console.log(`  temporary password : ${temporary}`);
  await close();
}

main().catch((e) => { console.error(e); process.exit(1); });
