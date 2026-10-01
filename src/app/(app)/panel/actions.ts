"use server";

import { createPanelEntry, listPanelEntries, panelSummary, nextPanelNumber } from "@/lib/dal/panel";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type PanelFormState = { error?: string; success?: boolean };

export async function createPanelEntryAction(
  _prev: PanelFormState,
  formData: FormData
): Promise<PanelFormState> {
  const entryDate = formData.get("entryDate") as string;
  const itemCode = formData.get("itemCode") as string;
  const itemName = formData.get("itemName") as string;
  const unit = formData.get("unit") as string;
  const qty = Number(formData.get("qty"));
  const unitCost = Number(formData.get("unitCost")) || 0;
  const unitPrice = Number(formData.get("unitPrice")) || 0;
  const partnerName = (formData.get("partnerName") as string) || null;
  const destination = (formData.get("destination") as string) || null;
  const notes = (formData.get("notes") as string) || null;
  const pharmacistId = (formData.get("pharmacistId") as string) || null;

  if (!entryDate || !itemCode || !itemName || !unit || !qty || qty <= 0) {
    return { error: "Semua field wajib diisi. Jumlah harus lebih dari 0." };
  }

  try {
    await createPanelEntry({
      entryDate,
      itemCode,
      itemName,
      unit,
      qty,
      unitCost,
      unitPrice,
      partnerName,
      destination,
      notes,
      pharmacistId,
    });
    revalidatePath("/panel");
    return { success: true };
  } catch (err) {
    return { error: "Gagal menyimpan entri panel." };
  }
}

export async function listPanelEntriesAction(filters?: {
  from?: string;
  to?: string;
  itemCode?: string;
}) {
  const from = filters?.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const to = filters?.to || new Date().toISOString().split("T")[0];
  const itemCode = filters?.itemCode;

  const entries = await listPanelEntries({ from, to, itemCode });
  const summary = await panelSummary(from, to);

  return { entries, summary, from, to, itemCode };
}