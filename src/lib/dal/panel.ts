import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { panelEntries, panelSequences } from "@/db/schema";
import { assertPermission } from "./session";
import { recordAudit } from "@/lib/audit";
import { today } from "@/lib/format/date";

/** Next panel entry number for the current year, e.g. PANEL-2026-001. */
export async function nextPanelNumber(): Promise<string> {
  const db = await getDb();
  const zone = process.env.PHARMACY_TIMEZONE || "Asia/Jakarta";
  const year = Number(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
    }).format(new Date())
  );

  const [row] = await db
    .insert(panelSequences)
    .values({ year, lastNumber: 0 })
    .onConflictDoUpdate({
      target: panelSequences.year,
      set: { lastNumber: sql`${panelSequences.lastNumber} + 1` },
    })
    .returning({ lastNumber: panelSequences.lastNumber });

  const n = row?.lastNumber ?? 1;
  return `PANEL-${year}-${String(n).padStart(3, "0")}`;
}

export type PanelEntryInput = {
  entryDate: string;
  itemCode: string;
  itemName: string;
  unit: string;
  qty: number;
  unitCost: number;
  unitPrice: number;
  partnerName: string | null;
  destination: string | null;
  notes: string | null;
  pharmacistId: string | null;
};

/**
 * Creates a panel entry.
 * Does NOT affect stock levels -- purely financial/administrative record.
 */
export async function createPanelEntry(input: PanelEntryInput) {
  const session = await assertPermission("panel.create");
  const db = await getDb();

  const entryNumber = await nextPanelNumber();

  const [created] = await db
    .insert(panelEntries)
    .values({
      entryNumber,
      entryDate: new Date(input.entryDate),
      recordedBy: session.user.id,
      pharmacistId: input.pharmacistId,
      itemCode: input.itemCode,
      itemName: input.itemName,
      unit: input.unit,
      qty: input.qty,
      unitCost: input.unitCost,
      unitPrice: input.unitPrice,
      partnerName: input.partnerName,
      destination: input.destination,
      notes: input.notes,
    })
    .returning();

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "panel.entry_created",
    entityType: "panel_entries",
    entityId: created.id,
    after: {
      entryNumber,
      entryDate: input.entryDate,
      itemCode: input.itemCode,
      itemName: input.itemName,
      qty: input.qty,
      unitCost: input.unitCost,
      unitPrice: input.unitPrice,
      partnerName: input.partnerName,
      destination: input.destination,
    },
  });

  return created;
}

export type PanelEntryFilters = {
  from?: string;
  to?: string;
  itemCode?: string;
  recordedBy?: string;
};

/** Lists panel entries with optional filters. */
export async function listPanelEntries(filters: PanelEntryFilters = {}, limit = 100) {
  await assertPermission("panel.view");
  const db = await getDb();

  const conditions = [];

  if (filters.from) conditions.push(sql`${panelEntries.entryDate} >= ${filters.from}`);
  if (filters.to) conditions.push(sql`${panelEntries.entryDate} <= ${filters.to}`);
  if (filters.itemCode) conditions.push(sql`${panelEntries.itemCode} ILIKE ${`%${filters.itemCode}%`}`);
  if (filters.recordedBy) conditions.push(eq(panelEntries.recordedBy, filters.recordedBy));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select({
      id: panelEntries.id,
      entryNumber: panelEntries.entryNumber,
      entryDate: sql<string>`to_char(${panelEntries.entryDate} at time zone ${process.env.PHARMACY_TIMEZONE || 'Asia/Jakarta'}, 'YYYY-MM-DD')`.as("entryDate"),
      itemCode: panelEntries.itemCode,
      itemName: panelEntries.itemName,
      unit: panelEntries.unit,
      qty: panelEntries.qty,
      unitCost: panelEntries.unitCost,
      unitPrice: panelEntries.unitPrice,
      partnerName: panelEntries.partnerName,
      destination: panelEntries.destination,
      notes: panelEntries.notes,
      recordedBy: panelEntries.recordedBy,
      recordedByName: sql<string>`${panelEntries.recordedBy}`.as("recordedByName"),
      pharmacistId: panelEntries.pharmacistId,
      createdAt: panelEntries.createdAt,
    })
    .from(panelEntries)
    .where(whereClause)
    .orderBy(desc(panelEntries.entryDate), desc(panelEntries.createdAt))
    .limit(limit);
}

/** Summary totals for a date range. */
export async function panelSummary(from: string, to: string) {
  await assertPermission("panel.view");
  const db = await getDb();

  const [row] = await db
    .select({
      totalEntries: sql<number>`count(*)::int`,
      totalQty: sql<number>`coalesce(sum(${panelEntries.qty}), 0)::int`,
      totalCost: sql<number>`coalesce(sum(${panelEntries.qty} * ${panelEntries.unitCost}), 0)::bigint`,
      totalRevenue: sql<number>`coalesce(sum(${panelEntries.qty} * ${panelEntries.unitPrice}), 0)::bigint`,
    })
    .from(panelEntries)
    .where(and(
      sql`${panelEntries.entryDate} >= ${from}`,
      sql`${panelEntries.entryDate} <= ${to}`
    ));

  return {
    totalEntries: row?.totalEntries ?? 0,
    totalQty: row?.totalQty ?? 0,
    totalCost: Number(row?.totalCost ?? 0),
    totalRevenue: Number(row?.totalRevenue ?? 0),
    totalMargin: Number((row?.totalRevenue ?? 0) - (row?.totalCost ?? 0)),
  };
}