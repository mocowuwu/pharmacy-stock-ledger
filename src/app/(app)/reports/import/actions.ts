"use server";

import { revalidatePath } from "next/cache";
import {
  commitHistoryImport,
  HistoryImportError,
  previewHistoryImport,
  withdrawImport,
} from "@/lib/dal/history";
import { PermissionError } from "@/lib/dal/session";
import {
  historyFileToCsv,
  type HistoryRowError,
  type HistorySummary,
  type ValidatedHistoryRow,
} from "@/lib/history/import";

/** How many refused rows the preview lists. The count above it is always the full one. */
const ERRORS_SHOWN = 200;
/** How many accepted rows the preview shows as a sample of what will be written. */
const SAMPLE_SHOWN = 8;

export type HistoryImportState = {
  stage: "idle" | "previewed" | "done";
  csvText?: string;
  fileName?: string;
  totalRows?: number;
  errors?: HistoryRowError[];
  errorCount?: number;
  sample?: ValidatedHistoryRow[];
  summary?: HistorySummary;
  duplicateOf?: { importNumber: string; importedAt: string } | null;
  overlap?: { tillDays: string[]; importedDays: string[] };
  done?: { importNumber: string; lines: number; total: number; firstDay: string; lastDay: string };
  formError?: string;
};

function codeFor(error: unknown): string {
  if (error instanceof PermissionError) return "not_allowed";
  if (error instanceof HistoryImportError) return error.code;
  console.error(error);
  return "unknown";
}

export async function historyImportAction(
  _prev: HistoryImportState,
  formData: FormData,
): Promise<HistoryImportState> {
  const intent = String(formData.get("intent") ?? "preview");

  if (intent === "commit") {
    const csvText = String(formData.get("csvText") ?? "");
    const fileName = String(formData.get("fileName") ?? "") || null;
    if (!csvText) return { stage: "idle", formError: "empty_file" };

    try {
      const result = await commitHistoryImport(csvText, fileName);
      revalidatePath("/reports", "layout");
      return {
        stage: "done",
        done: {
          importNumber: result.importNumber,
          lines: result.summary.lines,
          total: result.summary.total,
          firstDay: result.summary.firstDay ?? "",
          lastDay: result.summary.lastDay ?? "",
        },
      };
    } catch (error) {
      return { stage: "idle", formError: codeFor(error) };
    }
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { stage: "idle", formError: "no_file" };
  }
  const read = historyFileToCsv(new Uint8Array(await file.arrayBuffer()));
  if ("error" in read) return { stage: "idle", formError: read.error };

  try {
    const preview = await previewHistoryImport(read.csv);
    return {
      stage: "previewed",
      csvText: read.csv,
      fileName: file.name,
      totalRows: preview.totalRows,
      errors: preview.errors.slice(0, ERRORS_SHOWN),
      errorCount: preview.errors.length,
      sample: preview.validRows.slice(0, SAMPLE_SHOWN),
      summary: preview.summary,
      duplicateOf: preview.duplicateOf
        ? {
            importNumber: preview.duplicateOf.importNumber,
            importedAt: preview.duplicateOf.importedAt.toISOString(),
          }
        : null,
      overlap: preview.overlap,
    };
  } catch (error) {
    return { stage: "idle", formError: codeFor(error) };
  }
}

export type WithdrawState = { error?: string; ok?: boolean };

export async function withdrawImportAction(
  _prev: WithdrawState,
  formData: FormData,
): Promise<WithdrawState> {
  const importId = String(formData.get("importId") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (!reason.trim()) return { error: "reason_required" };

  try {
    await withdrawImport(importId, reason);
    revalidatePath("/reports", "layout");
    return { ok: true };
  } catch (error) {
    return { error: codeFor(error) };
  }
}
