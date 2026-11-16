import { and, desc, eq, gte, ilike, isNull, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Database } from "@/db/client";
import { items, panelEntries, settings, taxRates, users } from "@/db/schema";
import { today } from "@/lib/format/date";
import { isUuid } from "@/lib/format/ids";
import { parseMoney } from "@/lib/format/money";
import { isReportDay } from "@/lib/reports/catalogue";
import { lockNumberSeries } from "@/lib/stock/numbering";
import { activeTax } from "@/lib/stock/sale";
import { saleTotals } from "@/lib/stock/totals";
import { panelCounts, panelLine, panelTaxInside, panelTaxOnTop } from "./amounts";

/**
 * Panel entries: what the pharmacy orders on a doctor's behalf.
 *
 * This module writes no `stock_movements` row and touches no batch. An order
 * placed for a doctor is new stock that never lands on the pharmacy's shelf, so
 * putting it through the ledger would invent units the pharmacy never held. The
 * entry is a record of the order and of the money -- nothing more -- and it
 * takes an executor and an actor id like everything in `src/lib/stock/`, so
 * the arithmetic and the numbering can be tested against a real database.
 */

/** Stable codes. Each one has a message at `errors.<code>` in both catalogues. */
export const PANEL_ERROR_CODES = [
  "required",
  "order_ref_required",
  "recipient_required",
  "too_long",
  "invalid_quantity",
  "invalid_cost",
  "invalid_price",
  "invalid_date",
  "date_in_future",
  "restricted_class",
  "not_a_pharmacist",
  "reason_required",
  "entry_not_found",
  "already_voided",
  "already_rejected",
  "tax_unavailable",
  "no_tax_rate",
  "not_pending",
  "cannot_decide_own",
] as const;
export type PanelErrorCode = (typeof PANEL_ERROR_CODES)[number];

export class PanelError extends Error {
  constructor(
    readonly code: PanelErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = "PanelError";
  }
}

/**
 * Classes that cannot go through a panel entry. Narcotics and psychotropics are
 * ordered on their own special surat pesanan and answered for by the
 * pharmacist, so a free-form line here is the wrong place for them. The check
 * only bites when the code names a catalogue item; a code the catalogue does
 * not know cannot be classified, which is why the screen's search never offers
 * these in the first place.
 */
export const PANEL_RESTRICTED_CLASSES = ["narkotika", "psikotropika"] as const;

const LIMITS = {
  itemCode: 40,
  itemName: 200,
  unit: 20,
  orderRef: 60,
  partnerName: 120,
  destination: 120,
  notes: 500,
  qty: 1_000_000_000,
  money: 1_000_000_000_000,
} as const;

/** What the form submits: every field a string, nothing trusted yet. */
export type RawPanelInput = {
  entryDate: string;
  orderRef: string;
  itemCode: string;
  itemName: string;
  unit: string;
  qty: string;
  unitCost: string;
  unitPrice: string;
  partnerName: string;
  destination: string;
  notes: string;
  pharmacistId: string;
  /** The PPN checkbox: "on" when ticked, anything else (or absent) when not. */
  taxed?: string;
};

export type PanelInput = {
  entryDate: string;
  orderRef: string;
  itemCode: string;
  itemName: string;
  unit: string;
  qty: number;
  unitCost: number;
  unitPrice: number;
  partnerName: string | null;
  destination: string;
  notes: string | null;
  pharmacistId: string | null;
  /** Whether this order carries PPN. Whether it *can* is decided against the settings. */
  taxed?: boolean;
};

function text(value: string | undefined, max: number): string {
  const trimmed = (value ?? "").trim();
  if (trimmed.length > max) throw new PanelError("too_long");
  return trimmed;
}

function wholeNumber(value: string | undefined, max: number, code: PanelErrorCode, min = 0): number {
  // `parseMoney` accepts only true groupings (`15.000`, `1,500,000`), so a typed
  // "9090.91" is refused instead of being read as 909,091 -- a quantity and a
  // price are whole numbers and go through the same reading.
  const parsed = parseMoney((value ?? "").trim());
  if (parsed === null || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new PanelError(code);
  }
  return parsed;
}

/**
 * Reads and checks a submission. `on` is today in the pharmacy's timezone: an
 * entry cannot be dated after it, and the date is a plain calendar day.
 */
export function parsePanelInput(raw: RawPanelInput, on: string = today()): PanelInput {
  const itemCode = text(raw.itemCode, LIMITS.itemCode);
  const itemName = text(raw.itemName, LIMITS.itemName);
  const unit = text(raw.unit, LIMITS.unit);
  if (!itemCode || !itemName || !unit) throw new PanelError("required");

  const orderRef = text(raw.orderRef, LIMITS.orderRef);
  if (!orderRef) throw new PanelError("order_ref_required");

  const destination = text(raw.destination, LIMITS.destination);
  if (!destination) throw new PanelError("recipient_required");

  const entryDate = (raw.entryDate ?? "").trim();
  if (!isReportDay(entryDate)) throw new PanelError("invalid_date");
  if (entryDate > on) throw new PanelError("date_in_future");

  const pharmacistId = (raw.pharmacistId ?? "").trim();
  if (pharmacistId && !isUuid(pharmacistId)) throw new PanelError("not_a_pharmacist");

  return {
    entryDate,
    orderRef,
    itemCode,
    itemName,
    unit,
    qty: wholeNumber(raw.qty, LIMITS.qty, "invalid_quantity", 1),
    // Both prices are required, and zero is a deliberate answer: a blank field
    // is a slip, and defaulting it to zero would book an order at no cost.
    unitCost: wholeNumber(raw.unitCost, LIMITS.money, "invalid_cost"),
    unitPrice: wholeNumber(raw.unitPrice, LIMITS.money, "invalid_price"),
    partnerName: text(raw.partnerName, LIMITS.partnerName) || null,
    destination,
    notes: text(raw.notes, LIMITS.notes) || null,
    pharmacistId: pharmacistId || null,
    taxed: raw.taxed === "on" || raw.taxed === "true",
  };
}

/** Sequential per day and never reused, like the sale, return and disposal numbers. */
export async function nextPanelNumber(tx: Database, on: string): Promise<string> {
  await lockNumberSeries(tx, "panel", on);
  const prefix = `PNL${on.replaceAll("-", "").slice(2)}`; // PNLYYMMDD
  const [last] = await tx
    .select({ number: panelEntries.entryNumber })
    .from(panelEntries)
    .where(sql`${panelEntries.entryNumber} like ${`${prefix}-%`}`)
    .orderBy(desc(panelEntries.entryNumber))
    .limit(1);

  const seq = last ? Number(last.number.split("-")[1]) + 1 : 1;
  return `${prefix}-${String(seq).padStart(4, "0")}`;
}

/**
 * Writes one entry inside the caller's transaction. No ledger row, no batch.
 *
 * Two things are decided here rather than on the screen, because a screen can
 * be bypassed:
 *
 * - **PPN.** Only if the pharmacy charges PPN at all, at the rate in force on the
 *   entry's own day, in the pharmacy's mode, worked out by `saleTotals` -- the
 *   function the till charges with, so an order and a sale of the same amount
 *   carry the same tax. The result is stored on the row; nothing recomputes it.
 * - **Approval.** When the pharmacy asks for it, an order from anyone but the
 *   owner starts `pending` and counts for nothing until someone else decides.
 *   The owner's own orders are approved as written: nobody is above them.
 *
 * The number is allocated last, immediately before the insert, so everything
 * that can fail has already failed and only the moment of numbering is
 * single-file.
 */
export async function recordPanelEntry(
  tx: Database,
  input: PanelInput & { actorId: string; actorIsOwner?: boolean },
) {
  const [known] = await tx
    .select({ drugClass: items.drugClass })
    .from(items)
    .where(sql`lower(${items.code}) = lower(${input.itemCode})`)
    .limit(1);
  if (known && (PANEL_RESTRICTED_CLASSES as readonly string[]).includes(known.drugClass)) {
    throw new PanelError("restricted_class");
  }

  if (input.pharmacistId) {
    const [pharmacist] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, input.pharmacistId),
          eq(users.isPharmacist, true),
          eq(users.status, "active"),
        ),
      )
      .limit(1);
    if (!pharmacist) throw new PanelError("not_a_pharmacist");
  }

  const [config] = await tx.select().from(settings).where(eq(settings.id, 1));

  let tax: { mode: "inclusive" | "exclusive"; rateBps: number; amount: number } | null = null;
  if (input.taxed) {
    const active = await activeTax(tx, input.entryDate);
    if (!active) {
      // Say which: a pharmacy that charges no PPN, or one with no rate in force that day.
      throw new PanelError(config?.taxEnabled ? "no_tax_rate" : "tax_unavailable");
    }
    const totals = saleTotals(
      [{ qty: input.qty, unitPrice: input.unitPrice, taxExempt: false }],
      0,
      { mode: active.mode, rateBps: active.rate.rateBps },
    );
    tax = { mode: active.mode, rateBps: active.rate.rateBps, amount: totals.taxAmount };
  }

  const needsApproval = !!config?.panelApprovalRequired && !input.actorIsOwner;

  const entryNumber = await nextPanelNumber(tx, today());
  const [created] = await tx
    .insert(panelEntries)
    .values({
      entryNumber,
      entryDate: input.entryDate,
      recordedBy: input.actorId,
      pharmacistId: input.pharmacistId,
      orderRef: input.orderRef,
      itemCode: input.itemCode,
      itemName: input.itemName,
      unit: input.unit,
      qty: input.qty,
      unitCost: input.unitCost,
      unitPrice: input.unitPrice,
      partnerName: input.partnerName,
      destination: input.destination,
      notes: input.notes,
      taxMode: tax?.mode ?? null,
      taxRateBps: tax?.rateBps ?? null,
      taxAmount: tax?.amount ?? 0,
      // Approved on the spot names its own recorder as the decider; the decision
      // check on the table wants a person and a time on every row that is not
      // waiting.
      status: needsApproval ? "pending" : "approved",
      decidedBy: needsApproval ? null : input.actorId,
      decidedAt: needsApproval ? null : sql`now()`,
    })
    .returning();

  return created;
}

/**
 * Approves or rejects a pending entry.
 *
 * Nobody decides their own order -- that would make the approval a formality --
 * except the owner, who has nobody above them (and whose own orders are never
 * pending, so in practice the owner decides other people's). A refusal says why,
 * and a decision is final: it is the person and the time on the row, not
 * something to be flipped back, so a wrong rejection is answered with a new
 * entry, as a wrong void is.
 */
export async function decidePanelEntry(
  tx: Database,
  request: {
    entryId: string;
    decision: "approve" | "reject";
    note: string;
    actorId: string;
    actorIsOwner?: boolean;
  },
) {
  const note = request.note.trim();
  if (request.decision === "reject" && !note) throw new PanelError("reason_required");
  if (note.length > LIMITS.notes) throw new PanelError("too_long");

  const [entry] = await tx
    .select({
      status: panelEntries.status,
      voidedAt: panelEntries.voidedAt,
      recordedBy: panelEntries.recordedBy,
    })
    .from(panelEntries)
    .where(eq(panelEntries.id, request.entryId))
    .limit(1);
  if (!entry) throw new PanelError("entry_not_found");
  if (entry.voidedAt) throw new PanelError("already_voided");
  if (entry.status !== "pending") throw new PanelError("not_pending");
  if (entry.recordedBy === request.actorId && !request.actorIsOwner) {
    throw new PanelError("cannot_decide_own");
  }

  // Conditional on still being pending: two people deciding at once, the second
  // finds it decided and changes nothing.
  const [decided] = await tx
    .update(panelEntries)
    .set({
      status: request.decision === "approve" ? "approved" : "rejected",
      decidedBy: request.actorId,
      decidedAt: sql`now()`,
      decisionNote: note || null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(panelEntries.id, request.entryId),
        eq(panelEntries.status, "pending"),
        isNull(panelEntries.voidedAt),
      ),
    )
    .returning();
  if (!decided) throw new PanelError("not_pending");
  return decided;
}

/**
 * Voids an entry. Nothing is deleted: the row stays, says who voided it and
 * why, and stops counting toward the totals. The conditional update is the
 * guard against two people voiding the same entry at once -- the second one
 * finds it already voided and changes nothing.
 */
export async function voidPanelEntry(
  tx: Database,
  request: { entryId: string; reason: string; actorId: string },
) {
  const reason = request.reason.trim();
  if (!reason) throw new PanelError("reason_required");
  if (reason.length > LIMITS.notes) throw new PanelError("too_long");

  const [voided] = await tx
    .update(panelEntries)
    .set({
      voidedAt: sql`now()`,
      voidedBy: request.actorId,
      voidReason: reason,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(panelEntries.id, request.entryId),
        isNull(panelEntries.voidedAt),
        // A rejected entry is already dead; voiding it would only blur the record.
        ne(panelEntries.status, "rejected"),
      ),
    )
    .returning();
  if (voided) return voided;

  const [existing] = await tx
    .select({ id: panelEntries.id, status: panelEntries.status })
    .from(panelEntries)
    .where(eq(panelEntries.id, request.entryId))
    .limit(1);
  if (!existing) throw new PanelError("entry_not_found");
  throw new PanelError(existing.status === "rejected" ? "already_rejected" : "already_voided");
}

export type PanelRange = { from: string; to: string };

/** Postgres hands `bigint` sums back as text. */
const num = (value: unknown) => Number(value ?? 0);

/**
 * The entries in a window, newest first, voided ones included and marked.
 *
 * The window is on `entry_date`, a plain calendar day, so the last day of the
 * range is whole: comparing an instant to "2026-10-01" would have stopped at
 * midnight and dropped everything entered that day.
 */
export async function listPanelRows(
  db: Database,
  range: PanelRange,
  /** `null` for every row: an export is the whole record, not the first screen of it. */
  limit: number | null = 200,
  /**
   * `pending` lists everything still waiting, on any date: the approver's
   * question is "what is waiting for me", not "what is waiting in October".
   */
  only?: { status: "pending" },
) {
  const recorder = alias(users, "recorder");
  const pharmacist = alias(users, "pharmacist");
  const voider = alias(users, "voider");
  const decider = alias(users, "decider");

  const rows = db
    .select({
      id: panelEntries.id,
      entryNumber: panelEntries.entryNumber,
      entryDate: panelEntries.entryDate,
      orderRef: panelEntries.orderRef,
      itemCode: panelEntries.itemCode,
      itemName: panelEntries.itemName,
      unit: panelEntries.unit,
      qty: panelEntries.qty,
      unitCost: panelEntries.unitCost,
      unitPrice: panelEntries.unitPrice,
      partnerName: panelEntries.partnerName,
      destination: panelEntries.destination,
      notes: panelEntries.notes,
      recordedBy: recorder.fullName,
      recordedById: panelEntries.recordedBy,
      pharmacist: pharmacist.fullName,
      taxMode: panelEntries.taxMode,
      taxRateBps: panelEntries.taxRateBps,
      taxAmount: panelEntries.taxAmount,
      status: panelEntries.status,
      decidedBy: decider.fullName,
      decidedAt: panelEntries.decidedAt,
      decisionNote: panelEntries.decisionNote,
      voidedAt: panelEntries.voidedAt,
      voidedBy: voider.fullName,
      voidReason: panelEntries.voidReason,
      createdAt: panelEntries.createdAt,
    })
    .from(panelEntries)
    .innerJoin(recorder, eq(recorder.id, panelEntries.recordedBy))
    .leftJoin(pharmacist, eq(pharmacist.id, panelEntries.pharmacistId))
    .leftJoin(voider, eq(voider.id, panelEntries.voidedBy))
    .leftJoin(decider, eq(decider.id, panelEntries.decidedBy))
    .where(
      only
        ? and(eq(panelEntries.status, only.status), isNull(panelEntries.voidedAt))
        : and(gte(panelEntries.entryDate, range.from), lte(panelEntries.entryDate, range.to)),
    )
    .orderBy(desc(panelEntries.entryDate), desc(panelEntries.createdAt))
    .$dynamic();

  // One more than asked for, so the caller can tell "exactly 200" from "more".
  const found = limit === null ? await rows : await rows.limit(limit + 1);
  return limit === null
    ? { rows: found, truncated: false }
    : { rows: found.slice(0, limit), truncated: found.length > limit };
}

/**
 * What the window adds up to, by the one definition of "counts" in `amounts.ts`:
 * approved and not voided. `revenue` is the price the orders were written at;
 * `tax` the PPN on them, wherever it sits; and the margin is taken on what the
 * pharmacy actually keeps -- the price less any PPN inside it, less cost -- the
 * same arithmetic the gross profit report does with these entries.
 */
export async function panelTotals(db: Database, range: PanelRange) {
  const [row] = await db
    .select({
      entries: sql<number>`count(*)`,
      qty: sql<string>`coalesce(sum(${panelEntries.qty}), 0)`,
      revenue: sql<string>`coalesce(sum(${panelLine}), 0)`,
      tax: sql<string>`coalesce(sum(${panelEntries.taxAmount}), 0)`,
      taxInside: sql<string>`coalesce(sum(${panelTaxInside}), 0)`,
      taxOnTop: sql<string>`coalesce(sum(${panelTaxOnTop}), 0)`,
      cost: sql<string>`coalesce(sum(${panelEntries.qty} * ${panelEntries.unitCost}), 0)`,
    })
    .from(panelEntries)
    .where(
      and(
        gte(panelEntries.entryDate, range.from),
        lte(panelEntries.entryDate, range.to),
        panelCounts,
      ),
    );

  const revenue = num(row?.revenue);
  const cost = num(row?.cost);
  return {
    entries: num(row?.entries),
    qty: num(row?.qty),
    revenue,
    tax: num(row?.tax),
    cost,
    margin: revenue - num(row?.taxInside) - cost,
  };
}

/** Entries waiting for a decision, on any date. Voided ones are no longer waiting. */
export async function panelPendingCount(db: Database): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(panelEntries)
    .where(and(eq(panelEntries.status, "pending"), isNull(panelEntries.voidedAt)));
  return row?.count ?? 0;
}

/**
 * What the order form needs to offer PPN: whether the pharmacy charges it, in
 * what mode, whether it starts ticked, and every rate with its dates (small, and
 * the rate that applies is the one in force on the order's own day, which the
 * form can only pick once it knows the date).
 */
export async function panelTaxChoices(db: Database) {
  const [config] = await db.select().from(settings).where(eq(settings.id, 1));
  const rates = await db
    .select({
      rateBps: taxRates.rateBps,
      effectiveFrom: taxRates.effectiveFrom,
      effectiveTo: taxRates.effectiveTo,
    })
    .from(taxRates)
    .orderBy(desc(taxRates.effectiveFrom));
  return {
    enabled: !!config?.taxEnabled,
    mode: (config?.taxMode ?? "exclusive") as "inclusive" | "exclusive",
    defaultOn: !!config?.panelTaxDefault,
    rates,
  };
}

/** Escapes LIKE's own wildcards, so a typed "%" or "_" matches itself. */
function literal(query: string): string {
  return query.replace(/[\\%_]/gu, (char) => `\\${char}`);
}

/**
 * The item picker's search. Active catalogue items only, never the classes a
 * panel entry refuses, so the screen cannot offer what the save would reject.
 */
export async function searchPanelItems(db: Database, query: string, limit = 10) {
  const term = query.trim();
  if (term.length < 2) return [];
  const pattern = `%${literal(term)}%`;

  const found = await db
    .select({
      id: items.id,
      code: items.code,
      genericName: items.genericName,
      brandName: items.brandName,
      strength: items.strength,
      unit: items.unit,
      drugClass: items.drugClass,
    })
    .from(items)
    .where(
      and(
        eq(items.status, "active"),
        notInArray(items.drugClass, [...PANEL_RESTRICTED_CLASSES]),
        or(
          ilike(items.code, pattern),
          ilike(items.genericName, pattern),
          ilike(items.brandName, pattern),
        ),
      ),
    )
    .orderBy(items.genericName)
    .limit(Math.min(Math.max(Math.trunc(limit) || 10, 1), 20));

  return found.map((item) => ({
    id: item.id,
    code: item.code,
    // Item names are data, never translated: this is the name as catalogued.
    name: `${item.genericName}${item.strength ? ` ${item.strength}` : ""}${item.brandName ? ` (${item.brandName})` : ""}`,
    unit: item.unit,
    drugClass: item.drugClass,
  }));
}

/** Active accounts flagged as pharmacists: who an entry can name as answerable. */
export async function pharmacistChoices(db: Database) {
  return db
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .where(and(eq(users.isPharmacist, true), eq(users.status, "active")))
    .orderBy(users.fullName);
}

export type PanelListRow = Awaited<ReturnType<typeof listPanelRows>>["rows"][number];

/** A row after `applyCostVisibility`: the unit cost is null for a reader who may not see it. */
export type PanelViewRow = Omit<PanelListRow, "unitCost"> & { unitCost: number | null };

export type PanelTotals = Awaited<ReturnType<typeof panelTotals>>;

/**
 * Takes what the pharmacy pays out of a screen's data when the reader may not
 * see it. Cost prices and margins are the pharmacy's purchase terms -- the
 * `reports.sales` / `reports.financial` split keeps them off the shop floor --
 * and a screen that merely hid the columns would still have shipped the numbers
 * to the browser, so this runs before the data leaves the DAL.
 */
export function applyCostVisibility(
  data: { rows: PanelListRow[]; totals: PanelTotals },
  canSeeCost: boolean,
) {
  return {
    rows: data.rows.map((row) => ({
      ...row,
      unitCost: canSeeCost ? row.unitCost : (null as number | null),
    })),
    totals: {
      entries: data.totals.entries,
      qty: data.totals.qty,
      revenue: data.totals.revenue,
      tax: data.totals.tax,
      cost: canSeeCost ? data.totals.cost : (null as number | null),
      margin: canSeeCost ? data.totals.margin : (null as number | null),
    },
  };
}
