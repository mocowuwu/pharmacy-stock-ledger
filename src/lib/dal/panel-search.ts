import { getDb } from "@/db";
import { items } from "@/db/schema";
import { eq, ilike, or } from "drizzle-orm";
import { assertPermission } from "@/lib/dal/session";

export async function searchItems(query: string, limit = 10) {
  await assertPermission("items.view");
  const db = await getDb();

  if (!query || query.trim().length < 2) {
    return [];
  }

  const searchTerm = `%${query.trim()}%`;

  return db
    .select({
      id: items.id,
      code: items.code,
      genericName: items.genericName,
      brandName: items.brandName,
      form: items.form,
      strength: items.strength,
      unit: items.unit,
      packSize: items.packSize,
      drugClass: items.drugClass,
      defaultPrice: items.defaultPrice,
    })
    .from(items)
    .where(
      or(
        ilike(items.code, searchTerm),
        ilike(items.genericName, searchTerm),
        ilike(items.brandName, searchTerm),
      )
    )
    .orderBy(items.genericName)
    .limit(limit);
}