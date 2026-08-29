"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addBarcode,
  createItem,
  isCodeTaken,
  removeBarcode,
  setItemStatus,
  updateItem,
} from "@/lib/dal/catalogue";
import { PermissionError } from "@/lib/dal/session";
import { barcodeInput, itemInput } from "@/lib/catalogue/validation";

export type ItemFormState = {
  fieldErrors?: Record<string, string>;
  formError?: string;
};

function fieldErrorsFrom(issues: { path: PropertyKey[]; message: string }[]) {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}

export async function saveItem(
  _prev: ItemFormState,
  formData: FormData,
): Promise<ItemFormState> {
  const id = String(formData.get("id") ?? "");
  const intent = String(formData.get("intent") ?? "save");

  const raw = Object.fromEntries(formData.entries());
  // An unchecked checkbox is simply absent from FormData.
  raw.isTaxExempt = formData.get("isTaxExempt") === "on" ? "true" : "";

  const parsed = itemInput.safeParse(raw);
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  if (parsed.data.code && (await isCodeTaken(parsed.data.code, id || undefined))) {
    return { fieldErrors: { code: "code_taken" } };
  }

  let saved;
  try {
    saved = id
      ? await updateItem(id, parsed.data)
      : await createItem(parsed.data);
  } catch (error) {
    if (error instanceof PermissionError) return { formError: "not_allowed" };
    console.error(error);
    return { formError: "unknown" };
  }

  revalidatePath("/items");

  if (intent === "save_and_new") {
    // Carry the fields that stay the same across a run of data entry, so
    // typing in a shelf of antibiotics does not mean re-picking the category
    // and class every time.
    const params = new URLSearchParams({
      added: saved.genericName,
      category: saved.categoryId ?? "",
      form: saved.form,
      drugClass: saved.drugClass,
      unit: saved.unit,
    });
    redirect(`/items/new?${params.toString()}`);
  }

  redirect(`/items/${saved.id}?saved=1`);
}

export async function changeItemStatus(formData: FormData) {
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as "active" | "archived";
  try {
    await setItemStatus(id, status);
  } catch (error) {
    if (error instanceof PermissionError) redirect(`/items/${id}?error=not_allowed`);
    throw error;
  }
  revalidatePath("/items");
  redirect(`/items/${id}?saved=1`);
}

export async function addItemBarcode(
  _prev: ItemFormState,
  formData: FormData,
): Promise<ItemFormState> {
  const itemId = String(formData.get("itemId"));
  const parsed = barcodeInput.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { fieldErrors: fieldErrorsFrom(parsed.error.issues) };
  }

  try {
    await addBarcode(itemId, {
      barcode: parsed.data.barcode,
      packSize: parsed.data.packSize,
      note: parsed.data.note,
    });
  } catch (error) {
    if (error instanceof PermissionError) return { formError: "not_allowed" };
    // A duplicate barcode is a unique-index violation, and the useful thing to
    // say is that it already belongs to something.
    return { fieldErrors: { barcode: "code_taken" } };
  }

  revalidatePath(`/items/${itemId}`);
  return {};
}

export async function deleteItemBarcode(formData: FormData) {
  const barcodeId = String(formData.get("barcodeId"));
  const itemId = String(formData.get("itemId"));
  await removeBarcode(barcodeId);
  revalidatePath(`/items/${itemId}`);
}
