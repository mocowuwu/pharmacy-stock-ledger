import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { paymentMethod, saleStatus, taxMode } from "./enums";
import { money, qty, ts } from "./columns";
import { items } from "./catalog";
import { batches } from "./stock";
import { users } from "./users";

/**
 * A completed transaction at the till.
 *
 * Deliberately holds no patient or prescriber information. Nothing in this
 * build stores personal data, which keeps the system outside the scope of
 * UU PDP No. 27/2022 entirely. When prescriptions are added, patients get their
 * own tables in their own schema and this table gains a single nullable
 * `prescription_id` -- a trivial migration, and one that keeps the stricter
 * access controls health data requires scoped to tables that do not exist yet.
 */
export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Human-readable, sequential, printed on the receipt. Never reused. */
    saleNumber: text("sale_number").notNull(),
    soldAt: ts("sold_at").notNull().defaultNow(),

    cashierId: uuid("cashier_id")
      .notNull()
      .references(() => users.id),
    /** Recorded when the basket contains a class requiring pharmacist oversight. */
    pharmacistId: uuid("pharmacist_id").references(() => users.id),

    subtotal: money("subtotal").notNull(),
    discount: money("discount").notNull().default(0),
    taxAmount: money("tax_amount").notNull().default(0),
    total: money("total").notNull(),

    /**
     * Which tax rule applied, snapshotted. A reprinted receipt from last year
     * must show the rate that applied on the day; reading the current setting
     * instead would make old receipts lie.
     */
    taxRateId: uuid("tax_rate_id"),
    taxMode: taxMode("tax_mode"),
    taxRateBps: integer("tax_rate_bps"),

    paymentMethod: paymentMethod("payment_method").notNull(),
    /** Cash only. */
    tendered: money("tendered"),
    changeGiven: money("change_given"),

    status: saleStatus("status").notNull().default("completed"),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidReason: text("void_reason"),
    voidedAt: ts("voided_at"),

    notes: text("notes"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sales_number_idx").on(t.saleNumber),
    index("sales_sold_at_idx").on(t.soldAt),
    index("sales_cashier_idx").on(t.cashierId),
    index("sales_status_idx").on(t.status),
    // A void must always say who and why.
    check(
      "sales_void_is_explained",
      sql`(${t.status} <> 'voided') or (${t.voidedBy} is not null and ${t.voidReason} is not null and ${t.voidedAt} is not null)`,
    ),
  ],
);

/**
 * One row per batch, not per item. A 30-unit sale drawn from two batches
 * becomes two lines; the screen groups them back together for the customer.
 * Anything less loses which lot actually left the building, which is the whole
 * point of batch tracking.
 */
export const saleLines = pgTable(
  "sale_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id),

    qty: qty("qty").notNull(),
    unitPrice: money("unit_price").notNull(),
    lineTotal: money("line_total").notNull(),

    /**
     * Copied from the batch at the moment of sale. Without it, last month's
     * margin silently changes when this month's delivery costs more.
     */
    unitCostSnapshot: money("unit_cost_snapshot").notNull(),

    /** Snapshotted so the receipt can be reproduced exactly. */
    taxExempt: boolean("tax_exempt").notNull().default(false),

    /** Set when the cashier did not take the earliest-expiring batch. */
    fefoOverrideReason: text("fefo_override_reason"),
  },
  (t) => [
    check("sale_lines_qty_positive", sql`${t.qty} > 0`),
    index("sale_lines_sale_idx").on(t.saleId),
    index("sale_lines_item_idx").on(t.itemId),
    index("sale_lines_batch_idx").on(t.batchId),
  ],
);

/**
 * A return always references the original sale, so the system knows what was
 * actually paid rather than trusting a price typed at the counter.
 */
export const returns = pgTable(
  "returns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    returnNumber: text("return_number").notNull(),
    saleId: uuid("sale_id")
      .notNull()
      .references(() => sales.id),
    returnedAt: ts("returned_at").notNull().defaultNow(),
    processedBy: uuid("processed_by")
      .notNull()
      .references(() => users.id),
    pharmacistId: uuid("pharmacist_id").references(() => users.id),
    refundTotal: money("refund_total").notNull(),
    /** How the money went back. Not necessarily how it came in. */
    refundMethod: paymentMethod("refund_method").notNull(),
    reason: text("reason").notNull(),
    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("returns_number_idx").on(t.returnNumber),
    index("returns_sale_idx").on(t.saleId),
    index("returns_returned_at_idx").on(t.returnedAt),
  ],
);

export const returnLines = pgTable(
  "return_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    returnId: uuid("return_id")
      .notNull()
      .references(() => returns.id, { onDelete: "cascade" }),
    saleLineId: uuid("sale_line_id")
      .notNull()
      .references(() => saleLines.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),

    qty: qty("qty").notNull(),
    refundAmount: money("refund_amount").notNull(),

    /**
     * Where the stock went. Default is a quarantined child batch of the lot it
     * came back from: once a box has left the counter its storage conditions
     * are unknown. Restocking to the original batch is possible for sealed
     * OTC and devices when settings permit, but never for keras, psikotropika
     * or narkotika -- that exclusion is enforced in code, not by the toggle.
     */
    targetBatchId: uuid("target_batch_id")
      .notNull()
      .references(() => batches.id),
    restocked: boolean("restocked").notNull().default(false),
  },
  (t) => [
    check("return_lines_qty_positive", sql`${t.qty} > 0`),
    index("return_lines_return_idx").on(t.returnId),
    index("return_lines_sale_line_idx").on(t.saleLineId),
  ],
);

export const salesRelations = relations(sales, ({ one, many }) => ({
  cashier: one(users, { fields: [sales.cashierId], references: [users.id] }),
  lines: many(saleLines),
  returns: many(returns),
}));

export const saleLinesRelations = relations(saleLines, ({ one }) => ({
  sale: one(sales, { fields: [saleLines.saleId], references: [sales.id] }),
  item: one(items, { fields: [saleLines.itemId], references: [items.id] }),
  batch: one(batches, { fields: [saleLines.batchId], references: [batches.id] }),
}));

export const returnsRelations = relations(returns, ({ one, many }) => ({
  sale: one(sales, { fields: [returns.saleId], references: [sales.id] }),
  lines: many(returnLines),
}));

export const returnLinesRelations = relations(returnLines, ({ one }) => ({
  parent: one(returns, { fields: [returnLines.returnId], references: [returns.id] }),
  saleLine: one(saleLines, {
    fields: [returnLines.saleLineId],
    references: [saleLines.id],
  }),
}));
