import { relations, sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { alertSeverity, alertStatus, alertType } from "./enums";
import { ts } from "./columns";
import { items } from "./catalog";
import { batches } from "./stock";
import { users } from "./users";

/**
 * Alerts are persisted rather than computed on every page load. The ledger
 * could answer "what is out of stock?" as a query, but not "how long has it
 * been out of stock?", nor "who acknowledged this and when" -- and those are
 * the parts that make the dashboard worth looking at.
 *
 * Rows are upserted by the alert job: an existing open alert is refreshed, not
 * duplicated, so `firstSeenAt` keeps its meaning.
 */
export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: alertType("type").notNull(),
    severity: alertSeverity("severity").notNull(),

    // Every alert type in the system concerns a specific item, so this is
    // required. Only the batch is optional.
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    /** Null for item-level alerts such as out-of-stock. */
    batchId: uuid("batch_id").references(() => batches.id, { onDelete: "cascade" }),

    status: alertStatus("status").notNull().default("open"),

    /** Type-specific detail: days out of stock, value at risk, quantity affected. */
    context: jsonb("context"),

    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),

    /** Acknowledging means "seen, ordered" -- the alert dims but stays open. */
    acknowledgedBy: uuid("acknowledged_by").references(() => users.id),
    acknowledgedAt: ts("acknowledged_at"),
    acknowledgeNote: text("acknowledge_note"),

    /** Warnings and notices only. Critical alerts cannot be snoozed. */
    snoozedUntil: ts("snoozed_until"),
    snoozedBy: uuid("snoozed_by").references(() => users.id),

    resolvedAt: ts("resolved_at"),
  },
  (t) => [
    // One live alert per type per subject, so a job run refreshes an existing
    // alert instead of accumulating duplicates and resetting `firstSeenAt`.
    //
    // The batch id is coalesced to a sentinel because Postgres treats NULLs as
    // distinct in a unique index: without this, every run would insert another
    // row for item-level alerts like out-of-stock, which have no batch.
    uniqueIndex("alerts_live_subject_idx")
      .on(
        t.type,
        t.itemId,
        sql`coalesce(${t.batchId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${t.status} <> 'resolved'`),
    index("alerts_status_severity_idx").on(t.status, t.severity),
    index("alerts_type_idx").on(t.type),
    index("alerts_item_idx").on(t.itemId),
  ],
);

export const alertsRelations = relations(alerts, ({ one }) => ({
  item: one(items, { fields: [alerts.itemId], references: [items.id] }),
  batch: one(batches, { fields: [alerts.batchId], references: [batches.id] }),
}));
