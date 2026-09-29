import { relations, sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { historyImportStatus, paymentMethod } from "./enums";
import { money, qty, ts } from "./columns";
import { items } from "./catalog";
import { users } from "./users";

/**
 * Sales from before this system, imported from a spreadsheet so the reports
 * can reach back past the day the till was switched on.
 *
 * Kept apart from `sales` on purpose. A till sale moved stock out of a batch
 * through the ledger; an imported line did not -- the boxes it describes were
 * sold before any batch here existed, and today's shelf was counted in as
 * opening stock. Writing these as sales would either invent ledger movements
 * for stock that was never on this system or leave sales with no lines behind
 * them. So they are their own record, read by the sales and margin reports
 * only, and never by the stock screens, the movement report or the alerts.
 *
 * One upload is one `history_imports` row. It can be withdrawn as a whole --
 * a file imported twice, the wrong month -- which takes its lines out of every
 * report while leaving them, and who imported and withdrew them, on record.
 */
export const historyImports = pgTable(
  "history_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** `R` + date + sequence, allocated under the number-series lock. */
    importNumber: text("import_number").notNull(),
    fileName: text("file_name"),
    /**
     * SHA-256 of the file's content as validated. The same file imported
     * twice would double every figure in the months it covers, so an active
     * import with the same hash refuses the second.
     */
    fileHash: text("file_hash").notNull(),

    lineCount: integer("line_count").notNull(),
    firstDay: date("first_day", { mode: "string" }).notNull(),
    lastDay: date("last_day", { mode: "string" }).notNull(),
    total: money("total").notNull(),

    importedBy: uuid("imported_by")
      .notNull()
      .references(() => users.id),
    importedAt: ts("imported_at").notNull().defaultNow(),

    status: historyImportStatus("status").notNull().default("active"),
    withdrawnBy: uuid("withdrawn_by").references(() => users.id),
    withdrawnAt: ts("withdrawn_at"),
    withdrawReason: text("withdraw_reason"),
  },
  (t) => [
    uniqueIndex("history_imports_number_idx").on(t.importNumber),
    // The last line of defence under the check in the importer: one active
    // copy of any file.
    uniqueIndex("history_imports_active_hash_idx")
      .on(t.fileHash)
      .where(sql`${t.status} = 'active'`),
    check("history_imports_line_count_positive", sql`${t.lineCount} > 0`),
    check("history_imports_days_ordered", sql`${t.firstDay} <= ${t.lastDay}`),
    // A withdrawal must always say who and why, like a void.
    check(
      "history_imports_withdrawal_is_explained",
      sql`(${t.status} <> 'withdrawn') or (${t.withdrawnBy} is not null and ${t.withdrawReason} is not null and ${t.withdrawnAt} is not null)`,
    ),
  ],
);

/**
 * One line of an imported file: something sold, on a day, for an amount.
 *
 * `item_id` is set when the line names something in the catalogue, and left
 * empty when it does not -- an old record may well mention a medicine the
 * pharmacy no longer stocks, and refusing it would leave a hole in last year's
 * takings. `item_name` is always kept exactly as the file had it.
 */
export const historySaleLines = pgTable(
  "history_sale_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importId: uuid("import_id")
      .notNull()
      .references(() => historyImports.id),
    /** The line's row in the uploaded sheet, header excluded, for tracing back. */
    sourceRow: integer("source_row").notNull(),

    /** A calendar day, like an expiry date: there is no time of day to shift. */
    soldOn: date("sold_on", { mode: "string" }).notNull(),
    /** The old receipt's number, when there was one. Lines sharing it are one sale. */
    receiptNumber: text("receipt_number"),

    itemId: uuid("item_id").references(() => items.id),
    itemName: text("item_name").notNull(),

    qty: qty("qty").notNull(),
    unitPrice: money("unit_price").notNull(),
    /** What was actually charged for the line. The figure every report sums. */
    lineTotal: money("line_total").notNull(),
    /** What the units cost, when the old records say. Without it the line has no margin. */
    unitCost: money("unit_cost"),

    paymentMethod: paymentMethod("payment_method"),
    /** Free text: the old system's cashier was not necessarily an account here. */
    cashierName: text("cashier_name"),
  },
  (t) => [
    check("history_sale_lines_qty_positive", sql`${t.qty} > 0`),
    check("history_sale_lines_total_non_negative", sql`${t.lineTotal} >= 0`),
    check("history_sale_lines_price_non_negative", sql`${t.unitPrice} >= 0`),
    check(
      "history_sale_lines_cost_non_negative",
      sql`${t.unitCost} is null or ${t.unitCost} >= 0`,
    ),
    index("history_sale_lines_import_idx").on(t.importId),
    index("history_sale_lines_sold_on_idx").on(t.soldOn),
    index("history_sale_lines_item_idx").on(t.itemId),
  ],
);

export const historyImportsRelations = relations(historyImports, ({ one, many }) => ({
  importer: one(users, { fields: [historyImports.importedBy], references: [users.id] }),
  lines: many(historySaleLines),
}));

export const historySaleLinesRelations = relations(historySaleLines, ({ one }) => ({
  parent: one(historyImports, {
    fields: [historySaleLines.importId],
    references: [historyImports.id],
  }),
  item: one(items, { fields: [historySaleLines.itemId], references: [items.id] }),
}));
