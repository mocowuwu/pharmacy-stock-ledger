import "server-only";

import { and, asc, count, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  categories,
  itemBarcodes,
  items,
  suppliers,
  type drugClass as drugClassEnum,
} from "@/db/schema";
import { assertPermission } from "./session";
import { recordAudit } from "@/lib/audit";
import { codePrefix, nextCode, normaliseCode } from "@/lib/catalogue/code";
import type { ItemInput, SupplierInput } from "@/lib/catalogue/validation";

export type DrugClass = (typeof drugClassEnum.enumValues)[number];

export type ItemFilters = {
  search?: string;
  categoryId?: string;
  drugClass?: DrugClass;
  status?: "active" | "archived" | "all";
};

/* ------------------------------------------------------------------- items */

export async function listItems(filters: ItemFilters = {}) {
  await assertPermission("items.view");
  const db = await getDb();

  const search = filters.search?.trim();
  const conditions = [
    filters.status === "all" ? undefined : eq(items.status, filters.status ?? "active"),
    filters.categoryId ? eq(items.categoryId, filters.categoryId) : undefined,
    filters.drugClass ? eq(items.drugClass, filters.drugClass) : undefined,
    search
      ? or(
          ilike(items.genericName, `%${search}%`),
          ilike(items.brandName, `%${search}%`),
          ilike(items.code, `%${search}%`),
          ilike(items.nie, `%${search}%`),
        )
      : undefined,
  ];

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
      reorderPoint: items.reorderPoint,
      status: items.status,
      categoryName: categories.name,
    })
    .from(items)
    .leftJoin(categories, eq(categories.id, items.categoryId))
    .where(and(...conditions))
    .orderBy(asc(items.genericName), asc(items.strength))
    .limit(500);
}

export async function getItem(id: string) {
  await assertPermission("items.view");
  const db = await getDb();

  const [item] = await db
    .select()
    .from(items)
    .where(eq(items.id, id))
    .limit(1);
  if (!item) return null;

  const barcodes = await db
    .select()
    .from(itemBarcodes)
    .where(eq(itemBarcodes.itemId, id))
    .orderBy(asc(itemBarcodes.createdAt));

  return { ...item, barcodes };
}

/**
 * Allocates a code for a new item when the operator left the field blank.
 * Retried by the caller on a unique violation: two people adding items at the
 * same moment is rare on one till, but the failure would be a confusing error
 * rather than a wrong number, so it is worth handling.
 */
async function allocateCode(genericName: string): Promise<string> {
  const db = await getDb();
  const prefix = codePrefix(genericName);
  const existing = await db
    .select({ code: items.code })
    .from(items)
    .where(ilike(items.code, `${prefix}%`));
  return nextCode(prefix, existing.map((r) => r.code));
}

export async function createItem(input: ItemInput) {
  const session = await assertPermission("items.create");
  const db = await getDb();

  const code = input.code
    ? normaliseCode(input.code)
    : await allocateCode(input.genericName);

  const [created] = await db
    .insert(items)
    .values({
      ...input,
      code,
      createdBy: session.user.id,
    })
    .returning();

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "item.created",
    entityType: "items",
    entityId: created.id,
    after: created,
  });

  return created;
}

export async function updateItem(id: string, input: ItemInput) {
  const session = await assertPermission("items.edit");
  const db = await getDb();

  const [before] = await db.select().from(items).where(eq(items.id, id)).limit(1);
  if (!before) throw new Error("Item not found");

  // Changing a sale price is a separate permission from editing the item: it is
  // what a shift manager should not be able to do quietly.
  if (input.defaultPrice !== before.defaultPrice) {
    await assertPermission("items.set_price");
  }

  const [updated] = await db
    .update(items)
    .set({
      ...input,
      code: input.code ? normaliseCode(input.code) : before.code,
      updatedAt: new Date(),
    })
    .where(eq(items.id, id))
    .returning();

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "item.updated",
    entityType: "items",
    entityId: id,
    before,
    after: updated,
  });

  return updated;
}

/**
 * Items are archived, never deleted: batches, sale lines and ledger rows all
 * point at them, and history that cannot name what was sold is not history.
 */
export async function setItemStatus(id: string, status: "active" | "archived") {
  const session = await assertPermission("items.archive");
  const db = await getDb();

  const [updated] = await db
    .update(items)
    .set({ status, updatedAt: new Date() })
    .where(eq(items.id, id))
    .returning();

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: status === "archived" ? "item.archived" : "item.restored",
    entityType: "items",
    entityId: id,
    after: { status },
  });

  return updated;
}

export async function isCodeTaken(code: string, exceptId?: string): Promise<boolean> {
  const db = await getDb();
  const [row] = await db
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        sql`lower(${items.code}) = lower(${normaliseCode(code)})`,
        exceptId ? ne(items.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  return Boolean(row);
}

/* ---------------------------------------------------------------- barcodes */

export async function addBarcode(
  itemId: string,
  input: { barcode: string; packSize: number | null; note: string | null },
) {
  const session = await assertPermission("items.edit");
  const db = await getDb();

  const [created] = await db
    .insert(itemBarcodes)
    .values({ itemId, ...input })
    .returning();

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "item.barcode_added",
    entityType: "items",
    entityId: itemId,
    after: created,
  });

  return created;
}

export async function removeBarcode(barcodeId: string) {
  const session = await assertPermission("items.edit");
  const db = await getDb();

  const [removed] = await db
    .delete(itemBarcodes)
    .where(eq(itemBarcodes.id, barcodeId))
    .returning();

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "item.barcode_removed",
    entityType: "items",
    entityId: removed?.itemId ?? null,
    before: removed,
  });

  return removed;
}

/** Used by the till and by receiving once those screens exist. */
export async function findItemByBarcode(barcode: string) {
  await assertPermission("items.view");
  const db = await getDb();

  const [row] = await db
    .select({ item: items, packSize: itemBarcodes.packSize })
    .from(itemBarcodes)
    .innerJoin(items, eq(items.id, itemBarcodes.itemId))
    .where(eq(itemBarcodes.barcode, barcode.trim()))
    .limit(1);

  return row ?? null;
}

/* -------------------------------------------------------------- categories */

export async function listCategories() {
  await assertPermission("items.view");
  const db = await getDb();
  return db
    .select({
      id: categories.id,
      name: categories.name,
      sortOrder: categories.sortOrder,
      itemCount: count(items.id),
    })
    .from(categories)
    .leftJoin(items, and(eq(items.categoryId, categories.id), eq(items.status, "active")))
    .groupBy(categories.id)
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}

export async function createCategory(name: string) {
  const session = await assertPermission("items.create");
  const db = await getDb();
  const [created] = await db.insert(categories).values({ name }).returning();
  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "category.created",
    entityType: "categories",
    entityId: created.id,
    after: created,
  });
  return created;
}

/* --------------------------------------------------------------- suppliers */

export async function listSuppliers(includeInactive = false) {
  await assertPermission("items.view");
  const db = await getDb();
  return db
    .select()
    .from(suppliers)
    .where(includeInactive ? undefined : eq(suppliers.isActive, true))
    .orderBy(desc(suppliers.isSystem), asc(suppliers.name));
}

export async function createSupplier(input: SupplierInput) {
  const session = await assertPermission("suppliers.manage");
  const db = await getDb();
  const [created] = await db.insert(suppliers).values(input).returning();
  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "supplier.created",
    entityType: "suppliers",
    entityId: created.id,
    after: created,
  });
  return created;
}

export async function updateSupplier(id: string, input: SupplierInput) {
  const session = await assertPermission("suppliers.manage");
  const db = await getDb();

  const [before] = await db.select().from(suppliers).where(eq(suppliers.id, id)).limit(1);
  if (!before) throw new Error("Supplier not found");
  // The opening-balance supplier is referenced by every go-live batch and must
  // stay identifiable, so it cannot be renamed away.
  if (before.isSystem) throw new Error("System supplier cannot be edited");

  const [updated] = await db
    .update(suppliers)
    .set(input)
    .where(eq(suppliers.id, id))
    .returning();

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "supplier.updated",
    entityType: "suppliers",
    entityId: id,
    before,
    after: updated,
  });

  return updated;
}
