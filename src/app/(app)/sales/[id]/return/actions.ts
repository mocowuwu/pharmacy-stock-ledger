"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createReturn } from "@/lib/dal/sales";
import { PermissionError } from "@/lib/dal/session";
import { SaleError } from "@/lib/stock/sale";
import { LedgerError } from "@/lib/stock/ledger";
import { PAYMENT_METHODS } from "@/lib/catalogue/enums";

export type ReturnState = {
  formError?: string;
  detail?: Record<string, unknown>;
};

type RefundMethod = (typeof PAYMENT_METHODS)[number];

/**
 * One return, submitted whole.
 *
 * Unlike receiving -- where each line is durable as it is typed -- a return is
 * a single decision about one sale, and a half-recorded refund would be worse
 * than none. The transaction underneath refuses the lot or takes it all.
 */
export async function submitReturn(
  _prev: ReturnState,
  formData: FormData,
): Promise<ReturnState> {
  const saleId = String(formData.get("saleId") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const method = String(formData.get("refundMethod") ?? "");

  const refundMethod = (PAYMENT_METHODS as readonly string[]).includes(method)
    ? (method as RefundMethod)
    : "tunai";

  const lines = formData
    .getAll("line")
    .map((raw) => {
      const [saleLineId, qtyText] = String(raw).split(":");
      return { saleLineId, qty: Number(qtyText) };
    })
    .filter((line) => Number.isInteger(line.qty) && line.qty > 0);

  if (lines.length === 0) return { formError: "empty_return" };
  if (!reason) return { formError: "reason_required" };

  let result;
  try {
    result = await createReturn({ saleId, lines, refundMethod, reason, notes });
  } catch (error) {
    if (error instanceof PermissionError) return { formError: "not_allowed" };
    if (error instanceof SaleError) {
      return { formError: error.code, detail: error.detail };
    }
    if (error instanceof LedgerError) return { formError: error.code };
    console.error(error);
    return { formError: "unknown" };
  }

  revalidatePath(`/sales/${saleId}`);
  revalidatePath("/returns");
  revalidatePath("/items");

  // Back to the sale, not to this form. Once the last unit has come back the
  // form has nothing left to offer, and a confirmation stranded on a screen
  // that now says "nothing to return" is worse than no confirmation at all.
  const query = new URLSearchParams({
    returned: result.returnNumber,
    refund: String(result.refundTotal),
  });
  redirect(`/sales/${saleId}?${query.toString()}`);
}
