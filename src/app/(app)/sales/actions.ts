"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { voidSale } from "@/lib/dal/sales";
import { PermissionError } from "@/lib/dal/session";
import { SaleError } from "@/lib/stock/sale";

export async function voidSaleAction(formData: FormData) {
  const saleId = String(formData.get("saleId"));
  const reason = String(formData.get("reason") ?? "");

  try {
    await voidSale(saleId, reason);
  } catch (error) {
    const code =
      error instanceof PermissionError
        ? "not_allowed"
        : error instanceof SaleError
          ? error.code
          : "unknown";
    redirect(`/sales/${saleId}?error=${code}`);
  }

  revalidatePath("/sales");
  revalidatePath("/items");
  redirect(`/sales/${saleId}?voided=1`);
}
