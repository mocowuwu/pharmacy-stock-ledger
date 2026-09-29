import { getTranslations } from "next-intl/server";
import { assertPermission, PermissionError } from "@/lib/dal/session";
import { buildHistoryTemplateSheets, type Translate } from "@/lib/history/import-guide";
import { buildXlsx } from "@/lib/format/xlsx";

/**
 * The sales-history template: an empty data sheet and a guide.
 *
 * As with the catalogue template, the column names are fixed English
 * identifiers -- the contract `parseHistoryCsv` matches -- and the guide is
 * written in the language of whoever downloads it.
 */
export async function GET() {
  try {
    await assertPermission("sales.import_history");
  } catch (error) {
    if (error instanceof PermissionError) return new Response("Forbidden", { status: 403 });
    throw error;
  }

  const t = (await getTranslations()) as unknown as Translate;
  const body = buildXlsx(buildHistoryTemplateSheets(t));

  return new Response(Buffer.from(body), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="template-impor-riwayat-penjualan.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
