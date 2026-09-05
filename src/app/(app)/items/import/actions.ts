"use server";

import { revalidatePath } from "next/cache";
import { commitImport, ImportError, previewImport } from "@/lib/dal/import";
import { PermissionError } from "@/lib/dal/session";
import type { RowError } from "@/lib/catalogue/import";

export type ImportState = {
  stage: "idle" | "previewed" | "done";
  csvText?: string;
  validCount?: number;
  totalRows?: number;
  errors?: RowError[];
  summary?: { itemsCreated: number; batchesCreated: number };
  formError?: string;
};

function codeFor(error: unknown): string {
  if (error instanceof PermissionError) return "not_allowed";
  if (error instanceof ImportError) return error.code;
  console.error(error);
  return "unknown";
}

export async function importAction(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const intent = String(formData.get("intent") ?? "preview");

  if (intent === "commit") {
    const csvText = String(formData.get("csvText") ?? "");
    if (!csvText) return { stage: "idle", formError: "empty_file" };

    try {
      const summary = await commitImport(csvText);
      revalidatePath("/items");
      return { stage: "done", summary };
    } catch (error) {
      return { stage: "idle", formError: codeFor(error) };
    }
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { stage: "idle", formError: "no_file" };
  }
  const csvText = await file.text();

  try {
    const preview = await previewImport(csvText);
    return {
      stage: "previewed",
      csvText,
      validCount: preview.validRows.length,
      totalRows: preview.totalRows,
      errors: preview.errors,
    };
  } catch (error) {
    return { stage: "idle", formError: codeFor(error) };
  }
}
