import { assertPermission, PermissionError } from "@/lib/dal/session";
import { IMPORT_COLUMNS } from "@/lib/catalogue/import";
import { csvHeaders, toCsv } from "@/lib/format/csv";

/**
 * The import template.
 *
 * Column names are fixed, English, snake_case identifiers -- not translated --
 * because they are a machine-matched contract between this download and the
 * upload on `/items/import`. Translating them would break that match for a
 * user working in the other locale.
 */
export async function GET() {
  try {
    await assertPermission("items.import");
  } catch (error) {
    if (error instanceof PermissionError) return new Response("Forbidden", { status: 403 });
    throw error;
  }

  const example = [
    "AMOX001",
    "Amoxicillin",
    "Generik",
    "capsule",
    "500 mg",
    "kapsul",
    "10",
    "",
    "bebas_terbatas",
    "",
    "0",
    "0",
    "",
    "12000",
    "",
    "",
    "Contoh baris -- hapus sebelum mengunggah",
    "LOT-001",
    "2027-12-31",
    "100",
    "9000",
    "Saldo Awal",
  ];

  const body = toCsv([...IMPORT_COLUMNS], [example]);

  return new Response(body, {
    headers: csvHeaders("template-impor-katalog.csv"),
  });
}
