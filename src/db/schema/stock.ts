import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { batchStatus, countStatus, movementType } from "./enums";
import { money, qty, ts } from "./columns";
import { items, suppliers } from "./catalog";
import { users } from "./users";

/**
 * Where stock actually lives. One row per physical lot received.
 */
export const batches = pgTable(
  "batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),

    /** As printed on the box. Null only for legacy opening stock -- see below. */
    lotNumber: text("lot_number"),

    /**
     * Stored as a calendar date string (YYYY-MM-DD), never a timestamp. Boxes
     * print month/year, so this is set to the last day of the printed month.
     * Keeping it a plain date means no timezone can shift it across a day
     * boundary, and a misread expiry is a safety problem rather than a
     * cosmetic one.
     */
    expiryDate: date("expiry_date", { mode: "string" }).notNull(),

    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    receivedDate: date("received_date", { mode: "string" }).notNull(),

    /** Immutable after creation. Corrections go through an adjustment. */
    qtyReceived: qty("qty_received").notNull(),
    /** Maintained by the ledger, never edited directly. */
    qtyRemaining: qty("qty_remaining").notNull(),

    unitCost: money("unit_cost").notNull().default(0),

    status: batchStatus("status").notNull().default("active"),

    /**
     * Set for opening-count batches whose lot number could not be determined
     * from the paper records. The expiry date is still required -- entering
     * stock without one would destroy the expiry alerting that is the point of
     * the system -- but the missing lot is recorded honestly rather than faked.
     */
    isLegacy: boolean("is_legacy").notNull().default(false),

    /**
     * Set when this batch was derived from another rather than received --
     * currently only returned stock, which becomes a quarantined child of the
     * lot it came back from. Keeping it a separate batch is what stops returned
     * medicine from silently re-entering sellable stock.
     */
    parentBatchId: uuid("parent_batch_id"),

    notes: text("notes"),
    receivedBy: uuid("received_by")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    // Last line of defence beneath the transaction logic. If application code
    // ever gets allocation wrong, the database refuses rather than silently
    // recording negative stock.
    check("batches_qty_remaining_non_negative", sql`${t.qtyRemaining} >= 0`),
    check("batches_qty_received_positive", sql`${t.qtyReceived} > 0`),
    // The same lot from the same supplier is one received batch. Derived
    // batches (quarantined returns) share the lot number by design and are
    // excluded, as is legacy opening stock with no lot number to key on.
    uniqueIndex("batches_item_lot_supplier_idx")
      .on(t.itemId, t.lotNumber, t.supplierId)
      .where(sql`${t.lotNumber} is not null and ${t.parentBatchId} is null`),
    index("batches_item_idx").on(t.itemId),
    index("batches_expiry_idx").on(t.expiryDate),
    index("batches_status_idx").on(t.status),
    // Drives FEFO allocation: earliest expiry with stock, for a given item.
    index("batches_fefo_idx")
      .on(t.itemId, t.expiryDate)
      .where(sql`${t.status} = 'active' and ${t.qtyRemaining} > 0`),
  ],
);

/**
 * The ledger. Append-only: no UPDATE, no DELETE, no exceptions. Every row is
 * one reason a batch quantity changed, and the sum of deltas for a batch must
 * always equal that batch's `qty_remaining`.
 */
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id),
    /** Denormalised from the batch so per-item history stays a single-table scan. */
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),

    type: movementType("type").notNull(),
    /** Signed. Positive in, negative out, never zero. */
    qtyDelta: qty("qty_delta").notNull(),

    /** Points back to the sale, return, disposal or adjustment that caused it. */
    refType: text("ref_type"),
    refId: uuid("ref_id"),

    /** Required for adjust, dispose, and any FEFO override. */
    reason: text("reason"),

    performedBy: uuid("performed_by")
      .notNull()
      .references(() => users.id),

    /**
     * The responsible pharmacist, where that differs from whoever operated the
     * screen. Required for restricted classes; present from the first migration
     * so the narkotika register can be switched on without a backfill.
     */
    pharmacistId: uuid("pharmacist_id").references(() => users.id),

    /** Server time. Never client-supplied. */
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("stock_movements_delta_non_zero", sql`${t.qtyDelta} <> 0`),
    index("stock_movements_batch_idx").on(t.batchId),
    index("stock_movements_item_created_idx").on(t.itemId, t.createdAt),
    index("stock_movements_ref_idx").on(t.refType, t.refId),
    index("stock_movements_created_idx").on(t.createdAt),
    index("stock_movements_type_idx").on(t.type),
  ],
);

/**
 * Write-offs of expired or damaged stock. Separate from adjustments because
 * they mean different things: this is loss, an adjustment is a bookkeeping
 * correction, and conflating them destroys the expiry-loss report.
 */
export const disposals = pgTable(
  "disposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    disposalNumber: text("disposal_number").notNull(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id),
    qty: qty("qty").notNull(),
    /** Cost value written off, snapshotted for the expiry-loss report. */
    costValue: money("cost_value").notNull().default(0),
    reason: text("reason").notNull(),
    method: text("method"),
    disposedBy: uuid("disposed_by")
      .notNull()
      .references(() => users.id),
    /** Destruction of drug stock is commonly witnessed; the field is here either way. */
    witnessedBy: uuid("witnessed_by").references(() => users.id),
    pharmacistId: uuid("pharmacist_id").references(() => users.id),
    disposedAt: ts("disposed_at").notNull().defaultNow(),
    notes: text("notes"),
  },
  (t) => [
    check("disposals_qty_positive", sql`${t.qty} > 0`),
    uniqueIndex("disposals_number_idx").on(t.disposalNumber),
    index("disposals_batch_idx").on(t.batchId),
    index("disposals_disposed_at_idx").on(t.disposedAt),
  ],
);

/** A physical count, used both for the go-live opening count and recurring opname. */
export const stockCounts = pgTable(
  "stock_counts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countNumber: text("count_number").notNull(),
    name: text("name").notNull(),
    /** Optional scope: counting one category at a time is less disruptive than closing. */
    categoryId: uuid("category_id"),
    status: countStatus("status").notNull().default("draft"),
    startedBy: uuid("started_by")
      .notNull()
      .references(() => users.id),
    startedAt: ts("started_at").notNull().defaultNow(),
    postedBy: uuid("posted_by").references(() => users.id),
    postedAt: ts("posted_at"),
    notes: text("notes"),
  },
  (t) => [
    uniqueIndex("stock_counts_number_idx").on(t.countNumber),
    index("stock_counts_status_idx").on(t.status),
  ],
);

export const stockCountLines = pgTable(
  "stock_count_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    countId: uuid("count_id")
      .notNull()
      .references(() => stockCounts.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id),
    /** On-hand at the moment the count sheet was generated. */
    expectedQty: qty("expected_qty").notNull(),
    /** Null until somebody counts it. */
    countedQty: qty("counted_qty"),
    reason: text("reason"),
    countedBy: uuid("counted_by").references(() => users.id),
    countedAt: ts("counted_at"),
  },
  (t) => [
    uniqueIndex("stock_count_lines_count_batch_idx").on(t.countId, t.batchId),
    index("stock_count_lines_count_idx").on(t.countId),
  ],
);

/** Quantity corrections. Every posted count line produces one of these. */
export const stockAdjustments = pgTable(
  "stock_adjustments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batches.id),
    qtyBefore: qty("qty_before").notNull(),
    qtyAfter: qty("qty_after").notNull(),
    reason: text("reason").notNull(),
    /** Set when the adjustment came from a posted stock count. */
    countId: uuid("count_id").references(() => stockCounts.id),
    performedBy: uuid("performed_by")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("stock_adjustments_changes_something", sql`${t.qtyBefore} <> ${t.qtyAfter}`),
    index("stock_adjustments_batch_idx").on(t.batchId),
    index("stock_adjustments_count_idx").on(t.countId),
  ],
);

export const batchesRelations = relations(batches, ({ one, many }) => ({
  item: one(items, { fields: [batches.itemId], references: [items.id] }),
  parent: one(batches, {
    fields: [batches.parentBatchId],
    references: [batches.id],
    relationName: "batch_parent",
  }),
  supplier: one(suppliers, { fields: [batches.supplierId], references: [suppliers.id] }),
  movements: many(stockMovements),
}));

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  batch: one(batches, { fields: [stockMovements.batchId], references: [batches.id] }),
  item: one(items, { fields: [stockMovements.itemId], references: [items.id] }),
}));

export const stockCountsRelations = relations(stockCounts, ({ many }) => ({
  lines: many(stockCountLines),
}));

export const stockCountLinesRelations = relations(stockCountLines, ({ one }) => ({
  count: one(stockCounts, {
    fields: [stockCountLines.countId],
    references: [stockCounts.id],
  }),
  batch: one(batches, { fields: [stockCountLines.batchId], references: [batches.id] }),
}));
