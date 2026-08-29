"use server";

import { revalidatePath } from "next/cache";
import { attachBarcode, lookupScan, receiveDelivery } from "@/lib/dal/stock";
import { PermissionError } from "@/lib/dal/session";
import { LedgerError } from "@/lib/stock/ledger";
import { receiveLineInput } from "@/lib/stock/validation";

export type ReceiveState = {
  fieldErrors?: Record<string, string>;
  formError?: string;
  saved?: { qty: number; unit: string; name: string };
};

export async function submitReceipt(
  _prev: ReceiveState,
  formData: FormData,
): Promise<ReceiveState> {
  const raw = Object.fromEntries(formData.entries()) as Record<string, string>;
  raw.isOpening = formData.get("isOpening") === "on" ? "true" : "";
  raw.isLegacy = formData.get("isLegacy") === "on" ? "true" : "";

  const parsed = receiveLineInput.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors };
  }

  try {
    await receiveDelivery({
      itemId: parsed.data.itemId,
      supplierId: parsed.data.supplierId,
      lotNumber: parsed.data.lotNumber,
      expiryDate: parsed.data.expiryDate,
      receivedDate: parsed.data.receivedDate,
      qty: parsed.data.qty,
      unitCost: parsed.data.unitCost,
      isOpening: parsed.data.isOpening,
      isLegacy: parsed.data.isLegacy,
      notes: parsed.data.notes,
    });

    // A code that was scanned but not on file gets attached now, which is how
    // the barcode table fills up over the first weeks of use.
    const pending = String(formData.get("pendingBarcode") ?? "").trim();
    if (pending) {
      await attachBarcode(parsed.data.itemId, pending, null).catch(() => {});
    }
  } catch (error) {
    if (error instanceof PermissionError) return { formError: "not_allowed" };
    if (error instanceof LedgerError) return { formError: error.code };
    console.error(error);
    return { formError: "unknown" };
  }

  revalidatePath("/receive");
  revalidatePath("/items");

  return {
    saved: {
      qty: parsed.data.qty,
      unit: String(formData.get("unitLabel") ?? ""),
      name: String(formData.get("itemLabel") ?? ""),
    },
  };
}

export type ScanState = {
  status: "idle" | "found" | "unknown" | "unreadable";
  itemId?: string;
  itemLabel?: string;
  lotNumber?: string | null;
  expiryDate?: string | null;
  packSize?: number | null;
  barcode?: string;
};

/** Called when the scanner submits a code, so the form can fill itself in. */
export async function resolveScan(raw: string): Promise<ScanState> {
  if (!raw.trim()) return { status: "idle" };

  const { scan, item, packSize } = await lookupScan(raw);

  if (scan.kind === "unreadable") return { status: "unreadable" };

  const lotNumber = scan.kind === "gs1" ? scan.lotNumber : null;
  const expiryDate = scan.kind === "gs1" ? scan.expiryDate : null;
  const barcode = scan.kind === "gs1" ? (scan.gtin ?? "") : scan.code;

  if (!item) {
    return { status: "unknown", lotNumber, expiryDate, barcode };
  }

  return {
    status: "found",
    itemId: item.id,
    itemLabel: `${item.genericName}${item.strength ? ` ${item.strength}` : ""}`,
    lotNumber,
    expiryDate,
    packSize,
    barcode,
  };
}
