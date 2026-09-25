/**
 * The sample pharmacy a new install opens on, so the owner can learn the till
 * and follow the tutorial on something that looks real before entering their
 * own stock. Kept out of `db:seed`, which runs on every update: the installer
 * calls `db:demo` only when it has just created the owner, i.e. on a brand-new
 * database, and `--first-run` makes this script check that again for itself.
 *
 *   npx tsx scripts/demo-data.ts           the catalogue only
 *   npx tsx scripts/demo-data.ts --stock   plus suppliers, stock, and a morning
 *                                          of activity: sales, a void, a return,
 *                                          a disposal, a posted count, alerts
 *
 * Remove it all from Settings > "Data demo", which also takes the ledger.
 *
 * Note: NIE (BPOM registration) is left blank on purpose. Those numbers
 * identify real registered products, and inventing plausible-looking ones would
 * put fake regulatory identifiers in a system meant to be trusted. They get
 * typed in from the box.
 */
import "./env";
import { eq, sql } from "drizzle-orm";
import { getDbHandle } from "../src/db/client";
import {
  auditLog,
  batches,
  categories,
  historyImports,
  items,
  saleLines,
  sales,
  stockCountLines,
  suppliers,
  users,
} from "../src/db/schema";
import { receiveStock } from "../src/lib/stock/ledger";
import { commitSale, reverseSale, type SaleLineRequest } from "../src/lib/stock/sale";
import { commitReturn } from "../src/lib/stock/return";
import { disposeStock } from "../src/lib/stock/disposal";
import { openCount, postCount, recordCount } from "../src/lib/stock/count";
import { runAlertJob } from "../src/lib/alerts/job";
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
  // Antibiotik
  { generic: "Amoxicillin", brand: "Amoxsan", strength: "500 mg", form: "capsule", unit: "kapsul", drugClass: "keras", category: "Antibiotik", price: 2_500, reorder: 200, packSize: 100 },
  { generic: "Cefixime", strength: "100 mg", form: "capsule", unit: "kapsul", drugClass: "keras", category: "Antibiotik", price: 4_000, reorder: 100, packSize: 50 },
  { generic: "Ciprofloxacin", strength: "500 mg", form: "tablet", unit: "tablet", drugClass: "keras", category: "Antibiotik", price: 2_000, reorder: 100, packSize: 100 },
  { generic: "Azithromycin", strength: "500 mg", form: "tablet", unit: "tablet", drugClass: "keras", category: "Antibiotik", price: 9_000, reorder: 30, packSize: 30 },
  { generic: "Cefadroxil", strength: "500 mg", form: "capsule", unit: "kapsul", drugClass: "keras", category: "Antibiotik", price: 3_500, reorder: 100, packSize: 100 },
  { generic: "Metronidazole", strength: "500 mg", form: "tablet", unit: "tablet", drugClass: "keras", category: "Antibiotik", price: 1_000, reorder: 100, packSize: 100 },
  // Analgesik & Antipiretik
  { generic: "Paracetamol", brand: "Sanmol", strength: "500 mg", form: "tablet", unit: "tablet", drugClass: "bebas", category: "Analgesik & Antipiretik", price: 500, reorder: 500, packSize: 100 },
  { generic: "Paracetamol Sirup", strength: "120 mg/5 mL", form: "syrup", unit: "botol", drugClass: "bebas", category: "Analgesik & Antipiretik", price: 18_000, reorder: 20 },
  { generic: "Ibuprofen", strength: "400 mg", form: "tablet", unit: "tablet", drugClass: "bebas_terbatas", category: "Analgesik & Antipiretik", price: 800, reorder: 300, packSize: 100 },
  { generic: "Asam Mefenamat", strength: "500 mg", form: "tablet", unit: "tablet", drugClass: "keras", category: "Analgesik & Antipiretik", price: 700, reorder: 200, packSize: 100 },
  { generic: "Natrium Diklofenak", strength: "50 mg", form: "tablet", unit: "tablet", drugClass: "keras", category: "Analgesik & Antipiretik", price: 900, reorder: 100, packSize: 100 },
  // Antihipertensi
  { generic: "Amlodipine", strength: "10 mg", form: "tablet", unit: "tablet", drugClass: "keras", category: "Antihipertensi", price: 1_200, reorder: 300, packSize: 30 },
  { generic: "Amlodipine", strength: "5 mg", form: "tablet", unit: "tablet", drugClass: "keras", category: "Antihipertensi", price: 800, reorder: 300, packSize: 30 },
  { generic: "Captopril", strength: "25 mg", form: "tablet", unit: "tablet", drugClass: "keras", category: "Antihipertensi", price: 600, reorder: 200, packSize: 100 },
  { generic: "Candesartan", strength: "8 mg", form: "tablet", unit: "tablet", drugClass: "keras", category: "Antihipertensi", price: 3_000, reorder: 60, packSize: 30 },
  { generic: "Bisoprolol", strength: "5 mg", form: "tablet", unit: "tablet", drugClass: "keras", category: "Antihipertensi", price: 2_500, reorder: 60, packSize: 30 },
  // Antidiabetes
  { generic: "Metformin", strength: "500 mg", form: "tablet", unit: "tablet", drugClass: "keras", category: "Antidiabetes", price: 800, reorder: 400, packSize: 100 },
  { generic: "Glimepiride", strength: "2 mg", form: "tablet", unit: "tablet", drugClass: "keras", category: "Antidiabetes", price: 1_500, reorder: 100, packSize: 30 },
  { generic: "Glibenclamide", strength: "5 mg", form: "tablet", unit: "tablet", drugClass: "keras", category: "Antidiabetes", price: 500, reorder: 100, packSize: 100 },
  // Obat Batuk & Flu
  { generic: "Cetirizine", strength: "10 mg", form: "tablet", unit: "tablet", drugClass: "bebas_terbatas", category: "Obat Batuk & Flu", price: 1_000, reorder: 200, packSize: 50 },
  { generic: "Loratadine", strength: "10 mg", form: "tablet", unit: "tablet", drugClass: "bebas_terbatas", category: "Obat Batuk & Flu", price: 1_200, reorder: 100, packSize: 50 },
  { generic: "Klorfeniramin Maleat", brand: "CTM", strength: "4 mg", form: "tablet", unit: "tablet", drugClass: "bebas_terbatas", category: "Obat Batuk & Flu", price: 200, reorder: 300, packSize: 1000 },
  { generic: "Ambroxol", strength: "30 mg", form: "tablet", unit: "tablet", drugClass: "bebas_terbatas", category: "Obat Batuk & Flu", price: 900, reorder: 200, packSize: 100 },
  { generic: "Dextromethorphan", strength: "15 mg", form: "tablet", unit: "tablet", drugClass: "bebas_terbatas", category: "Obat Batuk & Flu", price: 400, reorder: 200, packSize: 100 },
  { generic: "Obat Batuk Hitam", brand: "OBH", strength: "100 mL", form: "syrup", unit: "botol", drugClass: "bebas_terbatas", category: "Obat Batuk & Flu", price: 15_000, reorder: 20 },
  { generic: "Salbutamol", strength: "100 mcg", form: "spray", unit: "inhaler", drugClass: "keras", category: "Obat Batuk & Flu", price: 85_000, reorder: 10 },
  // Obat Saluran Cerna
  { generic: "Omeprazole", strength: "20 mg", form: "capsule", unit: "kapsul", drugClass: "keras", category: "Obat Saluran Cerna", price: 1_500, reorder: 150, packSize: 30 },
  { generic: "Lansoprazole", strength: "30 mg", form: "capsule", unit: "kapsul", drugClass: "keras", category: "Obat Saluran Cerna", price: 2_500, reorder: 60, packSize: 30 },
  { generic: "Domperidone", strength: "10 mg", form: "tablet", unit: "tablet", drugClass: "keras", category: "Obat Saluran Cerna", price: 1_000, reorder: 100, packSize: 100 },
  { generic: "Antasida Doen", form: "tablet", unit: "tablet", drugClass: "bebas", category: "Obat Saluran Cerna", price: 300, reorder: 300, packSize: 1000 },
  { generic: "Oralit", form: "other", unit: "sachet", drugClass: "bebas", category: "Obat Saluran Cerna", price: 1_000, reorder: 100 },
  // Vitamin & Suplemen
  { generic: "Vitamin C", strength: "500 mg", form: "tablet", unit: "tablet", drugClass: "bebas", category: "Vitamin & Suplemen", price: 700, reorder: 300, packSize: 100 },
  { generic: "Vitamin B Kompleks", form: "tablet", unit: "tablet", drugClass: "bebas", category: "Vitamin & Suplemen", price: 300, reorder: 300, packSize: 1000 },
  { generic: "Tablet Tambah Darah", strength: "60 mg", form: "tablet", unit: "tablet", drugClass: "bebas", category: "Vitamin & Suplemen", price: 400, reorder: 200, packSize: 100 },
  { generic: "Kalsium Laktat", strength: "500 mg", form: "tablet", unit: "tablet", drugClass: "bebas", category: "Vitamin & Suplemen", price: 300, reorder: 200, packSize: 100 },
  { generic: "Zinc", strength: "20 mg", form: "tablet", unit: "tablet", drugClass: "bebas", category: "Vitamin & Suplemen", price: 1_500, reorder: 100, packSize: 100 },
  // Alat Kesehatan
  { generic: "Masker Medis 3 Ply", form: "device", unit: "lembar", drugClass: "alkes", category: "Alat Kesehatan", price: 1_500, reorder: 500, packSize: 50 },
  { generic: "Sarung Tangan Latex", form: "device", unit: "pasang", drugClass: "alkes", category: "Alat Kesehatan", price: 2_000, reorder: 200, packSize: 100 },
  { generic: "Termometer Digital", form: "device", unit: "buah", drugClass: "alkes", category: "Alat Kesehatan", price: 35_000, reorder: 5 },
  { generic: "Kasa Steril", strength: "16 x 16 cm", form: "device", unit: "lembar", drugClass: "alkes", category: "Alat Kesehatan", price: 1_000, reorder: 200, packSize: 16 },
  // Bahan Habis Pakai
  { generic: "Spuit 3 mL", form: "device", unit: "buah", drugClass: "consumable", category: "Bahan Habis Pakai", price: 2_500, reorder: 200 },
  { generic: "Alkohol Swab", form: "other", unit: "lembar", drugClass: "consumable", category: "Bahan Habis Pakai", price: 300, reorder: 500, packSize: 100 },
  { generic: "Plester Luka", form: "device", unit: "lembar", drugClass: "consumable", category: "Bahan Habis Pakai", price: 500, reorder: 300, packSize: 100 },
];

/**
 * Invented distributors. Deliberately not the names of real companies: a
 * sample supplier that shares a real distributor's name would end up on
 * printed purchase records the day someone forgets to clear the demo.
 */
const DEMO_SUPPLIERS = [
  { name: "PT Sehat Sentosa Farma", contactPerson: "Bu Rina", phone: "0361-555-0101" },
  { name: "CV Mitra Medika Bali", contactPerson: "Pak Made", phone: "0361-555-0142" },
  { name: "PT Nusantara Alkes", contactPerson: "Bu Sari", phone: "021-555-0188" },
];

/**
 * Batches with a deliberate spread of shelf life and quantity, so every alert
 * rule and every screen has something real on it:
 *
 * - two lots of Paracetamol, so FEFO visibly sells the older one first;
 * - lots expiring within days and weeks (urgent and notice alerts);
 * - a lot expiring tomorrow, which the till starts refusing the day after;
 * - items below their reorder point (low stock);
 * - items with no stock at all (Salbutamol, Cefadroxil: out of stock).
 *
 * `supplier` is an index into DEMO_SUPPLIERS; `null` books it as opening stock
 * against the system "Saldo Awal" supplier, the way the go-live count would.
 */
const DEMO_STOCK: Array<{
  item: string;
  strength?: string;
  lot: string;
  daysToExpiry: number;
  qty: number;
  cost: number;
  supplier: number | null;
}> = [
  { item: "Amoxicillin", lot: "AMX-2491", daysToExpiry: 420, qty: 600, cost: 1_500, supplier: 0 },
  { item: "Cefixime", lot: "CFX-1130", daysToExpiry: 300, qty: 150, cost: 2_600, supplier: 0 },
  { item: "Ciprofloxacin", lot: "CIP-7702", daysToExpiry: 12, qty: 80, cost: 1_200, supplier: 0 },
  { item: "Azithromycin", lot: "AZT-3321", daysToExpiry: 500, qty: 18, cost: 6_000, supplier: 1 },
  { item: "Metronidazole", lot: "MTZ-4410", daysToExpiry: 260, qty: 300, cost: 550, supplier: null },
  { item: "Paracetamol", lot: "PCM-2417", daysToExpiry: 540, qty: 1200, cost: 320, supplier: 0 },
  { item: "Paracetamol", lot: "PCM-2502", daysToExpiry: 25, qty: 180, cost: 340, supplier: null },
  { item: "Paracetamol Sirup", lot: "PCS-0915", daysToExpiry: 380, qty: 36, cost: 11_000, supplier: 1 },
  { item: "Ibuprofen", lot: "IBU-4402", daysToExpiry: 18, qty: 60, cost: 500, supplier: 0 },
  { item: "Asam Mefenamat", lot: "MEF-6120", daysToExpiry: 1, qty: 40, cost: 400, supplier: null },
  { item: "Asam Mefenamat", lot: "MEF-6388", daysToExpiry: 330, qty: 400, cost: 420, supplier: 1 },
  { item: "Natrium Diklofenak", lot: "DKL-2208", daysToExpiry: 610, qty: 200, cost: 550, supplier: 1 },
  { item: "Amlodipine", strength: "10 mg", lot: "AML-8841", daysToExpiry: 400, qty: 260, cost: 800, supplier: 0 },
  { item: "Amlodipine", strength: "5 mg", lot: "AML-5520", daysToExpiry: 480, qty: 450, cost: 500, supplier: 0 },
  { item: "Captopril", lot: "CAP-9012", daysToExpiry: 150, qty: 95, cost: 380, supplier: null },
  { item: "Candesartan", lot: "CDS-1071", daysToExpiry: 700, qty: 90, cost: 1_900, supplier: 1 },
  { item: "Bisoprolol", lot: "BSP-3045", daysToExpiry: 45, qty: 30, cost: 1_600, supplier: 1 },
  { item: "Metformin", lot: "MET-1180", daysToExpiry: 210, qty: 150, cost: 520, supplier: 0 },
  { item: "Glimepiride", lot: "GLM-7713", daysToExpiry: 365, qty: 120, cost: 950, supplier: 0 },
  { item: "Glibenclamide", lot: "GLB-2290", daysToExpiry: 290, qty: 300, cost: 250, supplier: null },
  { item: "Cetirizine", lot: "CTZ-3390", daysToExpiry: 75, qty: 90, cost: 640, supplier: 0 },
  { item: "Loratadine", lot: "LRT-4471", daysToExpiry: 520, qty: 150, cost: 700, supplier: 1 },
  { item: "Klorfeniramin Maleat", lot: "CTM-1002", daysToExpiry: 800, qty: 1000, cost: 90, supplier: 1 },
  { item: "Ambroxol", lot: "AMB-5610", daysToExpiry: 330, qty: 400, cost: 550, supplier: 0 },
  { item: "Dextromethorphan", lot: "DMP-2233", daysToExpiry: 60, qty: 250, cost: 220, supplier: 0 },
  { item: "Obat Batuk Hitam", lot: "OBH-7780", daysToExpiry: 240, qty: 24, cost: 9_500, supplier: 1 },
  { item: "Omeprazole", lot: "OMP-5521", daysToExpiry: 320, qty: 40, cost: 950, supplier: 0 },
  { item: "Lansoprazole", lot: "LNS-8830", daysToExpiry: 450, qty: 90, cost: 1_600, supplier: 0 },
  { item: "Domperidone", lot: "DOM-1177", daysToExpiry: 390, qty: 200, cost: 600, supplier: 1 },
  { item: "Antasida Doen", lot: "ANT-9001", daysToExpiry: 700, qty: 800, cost: 150, supplier: null },
  { item: "Oralit", lot: "ORL-3310", daysToExpiry: 500, qty: 150, cost: 600, supplier: 1 },
  { item: "Vitamin C", lot: "VTC-7001", daysToExpiry: 600, qty: 800, cost: 420, supplier: 1 },
  { item: "Vitamin B Kompleks", lot: "VBK-4020", daysToExpiry: 480, qty: 1000, cost: 150, supplier: 1 },
  { item: "Tablet Tambah Darah", lot: "TTD-6640", daysToExpiry: 90, qty: 150, cost: 200, supplier: null },
  { item: "Kalsium Laktat", lot: "KAL-1515", daysToExpiry: 560, qty: 400, cost: 150, supplier: 1 },
  { item: "Zinc", lot: "ZNC-2020", daysToExpiry: 400, qty: 60, cost: 900, supplier: 1 },
  { item: "Masker Medis 3 Ply", lot: "MSK-2211", daysToExpiry: 900, qty: 1500, cost: 900, supplier: 2 },
  { item: "Sarung Tangan Latex", lot: "GLV-5108", daysToExpiry: 1000, qty: 400, cost: 1_200, supplier: 2 },
  { item: "Termometer Digital", lot: "TRM-0042", daysToExpiry: 1500, qty: 12, cost: 22_000, supplier: 2 },
  { item: "Kasa Steril", lot: "KSA-7760", daysToExpiry: 720, qty: 320, cost: 550, supplier: 2 },
  { item: "Spuit 3 mL", lot: "SPT-3301", daysToExpiry: 1100, qty: 300, cost: 1_400, supplier: 2 },
  { item: "Alkohol Swab", lot: "ALK-9912", daysToExpiry: 650, qty: 1000, cost: 150, supplier: 2 },
  { item: "Plester Luka", lot: "PLS-4410", daysToExpiry: 850, qty: 500, cost: 250, supplier: 2 },
];

/**
 * A morning at the till. Rung up through `commitSale`, so FEFO, tax and the
 * ledger treat them exactly as they would a real sale -- and so, like a real
 * sale, they are dated today. The ledger does not take a back-dated entry, and
 * the demo does not get to be the exception.
 */
const DEMO_SALES: Array<{
  lines: Array<[item: string, qty: number, strength?: string]>;
  method: "tunai" | "qris" | "kartu_debit" | "transfer";
  tendered?: number;
}> = [
  { lines: [["Paracetamol", 10], ["Vitamin C", 10]], method: "tunai", tendered: 20_000 },
  { lines: [["Amoxicillin", 15], ["Paracetamol", 10]], method: "tunai", tendered: 50_000 },
  { lines: [["Amlodipine", 30, "10 mg"]], method: "qris" },
  { lines: [["Obat Batuk Hitam", 1], ["Klorfeniramin Maleat", 10]], method: "tunai", tendered: 20_000 },
  { lines: [["Metformin", 60], ["Glimepiride", 30]], method: "kartu_debit" },
  { lines: [["Masker Medis 3 Ply", 50]], method: "qris" },
  { lines: [["Oralit", 5], ["Zinc", 10], ["Paracetamol Sirup", 1]], method: "tunai", tendered: 50_000 },
  { lines: [["Omeprazole", 14], ["Antasida Doen", 20]], method: "tunai", tendered: 30_000 },
  { lines: [["Cetirizine", 10]], method: "tunai", tendered: 10_000 },
  { lines: [["Captopril", 30], ["Amlodipine", 30, "5 mg"]], method: "transfer" },
  { lines: [["Ciprofloxacin", 10], ["Asam Mefenamat", 10]], method: "qris" },
  { lines: [["Termometer Digital", 1], ["Alkohol Swab", 20]], method: "kartu_debit" },
  { lines: [["Vitamin B Kompleks", 30], ["Tablet Tambah Darah", 30]], method: "tunai", tendered: 25_000 },
  { lines: [["Ambroxol", 10], ["Dextromethorphan", 10]], method: "tunai", tendered: 15_000 },
];

/** Items are matched on name and strength: Amlodipine 5 mg is not Amlodipine 10 mg. */
function itemWhere(generic: string, strength?: string) {
  return strength
    ? sql`lower(${items.genericName}) = lower(${generic}) and ${items.strength} = ${strength}`
    : sql`lower(${items.genericName}) = lower(${generic})`;
}

async function main() {
  const clearing = process.argv.includes("--clear");
  const withStock = process.argv.includes("--stock");
  const firstRun = process.argv.includes("--first-run");
  const { db, close } = await getDbHandle();

  // The installer's call. Samples go only into a database nobody has used:
  // never on top of real stock, and never back after the owner cleared them,
  // which the audit log remembers even though the data is gone.
  if (firstRun) {
    const [state] = await db
      .select({
        items: sql<number>`(select count(*)::int from ${items})`,
        sales: sql<number>`(select count(*)::int from ${sales})`,
        suppliers: sql<number>`(select count(*)::int from ${suppliers} where ${suppliers.isSystem} = false)`,
        cleared: sql<number>`(select count(*)::int from ${auditLog} where ${auditLog.action} = 'settings.demo_data_cleared')`,
        history: sql<number>`(select count(*)::int from ${historyImports})`,
      })
      .from(sql`(select 1) as one`);
    if (state.items + state.sales + state.suppliers + state.cleared + state.history > 0) {
      console.log("Database already in use; no sample data added.");
      await close();
      return;
    }
  }

  if (clearing) {
    // Once there is stock, the ledger refers to these items and a plain delete
    // would be refused. The owner's "Hapus demo" in Settings is the one wipe
    // that takes the ledger with it, and it leaves an audit entry.
    console.log('Clear the demo from Settings > "Data demo" (type HAPUS DEMO).');
    console.log("That removes items, stock, sales and suppliers together, and is audited.");
    await close();
    return;
  }

  const [owner] = await db
    .select({ id: users.id, isPharmacist: users.isPharmacist })
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
    // An existing row with no strength recorded counts as the same medicine:
    // somebody typed it in by hand before running this.
    const [dupe] = await db
      .select({ id: items.id })
      .from(items)
      .where(
        d.strength
          ? sql`lower(${items.genericName}) = lower(${d.generic}) and (${items.strength} = ${d.strength} or ${items.strength} is null)`
          : itemWhere(d.generic),
      )
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

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(items);
  console.log(`Added ${added} sample items. Catalogue now holds ${total}.`);

  if (!withStock) {
    console.log("Add sample stock and a morning of sales with: npx tsx scripts/demo-data.ts --stock");
    await close();
    return;
  }

  // Suppliers ---------------------------------------------------------------
  const supplierIds: string[] = [];
  for (const s of DEMO_SUPPLIERS) {
    const [row] = await db
      .insert(suppliers)
      .values(s)
      .onConflictDoNothing()
      .returning({ id: suppliers.id });
    const id =
      row?.id ??
      (await db.select({ id: suppliers.id }).from(suppliers).where(sql`lower(${suppliers.name}) = lower(${s.name})`))[0].id;
    supplierIds.push(id);
  }
  const [opening] = await db
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(eq(suppliers.isSystem, true))
    .limit(1);

  const itemId = async (generic: string, strength?: string) => {
    const [row] = await db.select({ id: items.id }).from(items).where(itemWhere(generic, strength)).limit(1);
    return row?.id ?? null;
  };

  // Stock -------------------------------------------------------------------
  // The activity below is only added alongside fresh stock: run twice, the
  // script must not ring up the same morning again.
  let batchCount = 0;
  for (const s of DEMO_STOCK) {
    const id = await itemId(s.item, s.strength);
    if (!id) continue;

    const [existing] = await db
      .select({ id: batches.id })
      .from(batches)
      .where(sql`${batches.lotNumber} = ${s.lot}`)
      .limit(1);
    if (existing) continue;

    // Goes through the ledger, so these batches are as accountable as any
    // booked in by hand.
    await receiveStock(db, {
      itemId: id,
      lotNumber: s.lot,
      expiryDate: addDays(today(), s.daysToExpiry),
      supplierId: s.supplier == null ? opening.id : supplierIds[s.supplier],
      receivedDate: today(),
      qty: s.qty,
      unitCost: s.cost,
      performedBy: owner.id,
      type: s.supplier == null ? "opening" : "receive",
    });
    batchCount++;
  }
  console.log(`Added ${batchCount} sample batches.`);

  if (batchCount === 0) {
    console.log("Sample stock was already there; no new sales were rung up.");
    await close();
    return;
  }

  // A morning at the till ---------------------------------------------------
  const saleIds: string[] = [];
  for (const sale of DEMO_SALES) {
    const lines: SaleLineRequest[] = [];
    for (const [generic, qty, strength] of sale.lines) {
      const id = await itemId(generic, strength);
      if (!id) continue;
      const [item] = await db.select({ price: items.defaultPrice }).from(items).where(eq(items.id, id));
      lines.push({ itemId: id, qty, unitPrice: item.price });
    }
    if (lines.length === 0) continue;
    const result = await db.transaction((tx) =>
      commitSale(tx, {
        actorId: owner.id,
        actorIsPharmacist: owner.isPharmacist,
        lines,
        paymentMethod: sale.method,
        tendered: sale.tendered ?? null,
      }),
    );
    saleIds.push(result.saleId);
  }
  console.log(`Rang up ${saleIds.length} sample sales.`);

  // One mistake voided, one customer bringing something back: the sales
  // history, the returns screen and the quarantine all have an example.
  if (saleIds.length >= 9) {
    await db.transaction((tx) =>
      reverseSale(tx, { saleId: saleIds[8], actorId: owner.id, reason: "Salah input jumlah" }),
    );

    const [line] = await db
      .select({ id: saleLines.id })
      .from(saleLines)
      .where(eq(saleLines.saleId, saleIds[0]))
      .limit(1);
    if (line) {
      await db.transaction((tx) =>
        commitReturn(tx, {
          saleId: saleIds[0],
          actorId: owner.id,
          actorIsPharmacist: owner.isPharmacist,
          lines: [{ saleLineId: line.id, qty: 5 }],
          refundMethod: "tunai",
          reason: "Pembeli membeli terlalu banyak",
        }),
      );
    }
    console.log("Voided one sample sale and booked one return.");
  }

  // A damaged box taken off the shelf: a loss, not a correction.
  const [damaged] = await db
    .select({ id: batches.id })
    .from(batches)
    .where(sql`${batches.lotNumber} = 'OBH-7780'`)
    .limit(1);
  if (damaged) {
    await db.transaction((tx) =>
      disposeStock(tx, {
        batchId: damaged.id,
        qty: 2,
        reason: "Botol retak, isi bocor",
        method: "Dibuang sesuai prosedur",
        actorId: owner.id,
        pharmacistId: owner.isPharmacist ? owner.id : null,
      }),
    );
    console.log("Disposed of two damaged bottles.");
  }

  // A shelf count of the vitamins that found one strip missing, posted so the
  // counts screen shows how a difference is booked.
  const vitamins = catId("Vitamin & Suplemen");
  if (vitamins) {
    const { countId } = await db.transaction((tx) =>
      openCount(tx, { name: "Rak vitamin", categoryId: vitamins, actorId: owner.id }),
    );
    const lines = await db
      .select({ id: stockCountLines.id, expected: stockCountLines.expectedQty, lot: batches.lotNumber })
      .from(stockCountLines)
      .innerJoin(batches, eq(batches.id, stockCountLines.batchId))
      .where(eq(stockCountLines.countId, countId));
    for (const line of lines) {
      const short = line.lot === "VTC-7001" ? 10 : 0;
      await db.transaction((tx) =>
        recordCount(tx, {
          lineId: line.id,
          countedQty: line.expected - short,
          reason: short ? "Satu strip tidak ditemukan di rak" : null,
          actorId: owner.id,
        }),
      );
    }
    await db.transaction((tx) => postCount(tx, { countId, actorId: owner.id }));
    console.log("Posted a stock count of the vitamin shelf.");
  }

  const alerts = await runAlertJob(db);
  console.log(`Alerts refreshed: ${JSON.stringify(alerts)}`);
  console.log('Remove all of it from Settings > "Data demo" when the pharmacy goes live.');
  await close();
}

main().catch((e) => { console.error(e); process.exit(1); });
