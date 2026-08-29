/**
 * Prepares a fresh database for first use:
 *   - the settings singleton
 *   - the synthetic "Saldo Awal" supplier the go-live opening count books against
 *   - the first owner account, with a temporary password printed once
 *
 * Idempotent: safe to run again, and it will not create a second owner.
 *
 *   npm run db:seed
 */
import "./env";
import { eq } from "drizzle-orm";
import { getDbHandle } from "../src/db/client";
import { settings, suppliers, users, categories } from "../src/db/schema";
import { generateTemporaryPassword, hashPassword } from "../src/lib/auth/password";

const OPENING_SUPPLIER = "Saldo Awal";

const STARTER_CATEGORIES = [
  "Antibiotik",
  "Analgesik & Antipiretik",
  "Antihipertensi",
  "Antidiabetes",
  "Vitamin & Suplemen",
  "Obat Batuk & Flu",
  "Obat Saluran Cerna",
  "Alat Kesehatan",
  "Bahan Habis Pakai",
];

async function main() {
  const { db, close } = await getDbHandle();

  await db.insert(settings).values({ id: 1 }).onConflictDoNothing();
  console.log("settings: ready");

  await db
    .insert(suppliers)
    .values({
      name: OPENING_SUPPLIER,
      isSystem: true,
      notes:
        "Digunakan untuk stok awal saat sistem pertama kali dipakai. Jangan dihapus.",
    })
    .onConflictDoNothing();
  console.log(`suppliers: "${OPENING_SUPPLIER}" ready`);

  for (const [i, name] of STARTER_CATEGORIES.entries()) {
    await db
      .insert(categories)
      .values({ name, sortOrder: i })
      .onConflictDoNothing();
  }
  console.log(`categories: ${STARTER_CATEGORIES.length} ready`);

  const [existingOwner] = await db
    .select({ id: users.id, username: users.username })
    .from(users)
    .where(eq(users.isOwner, true))
    .limit(1);

  if (existingOwner) {
    console.log(`owner: already exists ("${existingOwner.username}") -- unchanged`);
    await close();
    return;
  }

  const username = process.env.SEED_OWNER_USERNAME ?? "pemilik";
  const fullName = process.env.SEED_OWNER_NAME ?? "Pemilik Apotek";
  const temporary = generateTemporaryPassword();

  await db.insert(users).values({
    username,
    fullName,
    passwordHash: await hashPassword(temporary),
    isOwner: true,
    isPharmacist: true,
    mustChangePassword: true,
    status: "active",
  });

  console.log("\n" + "=".repeat(58));
  console.log("  Owner account created");
  console.log("=".repeat(58));
  console.log(`  Username           : ${username}`);
  console.log(`  Temporary password : ${temporary}`);
  console.log("=".repeat(58));
  console.log("  This password is shown once and cannot be recovered.");
  console.log("  You will be asked to replace it at first sign-in.");
  console.log("=".repeat(58) + "\n");

  await close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
