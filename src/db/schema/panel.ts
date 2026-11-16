import { sql } from "drizzle-orm";
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
import { money, qty, ts } from "./columns";
import { panelStatus, taxMode } from "./enums";
import { users } from "./users";

/**
 * Panel entries: medicine the pharmacy orders on a doctor's behalf.
 *
 * A doctor may not sell medicine, so the supply goes through the pharmacy: the
 * pharmacy places the order with the PBF on its own surat pesanan and resells
 * to the doctor at the price it negotiated. That order is new stock that never
 * sits on the pharmacy's shelf, so it must not touch a batch -- an entry here
 * writes no `stock_movements` row and moves no `qty_remaining`. It is a record
 * of the order and of the money, for the finance recap, and nothing else.
 *
 * What it is NOT: paperwork cover for someone else's shipment. Every entry
 * names the surat pesanan it was ordered on, the supplier, the recipient and
 * the account that recorded it, so the pharmacy can answer for each line.
 *
 * Like the ledger it is append-only. A wrong entry is voided with a reason and
 * stays in the record; it stops counting toward the totals.
 */
export const panelEntries = pgTable(
  "panel_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Sequential per day, allocated under `lockNumberSeries`. Never reused. */
    entryNumber: text("entry_number").notNull(),
    /**
     * The calendar day of the order. A plain date, not an instant: a report day
     * is the day the pharmacist chose, and a timestamp cast through a timezone
     * would file an early-morning Jakarta entry under the day before.
     */
    entryDate: date("entry_date", { mode: "string" }).notNull(),

    /** The account that recorded the entry. Every write carries a user id. */
    recordedBy: uuid("recorded_by")
      .notNull()
      .references(() => users.id),
    /** The pharmacist answerable for the supply, when one is named. */
    pharmacistId: uuid("pharmacist_id").references(() => users.id),

    /**
     * The surat pesanan (or purchase order) the pharmacy placed. Required by the
     * action rather than the column, so rows written before it existed stay valid.
     */
    orderRef: text("order_ref"),

    /** The item as the pharmacist typed it: a catalogue code, or any code. */
    itemCode: text("item_code").notNull(),
    itemName: text("item_name").notNull(),
    unit: text("unit").notNull(),

    qty: qty("qty").notNull(),
    /** What the pharmacy pays per unit (harga beli). Whole rupiah. */
    unitCost: money("unit_cost").notNull().default(0),
    /** What the doctor pays per unit (harga jual). Whole rupiah. */
    unitPrice: money("unit_price").notNull().default(0),

    /** The PBF or distributor the pharmacy ordered from. */
    partnerName: text("partner_name"),
    /** Who the medicine is for: the doctor or clinic. */
    destination: text("destination"),
    notes: text("notes"),

    /**
     * PPN on the order, snapshotted when it was written, like a sale's: the
     * mode and the rate that applied on the entry's day, and the rupiah they came
     * to on the line. `exclusive` adds it on top of the price; `inclusive` finds
     * it inside. Null mode and a zero amount when the order carries none. Stored
     * rather than recomputed, so a later change of rate or mode rewrites nothing.
     */
    taxMode: taxMode("tax_mode"),
    taxRateBps: integer("tax_rate_bps"),
    taxAmount: money("tax_amount").notNull().default(0),

    /**
     * Whether the order counts. Always `approved` unless the pharmacy asks for
     * approval, in which case a non-owner's order is `pending` until someone
     * above them decides. The decision is the person, the time and -- for a
     * refusal -- the reason; an auto-approved order names its own recorder.
     */
    status: panelStatus("status").notNull().default("approved"),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: ts("decided_at"),
    decisionNote: text("decision_note"),

    voidedAt: ts("voided_at"),
    voidedBy: uuid("voided_by").references(() => users.id),
    voidReason: text("void_reason"),

    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("panel_entries_qty_positive", sql`${t.qty} > 0`),
    check("panel_entries_money_not_negative", sql`${t.unitCost} >= 0 and ${t.unitPrice} >= 0`),
    check(
      "panel_entries_tax_complete",
      sql`(${t.taxMode} is null) = (${t.taxRateBps} is null) and ${t.taxAmount} >= 0 and (${t.taxMode} is not null or ${t.taxAmount} = 0)`,
    ),
    // Pending is the only state with no decision; a refusal always says why.
    check(
      "panel_entries_decision_complete",
      sql`(${t.status} = 'pending') = (${t.decidedAt} is null) and (${t.decidedAt} is null) = (${t.decidedBy} is null) and (${t.status} <> 'rejected' or ${t.decisionNote} is not null)`,
    ),
    // A void is all three facts or none: a row cannot be half-voided.
    check(
      "panel_entries_void_complete",
      sql`(${t.voidedAt} is null) = (${t.voidedBy} is null) and (${t.voidedAt} is null) = (${t.voidReason} is null)`,
    ),
    uniqueIndex("panel_entries_number_idx").on(t.entryNumber),
    index("panel_entries_entry_date_idx").on(t.entryDate),
    index("panel_entries_recorded_by_idx").on(t.recordedBy),
    index("panel_entries_status_idx").on(t.status),
    index("panel_entries_item_code_idx").on(t.itemCode),
  ],
);
