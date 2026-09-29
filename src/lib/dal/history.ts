import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import { historyImports, users } from "@/db/schema";
import { assertPermission } from "./session";
import { getSettings } from "./settings";
import { recordAudit } from "@/lib/audit";
import {
  commitHistoryRows,
  historyFileHash,
  HistoryImportError,
  parseHistoryCsv,
  validateHistoryRows,
  withdrawHistoryImport,
  type HistoryPreview,
} from "@/lib/history/import";

export { HistoryImportError };

/**
 * Importing past sales, with the permission and the audit trail around the
 * rules in `src/lib/history/import.ts`.
 *
 * `sales.import_history` guards all of it, including the list of past
 * imports: what was imported, and what was taken back out, is the owner's
 * business, and it moves every revenue figure in the reports.
 */

function parse(csvText: string) {
  const { rows, error } = parseHistoryCsv(csvText);
  if (error) throw new HistoryImportError(error);
  if (rows.length === 0) throw new HistoryImportError("empty_file");
  return rows;
}

/** Parses and checks a file without writing anything. */
export async function previewHistoryImport(csvText: string): Promise<HistoryPreview> {
  await assertPermission("sales.import_history");
  const db = await getDb();
  const settings = await getSettings();

  return validateHistoryRows(db, parse(csvText), {
    timezone: settings.timezone,
    fileHash: historyFileHash(csvText),
  });
}

/**
 * Checks the file again against today's catalogue and writes the rows that
 * pass, all in one transaction. The audit entry goes in after the commit, as
 * the catalogue import's do, and names the import rather than every line.
 */
export async function commitHistoryImport(csvText: string, fileName: string | null) {
  const session = await assertPermission("sales.import_history");
  const db = await getDb();
  const settings = await getSettings();
  const rows = parse(csvText);
  const fileHash = historyFileHash(csvText);

  const result = await db.transaction(async (tx) => {
    const preview = await validateHistoryRows(tx as unknown as typeof db, rows, {
      timezone: settings.timezone,
      fileHash,
    });
    if (preview.duplicateOf) throw new HistoryImportError("already_imported");
    return commitHistoryRows(tx as unknown as typeof db, {
      actorId: session.user.id,
      rows: preview.validRows,
      fileHash,
      fileName,
    });
  });

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "history.imported",
    entityType: "history_imports",
    entityId: result.importId,
    after: {
      importNumber: result.importNumber,
      fileName,
      lines: result.summary.lines,
      firstDay: result.summary.firstDay,
      lastDay: result.summary.lastDay,
      total: result.summary.total,
    },
  });

  return result;
}

export async function listHistoryImports() {
  await assertPermission("sales.import_history");
  const db = await getDb();
  const withdrawer = alias(users, "withdrawer");

  return db
    .select({
      id: historyImports.id,
      importNumber: historyImports.importNumber,
      fileName: historyImports.fileName,
      lineCount: historyImports.lineCount,
      firstDay: historyImports.firstDay,
      lastDay: historyImports.lastDay,
      total: historyImports.total,
      importedAt: historyImports.importedAt,
      importedBy: users.fullName,
      status: historyImports.status,
      withdrawnAt: historyImports.withdrawnAt,
      withdrawnBy: sql<string | null>`${withdrawer.fullName}`,
      withdrawReason: historyImports.withdrawReason,
    })
    .from(historyImports)
    .innerJoin(users, eq(users.id, historyImports.importedBy))
    .leftJoin(withdrawer, eq(withdrawer.id, historyImports.withdrawnBy))
    .orderBy(desc(historyImports.importedAt));
}

export async function withdrawImport(importId: string, reason: string) {
  const session = await assertPermission("sales.import_history");
  const db = await getDb();

  const { before, after } = await db.transaction((tx) =>
    withdrawHistoryImport(tx as unknown as typeof db, {
      importId,
      actorId: session.user.id,
      reason,
    }),
  );

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "history.withdrawn",
    entityType: "history_imports",
    entityId: importId,
    before: { status: before.status },
    after: { status: after.status, reason: after.withdrawReason },
  });

  return after;
}
