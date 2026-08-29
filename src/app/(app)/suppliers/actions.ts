"use server";

import { revalidatePath } from "next/cache";
import { createSupplier, updateSupplier } from "@/lib/dal/catalogue";
import { PermissionError } from "@/lib/dal/session";
import { supplierInput } from "@/lib/catalogue/validation";

export type SupplierFormState = {
  fieldErrors?: Record<string, string>;
  formError?: string;
  saved?: boolean;
};

export async function saveSupplier(
  _prev: SupplierFormState,
  formData: FormData,
): Promise<SupplierFormState> {
  const id = String(formData.get("id") ?? "");
  const parsed = supplierInput.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      fieldErrors[key] ??= issue.message;
    }
    return { fieldErrors };
  }

  try {
    if (id) await updateSupplier(id, parsed.data);
    else await createSupplier(parsed.data);
  } catch (error) {
    if (error instanceof PermissionError) return { formError: "not_allowed" };
    console.error(error);
    return { formError: "unknown" };
  }

  revalidatePath("/suppliers");
  return { saved: true };
}
