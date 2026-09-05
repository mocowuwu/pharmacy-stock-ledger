import "server-only";

import { getDb } from "@/db";
import { assertPermission } from "./session";
import { recordAudit } from "@/lib/audit";
import {
  commitImportRows,
  parseImportCsv,
  validateImportRows,
  type ImportPreview,
} from "@/lib/catalogue/import";

export class ImportError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ImportError";
  }
}

/** Parses and validates a spreadsheet without writing anything. */
export async function previewImport(csvText: string): Promise<ImportPreview> {
  await assertPermission("items.import");
  const db = await getDb();

  const { rows, error } = parseImportCsv(csvText);
  if (error) throw new ImportError(error);
  if (rows.length === 0) throw new ImportError("empty_file");

  return validateImportRows(db, rows);
}

/**
 * Re-validates against the current catalogue and writes the valid rows in one
 * transaction, then records the same audit entries a manual entry would --
 * `item.created` per item, `stock.opening_entered` per batch -- so the audit
 * log reads the same regardless of how a row got there.
 */
export async function commitImport(csvText: string) {
  const session = await assertPermission("items.import");
  const db = await getDb();

  const { rows, error } = parseImportCsv(csvText);
  if (error) throw new ImportError(error);
  if (rows.length === 0) throw new ImportError("empty_file");

  const { itemIds, batchIds, validRows } = await db.transaction(async (tx) => {
    const preview = await validateImportRows(tx as unknown as typeof db, rows);
    const result = await commitImportRows(
      tx as unknown as typeof db,
      session.user.id,
      preview.validRows,
    );
    return { ...result, validRows: preview.validRows };
  });

  for (const [index, itemId] of itemIds.entries()) {
    await recordAudit({
      userId: session.user.id,
      actorLabel: session.user.username,
      action: "item.created",
      entityType: "items",
      entityId: itemId,
      after: { source: "import", row: validRows[index]?.row },
    });
  }

  for (const batchId of batchIds) {
    await recordAudit({
      userId: session.user.id,
      actorLabel: session.user.username,
      action: "stock.opening_entered",
      entityType: "batches",
      entityId: batchId,
      after: { source: "import" },
    });
  }

  return { itemsCreated: itemIds.length, batchesCreated: batchIds.length };
}
