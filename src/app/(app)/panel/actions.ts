"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createPanelEntry, decidePanelEntry, PanelError, voidPanelEntry } from "@/lib/dal/panel";
import { AuthenticationError, PermissionError } from "@/lib/dal/session";
import { isReportDay } from "@/lib/reports/catalogue";

/**
 * What the entry form hands back. `error` is a code that renders through
 * `errors.<code>`; `saved` is the number the entry was given, and `pending` says
 * it is waiting for approval rather than counting. Never a sentence:
 * the words belong to the catalogues, in the reader's language.
 */
export type PanelFormState = { error?: string; saved?: string; pending?: boolean };

function codeFor(error: unknown): string {
  if (error instanceof PermissionError || error instanceof AuthenticationError) return "not_allowed";
  if (error instanceof PanelError) return error.code;
  console.error(error);
  return "unknown";
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function createPanelEntryAction(
  _previous: PanelFormState,
  formData: FormData,
): Promise<PanelFormState> {
  try {
    const entry = await createPanelEntry({
      entryDate: field(formData, "entryDate"),
      orderRef: field(formData, "orderRef"),
      itemCode: field(formData, "itemCode"),
      itemName: field(formData, "itemName"),
      unit: field(formData, "unit"),
      qty: field(formData, "qty"),
      unitCost: field(formData, "unitCost"),
      unitPrice: field(formData, "unitPrice"),
      partnerName: field(formData, "partnerName"),
      destination: field(formData, "destination"),
      notes: field(formData, "notes"),
      pharmacistId: field(formData, "pharmacistId"),
      taxed: field(formData, "taxed"),
    });
    revalidatePath("/panel");
    revalidatePath("/");
    return { saved: entry.entryNumber, pending: entry.status === "pending" };
  } catch (error) {
    return { error: codeFor(error) };
  }
}

/** Voids an entry and returns to the same window, so the list does not jump. */
export async function voidPanelEntryAction(formData: FormData) {
  const from = field(formData, "from");
  const to = field(formData, "to");
  const back = new URLSearchParams();
  if (isReportDay(from) && isReportDay(to)) {
    back.set("from", from);
    back.set("to", to);
  }

  try {
    const voided = await voidPanelEntry(field(formData, "entryId"), field(formData, "reason"));
    back.set("voided", voided.entryNumber);
  } catch (error) {
    back.set("error", codeFor(error));
  }

  revalidatePath("/panel");
  redirect(`/panel?${back.toString()}`);
}

/**
 * Approves or rejects a waiting entry and returns to where the person was, so
 * working down a list of pending orders does not lose the list.
 */
export async function decidePanelEntryAction(formData: FormData) {
  const decision = field(formData, "decision") === "reject" ? "reject" : "approve";
  const back = new URLSearchParams();
  if (field(formData, "status") === "pending") back.set("status", "pending");
  const from = field(formData, "from");
  const to = field(formData, "to");
  if (isReportDay(from) && isReportDay(to)) {
    back.set("from", from);
    back.set("to", to);
  }

  try {
    const decided = await decidePanelEntry(
      field(formData, "entryId"),
      decision,
      field(formData, "note"),
    );
    back.set(decision === "approve" ? "approved" : "rejected", decided.entryNumber);
  } catch (error) {
    back.set("error", codeFor(error));
  }

  // The totals, the reports and the dashboard all just changed.
  revalidatePath("/panel");
  revalidatePath("/");
  redirect(`/panel?${back.toString()}`);
}
