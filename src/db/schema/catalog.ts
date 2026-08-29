import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { drugClass, dosageForm, itemStatus } from "./enums";
import { money, qty, ts } from "./columns";
import { users } from "./users";

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Category names are data the owner types, not UI copy, so they are stored
    // exactly as entered and never translated.
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("categories_name_lower_idx").on(sql`lower(${t.name})`)],
);

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    contactPerson: text("contact_person"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    notes: text("notes"),

    /**
     * Marks the synthetic "Saldo Awal" supplier used by the go-live opening
     * count. System rows cannot be renamed or archived, so opening batches stay
     * identifiable forever.
     */
    isSystem: boolean("is_system").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("suppliers_name_lower_idx").on(sql`lower(${t.name})`)],
);

/**
 * The catalogue. Deliberately holds no quantity of any kind: stock lives on
 * batches, and on-hand is derived. An editable quantity column here is the
 * single failure that makes an inventory system stop being trustworthy.
 */
export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),

    genericName: text("generic_name").notNull(),
    brandName: text("brand_name"),
    form: dosageForm("form").notNull(),
    /** Free text: "500 mg", "125 mg/5 mL". Dosage notation is too varied to constrain. */
    strength: text("strength"),
    /** What one countable unit is. Drives every quantity in the system. */
    unit: text("unit").notNull(),
    /** Units per pack as delivered; converts packs to units at receiving. */
    packSize: integer("pack_size"),

    categoryId: uuid("category_id").references(() => categories.id),
    drugClass: drugClass("drug_class").notNull(),

    /** BPOM registration number (Nomor Izin Edar). Needed to act on a recall. */
    nie: text("nie"),

    /** Medicine PPN treatment is not uniform; exemption is per item. */
    isTaxExempt: boolean("is_tax_exempt").notNull().default(false),

    reorderPoint: qty("reorder_point").notNull().default(0),
    reorderQty: qty("reorder_qty"),
    defaultPrice: money("default_price").notNull().default(0),

    /** How many days of shelf life a delivery must have to be accepted. */
    minShelfLifeDays: integer("min_shelf_life_days"),

    status: itemStatus("status").notNull().default("active"),
    notes: text("notes"),

    createdBy: uuid("created_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("items_code_lower_idx").on(sql`lower(${t.code})`),
    index("items_generic_name_idx").on(t.genericName),
    index("items_brand_name_idx").on(t.brandName),
    index("items_status_idx").on(t.status),
    index("items_drug_class_idx").on(t.drugClass),
    index("items_category_idx").on(t.categoryId),
  ],
);

/**
 * A child table rather than a column: one item routinely carries several codes
 * (different pack sizes, repackaged stock, a local and an imported box).
 *
 * `barcode` here is the GTIN or raw EAN-13 only. Lot and expiry arrive in the
 * GS1 payload at scan time and belong to the batch, never to the item.
 */
export const itemBarcodes = pgTable(
  "item_barcodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    barcode: text("barcode").notNull(),
    /** Units this code represents, when it identifies a pack rather than a unit. */
    packSize: integer("pack_size"),
    note: text("note"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("item_barcodes_barcode_idx").on(t.barcode),
    index("item_barcodes_item_idx").on(t.itemId),
  ],
);

export const categoriesRelations = relations(categories, ({ many }) => ({
  items: many(items),
}));

export const itemsRelations = relations(items, ({ one, many }) => ({
  category: one(categories, {
    fields: [items.categoryId],
    references: [categories.id],
  }),
  barcodes: many(itemBarcodes),
}));

export const itemBarcodesRelations = relations(itemBarcodes, ({ one }) => ({
  item: one(items, { fields: [itemBarcodes.itemId], references: [items.id] }),
}));
