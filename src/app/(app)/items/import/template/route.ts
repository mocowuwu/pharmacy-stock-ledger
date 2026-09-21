import { getTranslations } from "next-intl/server";
import { assertPermission, PermissionError } from "@/lib/dal/session";
import { buildImportTemplateSheets, type Translate } from "@/lib/catalogue/import-guide";
import { buildXlsx } from "@/lib/format/xlsx";

/**
 * The import template: an Excel workbook with the sheet to fill in, and a
 * second sheet that explains every column.
 *
 * Column names on the data sheet are fixed, English, snake_case identifiers --
 * not translated -- because they are a machine-matched contract between this
 * download and the upload on `/items/import`. Translating them would break
 * that match for a user working in the other locale. The guide sheet is
 * translated, into the language of whoever is downloading.
 */
export async function GET() {
  try {
    await assertPermission("items.import");
  } catch (error) {
    if (error instanceof PermissionError) return new Response("Forbidden", { status: 403 });
    throw error;
  }

  const t = (await getTranslations()) as unknown as Translate;
  const body = buildXlsx(buildImportTemplateSheets(t));

  return new Response(Buffer.from(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="template-impor-katalog.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
