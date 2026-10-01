import { relations, sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { money, qty, ts } from "./columns";
import { items } from "./catalog";
import { users } from "./users";

/**
 * Panel Apotek entries.
 *
 * Records manual distribution entries where the pharmacy lends its
 * license/name to PBF/MR for distributing hard drugs to unauthorized parties.
 * These entries do NOT affect stock levels -- they are purely for
 * financial/administrative record-keeping.
 */
export const panelEntries = pgTable(
  "panel_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Human-readable, sequential number for the entry. Never reused. */
    entryNumber: text("entry_number").notNull(),
    /** When the panel transaction occurred. */
    entryDate: ts("entry_date").notNull().defaultNow(),

    /** The pharmacist who recorded this entry. */
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => users.id),
    /** Optional: the responsible pharmacist for controlled substances. */
    pharmacistId: uuid("pharmacist_id").references(() => users.id),

    /** Item code entered manually (e.g., "xxx" for paracetamol). */
    itemCode: text("item_code").notNull(),
    /** Item name/description entered manually. */
    itemName: text("item_name").notNull(),
    /** Unit of measure (tablet, kapsul, botol, etc.). */
    unit: text("unit").notNull(),

    /** Quantity distributed. */
    qty: qty("qty").notNull(),
    /** Purchase price per unit (harga beli). */
    unitCost: money("unit_cost").notNull().default(0),
    /** Selling price per unit (harga jual). */
    unitPrice: money("unit_price").notNull().default(0),

    /** Optional: the PBF/MR/distributor name. */
    partnerName: text("partner_name"),
    /** Optional: destination (dokter, klinik, bidan, etc.). */
    destination: text("destination"),
    /** Optional notes. */
    notes: text("notes"),

    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("panel_entries_qty_positive", sql`${t.qty} > 0`),
    uniqueIndex("panel_entries_number_idx").on(t.entryNumber),
    index("panel_entries_entry_date_idx").on(t.entryDate),
    index("panel_entries_recorded_by_idx").on(t.recordedBy),
    index("panel_entries_item_code_idx").on(t.itemCode),
  ],
);

/**
 * Auto-numbering for panel entries. Separate table to avoid gaps
 * from rolled-back transactions, same pattern as sale numbers.
 */
export const panelSequences = pgTable(
  "panel_sequences",
  {
    year: integer("year").primaryKey(),
    lastNumber: integer("last_number").notNull().default(0),
  },
);

export const panelEntriesRelations = relations(panelEntries, ({ one }) => ({
  recordedByUser: one(users, {
    fields: [panelEntries.recordedBy],
    references: [users.id],
  }),
  pharmacist: one(users, {
    fields: [panelEntries.pharmacistId],
    references: [users.id],
    relationName: "panel_pharmacist",
  }),
}));