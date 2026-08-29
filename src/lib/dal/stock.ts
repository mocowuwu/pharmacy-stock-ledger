import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { batches, itemBarcodes, items, stockMovements, suppliers, users } from "@/db/schema";
import { assertPermission } from "./session";
import { recordAudit } from "@/lib/audit";
import { receiveStock, type LedgerError } from "@/lib/stock/ledger";
import { gtinVariants, parseScan, type ScanResult } from "@/lib/stock/gs1";
import { today } from "@/lib/format/date";

export type { LedgerError };

/* ----------------------------------------------------------------- receiving */

export type ReceiveLine = {
  itemId: string;
  supplierId: string;
  lotNumber: string | null;
  expiryDate: string;
  receivedDate: string;
  qty: number;
  unitCost: number;
  isOpening: boolean;
  isLegacy: boolean;
  notes: string | null;
};

/**
 * Books in one batch.
 *
 * Deliberately one line at a time rather than a client-side draft of many:
 * each line is durable the moment it is entered, so a browser closed halfway
 * through a delivery has not lost the first twenty boxes. It also matches how
 * the work is actually done -- box in hand, read the label, type it, next box.
 */
export async function receiveDelivery(line: ReceiveLine) {
  const session = await assertPermission("batches.receive");
  const db = await getDb();

  const result = await db.transaction(async (tx) => {
    return receiveStock(tx as unknown as typeof db, {
      itemId: line.itemId,
      lotNumber: line.lotNumber,
      expiryDate: line.expiryDate,
      supplierId: line.supplierId,
      receivedDate: line.receivedDate,
      qty: line.qty,
      unitCost: line.unitCost,
      performedBy: session.user.id,
      type: line.isOpening ? "opening" : "receive",
      isLegacy: line.isLegacy,
      notes: line.notes,
    });
  });

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: line.isOpening ? "stock.opening_entered" : "stock.received",
    entityType: "batches",
    entityId: result.batchId,
    after: { ...line },
  });

  return result;
}

/** What has been booked in today, so the operator can see their own progress. */
export async function listTodaysReceipts() {
  await assertPermission("batches.receive");
  const db = await getDb();

  return db
    .select({
      batchId: batches.id,
      lotNumber: batches.lotNumber,
      expiryDate: batches.expiryDate,
      qtyReceived: batches.qtyReceived,
      unitCost: batches.unitCost,
      isLegacy: batches.isLegacy,
      itemId: items.id,
      code: items.code,
      genericName: items.genericName,
      strength: items.strength,
      unit: items.unit,
      supplierName: suppliers.name,
    })
    .from(batches)
    .innerJoin(items, eq(items.id, batches.itemId))
    .innerJoin(suppliers, eq(suppliers.id, batches.supplierId))
    .where(eq(batches.receivedDate, today()))
    .orderBy(desc(batches.createdAt))
    .limit(100);
}

/* --------------------------------------------------------------- stock views */

/**
 * On-hand per item, derived from batch remainders. Returned as a map so a list
 * of items costs one query rather than one per row.
 */
export async function onHandByItem(itemIds: string[]): Promise<Map<string, number>> {
  if (itemIds.length === 0) return new Map();
  const db = await getDb();

  const rows = await db
    .select({
      itemId: batches.itemId,
      total: sql<number>`coalesce(sum(${batches.qtyRemaining}), 0)::int`,
    })
    .from(batches)
    .where(and(inArray(batches.itemId, itemIds), eq(batches.status, "active")))
    .groupBy(batches.itemId);

  return new Map(rows.map((r) => [r.itemId, r.total]));
}

/** Batches for one item, earliest expiry first -- the order stock should leave in. */
export async function batchesForItem(itemId: string) {
  await assertPermission("items.view");
  const db = await getDb();

  return db
    .select({
      id: batches.id,
      lotNumber: batches.lotNumber,
      expiryDate: batches.expiryDate,
      qtyReceived: batches.qtyReceived,
      qtyRemaining: batches.qtyRemaining,
      unitCost: batches.unitCost,
      status: batches.status,
      isLegacy: batches.isLegacy,
      receivedDate: batches.receivedDate,
      supplierName: suppliers.name,
    })
    .from(batches)
    .innerJoin(suppliers, eq(suppliers.id, batches.supplierId))
    .where(eq(batches.itemId, itemId))
    .orderBy(batches.expiryDate, batches.receivedDate);
}

/** The ledger for one item: every reason its stock has ever changed. */
export async function movementsForItem(itemId: string, limit = 100) {
  await assertPermission("items.view");
  const db = await getDb();

  return db
    .select({
      id: stockMovements.id,
      type: stockMovements.type,
      qtyDelta: stockMovements.qtyDelta,
      reason: stockMovements.reason,
      createdAt: stockMovements.createdAt,
      lotNumber: batches.lotNumber,
      expiryDate: batches.expiryDate,
      performedBy: users.fullName,
    })
    .from(stockMovements)
    .innerJoin(batches, eq(batches.id, stockMovements.batchId))
    .innerJoin(users, eq(users.id, stockMovements.performedBy))
    .where(eq(stockMovements.itemId, itemId))
    .orderBy(desc(stockMovements.createdAt))
    .limit(limit);
}

/** Total value of stock on hand, at what it cost. Owner-facing. */
export async function stockValuation() {
  await assertPermission("reports.financial");
  const db = await getDb();
  const [row] = await db
    .select({
      value: sql<number>`coalesce(sum(${batches.qtyRemaining} * ${batches.unitCost}), 0)::bigint`,
      units: sql<number>`coalesce(sum(${batches.qtyRemaining}), 0)::int`,
    })
    .from(batches)
    .where(eq(batches.status, "active"));
  return { value: Number(row?.value ?? 0), units: row?.units ?? 0 };
}

/* ---------------------------------------------------------------- scanning */

export type ScanLookup = {
  scan: ScanResult;
  item: { id: string; code: string; genericName: string; strength: string | null; unit: string; packSize: number | null } | null;
  /** Units this barcode represents, when it identifies a pack. */
  packSize: number | null;
};

/**
 * Resolves a scanned barcode to an item, plus whatever else the payload
 * carried. A GS1 code also yields lot and expiry, which is the case worth
 * having: it removes the most common source of bad expiry data, which is
 * someone typing it.
 */
export async function lookupScan(raw: string): Promise<ScanLookup> {
  await assertPermission("items.view");
  const db = await getDb();

  const scan = parseScan(raw);
  const code =
    scan.kind === "gs1" ? scan.gtin : scan.kind === "plain" ? scan.code : null;

  if (!code) return { scan, item: null, packSize: null };

  const [row] = await db
    .select({
      id: items.id,
      code: items.code,
      genericName: items.genericName,
      strength: items.strength,
      unit: items.unit,
      packSize: items.packSize,
      barcodePackSize: itemBarcodes.packSize,
    })
    .from(itemBarcodes)
    .innerJoin(items, eq(items.id, itemBarcodes.itemId))
    .where(inArray(itemBarcodes.barcode, gtinVariants(code)))
    .limit(1);

  if (!row) return { scan, item: null, packSize: null };

  const { barcodePackSize, ...item } = row;
  return { scan, item, packSize: barcodePackSize ?? item.packSize };
}

/** Attaches a scanned code to an item, which is how the barcode table fills up. */
export async function attachBarcode(itemId: string, barcode: string, packSize: number | null) {
  const session = await assertPermission("items.edit");
  const db = await getDb();
  const [created] = await db
    .insert(itemBarcodes)
    .values({ itemId, barcode, packSize })
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
