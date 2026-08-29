"use server";

import { revalidatePath } from "next/cache";
import { createCategory } from "@/lib/dal/catalogue";
import { PermissionError } from "@/lib/dal/session";
import { categoryInput } from "@/lib/catalogue/validation";

export type CategoryFormState = { error?: string; saved?: boolean };

export async function addCategory(
  _prev: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const parsed = categoryInput.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) return { error: "required" };

  try {
    await createCategory(parsed.data.name);
  } catch (error) {
    if (error instanceof PermissionError) return { error: "not_allowed" };
    return { error: "code_taken" };
  }

  revalidatePath("/categories");
  return { saved: true };
}
