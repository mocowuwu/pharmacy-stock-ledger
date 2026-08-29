/**
 * Optional sample catalogue, for looking at the system with something in it.
 * Deliberately NOT part of `db:seed` -- a real pharmacy's database should not
 * start with invented items in it.
 *
 * Remove it all again with: npx tsx scripts/demo-data.ts --clear
 *
 * Note: NIE (BPOM registration) is left blank on purpose. Those numbers
 * identify real registered products, and inventing plausible-looking ones would
 * put fake regulatory identifiers in a system meant to be trusted. They get
 * typed in from the box.
 */
import "./env";
import { eq, inArray, sql } from "drizzle-orm";
import { getDbHandle } from "../src/db/client";
import { batches, categories, items, suppliers, users } from "../src/db/schema";
import { receiveStock } from "../src/lib/stock/ledger";
import { addDays, today } from "../src/lib/format/date";
import { codePrefix, nextCode } from "../src/lib/catalogue/code";
import type { DrugClass, DosageForm } from "../src/lib/catalogue/enums";

type Demo = {
  generic: string;
  brand?: string;
  strength?: string;
  form: DosageForm;
  unit: string;
  drugClass: DrugClass;
  category: string;
  price: number;
  reorder: number;
  packSize?: number;
};

const DEMO: Demo[] = [
  { generic: "Amoxicillin", brand: "Amoxsan", strength: "500 mg", form: "capsule", unit: "kapsul", drugClass: "keras", category: "Antibiotik", price: 2_500, reorder: 200, packSize: 100 },
  { generic: "Cefixime", strength: "100 mg", form: "capsule", unit: "kapsul", drugClass: "keras", category: "Antibiotik", price: 4_000, reorder: 100, packSize: 50 },
  { generic: "Paracetamol", brand: "Sanmol", strength: "500 mg", form: "tablet", unit: "tablet", drugClass: "bebas", category: "Analgesik & Antipiretik", price: 500, reorder: 500, packSize: 100 },
  { generic: "Ibuprofen", strength: "400 mg", form: "tablet", unit: "tablet", drugClass: "bebas_terbatas", category: "Analgesik & Antipiretik", price: 800, reorder: 300, packSize: 100 },
  { generic: "Amlodipine", strength: "10 mg", form: "tablet", unit: "tablet", drugClass: "keras", category: "Antihipertensi", price: 1_200, reorder: 300, packSize: 30 },
  { generic: "Captopril", strength: "25 mg", form: "tablet", unit: "tablet", drugClass: "keras", category: "Antihipertensi", price: 600, reorder: 200, packSize: 100 },
  { generic: "Metformin", strength: "500 mg", form: "tablet", unit: "tablet", drugClass: "keras", category: "Antidiabetes", price: 800, reorder: 400, packSize: 100 },
  { generic: "Glimepiride", strength: "2 mg", form: "tablet", unit: "tablet", drugClass: "keras", category: "Antidiabetes", price: 1_500, reorder: 100, packSize: 30 },
  { generic: "Omeprazole", strength: "20 mg", form: "capsule", unit: "kapsul", drugClass: "keras", category: "Obat Saluran Cerna", price: 1_500, reorder: 150, packSize: 30 },
  { generic: "Oralit", form: "other", unit: "sachet", drugClass: "bebas", category: "Obat Saluran Cerna", price: 1_000, reorder: 100 },
  { generic: "Cetirizine", strength: "10 mg", form: "tablet", unit: "tablet", drugClass: "bebas_terbatas", category: "Obat Batuk & Flu", price: 1_000, reorder: 200, packSize: 50 },
  { generic: "Ambroxol", strength: "30 mg", form: "tablet", unit: "tablet", drugClass: "bebas_terbatas", category: "Obat Batuk & Flu", price: 900, reorder: 200, packSize: 100 },
  { generic: "Salbutamol", strength: "100 mcg", form: "spray", unit: "inhaler", drugClass: "keras", category: "Obat Batuk & Flu", price: 85_000, reorder: 10 },
  { generic: "Vitamin C", strength: "500 mg", form: "tablet", unit: "tablet", drugClass: "bebas", category: "Vitamin & Suplemen", price: 700, reorder: 300, packSize: 100 },
  { generic: "Masker Medis 3 Ply", form: "device", unit: "lembar", drugClass: "alkes", category: "Alat Kesehatan", price: 1_500, reorder: 500, packSize: 50 },
  { generic: "Sarung Tangan Latex", form: "device", unit: "pasang", drugClass: "alkes", category: "Alat Kesehatan", price: 2_000, reorder: 200, packSize: 100 },
  { generic: "Spuit 3 mL", form: "device", unit: "buah", drugClass: "consumable", category: "Bahan Habis Pakai", price: 2_500, reorder: 200 },
];

/**
 * Batches with a deliberate spread of shelf life and quantity, so the alert
 * rules in a later phase have something real to fire on: one lot close to
 * expiry, one already below its reorder point, one item left at zero.
 */
const DEMO_STOCK: Array<{
  generic: string;
  lot: string;
  daysToExpiry: number;
  qty: number;
  cost: number;
}> = [
  { generic: "Paracetamol", lot: "PCM-2417", daysToExpiry: 540, qty: 1200, cost: 320 },
  { generic: "Paracetamol", lot: "PCM-2502", daysToExpiry: 25, qty: 180, cost: 340 },
  { generic: "Amlodipine", lot: "AML-8841", daysToExpiry: 400, qty: 260, cost: 800 },
  { generic: "Metformin", lot: "MET-1180", daysToExpiry: 210, qty: 150, cost: 520 },
  { generic: "Cetirizine", lot: "CTZ-3390", daysToExpiry: 75, qty: 90, cost: 640 },
  { generic: "Omeprazole", lot: "OMP-5521", daysToExpiry: 320, qty: 40, cost: 950 },
  { generic: "Vitamin C", lot: "VTC-7001", daysToExpiry: 600, qty: 800, cost: 420 },
  { generic: "Masker Medis 3 Ply", lot: "MSK-2211", daysToExpiry: 900, qty: 1500, cost: 900 },
  { generic: "Ibuprofen", lot: "IBU-4402", daysToExpiry: 18, qty: 60, cost: 500 },
  { generic: "Captopril", lot: "CAP-9012", daysToExpiry: 150, qty: 95, cost: 380 },
];

async function main() {
  const clearing = process.argv.includes("--clear");
  const withStock = process.argv.includes("--stock");
  const { db, close } = await getDbHandle();

  const names = DEMO.map((d) => d.generic);

  if (clearing) {
    const removed = await db
      .delete(items)
      .where(inArray(items.genericName, names))
      .returning({ id: items.id });
    console.log(`Removed ${removed.length} sample items.`);
    await close();
    return;
  }

  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.isOwner, true))
    .limit(1);
  if (!owner) {
    console.error("No owner account. Run `npm run db:seed` first.");
    process.exit(1);
  }

  const cats = await db.select().from(categories);
  const catId = (name: string) => cats.find((c) => c.name === name)?.id ?? null;

  const existingCodes = (await db.select({ code: items.code }).from(items)).map((r) => r.code);

  let added = 0;
  for (const d of DEMO) {
    const [dupe] = await db
      .select({ id: items.id })
      .from(items)
      .where(sql`lower(${items.genericName}) = lower(${d.generic})`)
      .limit(1);
    if (dupe) continue;

    const code = nextCode(codePrefix(d.generic), existingCodes);
    existingCodes.push(code);

    await db.insert(items).values({
      code,
      genericName: d.generic,
      brandName: d.brand ?? null,
      strength: d.strength ?? null,
      form: d.form,
      unit: d.unit,
      packSize: d.packSize ?? null,
      categoryId: catId(d.category),
      drugClass: d.drugClass,
      defaultPrice: d.price,
      reorderPoint: d.reorder,
      createdBy: owner.id,
    });
    added++;
  }

  let batchCount = 0;
  if (withStock) {
    const [owner2] = await db
      .select({ id: users.id }).from(users).where(eq(users.isOwner, true)).limit(1);
    const [supplier] = await db
      .select({ id: suppliers.id }).from(suppliers).limit(1);

    for (const s of DEMO_STOCK) {
      const [item] = await db
        .select({ id: items.id })
        .from(items)
        .where(sql`lower(${items.genericName}) = lower(${s.generic})`)
        .limit(1);
      if (!item) continue;

      const [existing] = await db
        .select({ id: batches.id })
        .from(batches)
        .where(sql`${batches.lotNumber} = ${s.lot}`)
        .limit(1);
      if (existing) continue;

      // Goes through the ledger, so these batches are as accountable as any
      // booked in by hand.
      await receiveStock(db, {
        itemId: item.id,
        lotNumber: s.lot,
        expiryDate: addDays(today(), s.daysToExpiry),
        supplierId: supplier.id,
        receivedDate: today(),
        qty: s.qty,
        unitCost: s.cost,
        performedBy: owner2.id,
        type: "opening",
      });
      batchCount++;
    }
  }

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(items);
  console.log(`Added ${added} sample items. Catalogue now holds ${total}.`);
  if (withStock) console.log(`Added ${batchCount} sample batches.`);
  else console.log("Add sample stock too with: npx tsx scripts/demo-data.ts --stock");
  console.log("Remove them again with: npx tsx scripts/demo-data.ts --clear");
  await close();
}

main().catch((e) => { console.error(e); process.exit(1); });
