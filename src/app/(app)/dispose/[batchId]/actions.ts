"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createDisposal } from "@/lib/dal/disposal";
import { PermissionError } from "@/lib/dal/session";
import { LedgerError } from "@/lib/stock/ledger";

/**
 * Writes one batch off.
 *
 * A redirect rather than a returned state, because a disposal is final: the
 * operator should land somewhere that shows the shelf as it now is, not on the
 * form they just submitted with a tick beside it.
 */
export async function submitDisposal(formData: FormData) {
  const batchId = String(formData.get("batchId") ?? "");
  const qty = Number(String(formData.get("qty") ?? "").replace(/\D/gu, ""));
  const reason = String(formData.get("reason") ?? "").trim();
  const method = String(formData.get("method") ?? "").trim() || null;
  const witnessedBy = String(formData.get("witnessedBy") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const label = String(formData.get("itemLabel") ?? "");
  const unit = String(formData.get("unitLabel") ?? "");

  let result;
  try {
    result = await createDisposal({
      batchId,
      qty,
      reason,
      method,
      witnessedBy,
      notes,
    });
  } catch (error) {
    const code =
      error instanceof PermissionError
        ? "not_allowed"
        : error instanceof LedgerError
          ? error.code
          : "unknown";
    if (code === "unknown") console.error(error);
    redirect(`/dispose/${batchId}?error=${code}`);
  }

  revalidatePath("/dispose");
  revalidatePath("/items");
  revalidatePath("/alerts");

  const query = new URLSearchParams({
    done: result.disposalNumber,
    qty: String(qty),
    unit,
    item: label,
  });
  redirect(`/dispose?${query.toString()}`);
}
