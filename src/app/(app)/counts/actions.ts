"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  cancelStockCount,
  CountError,
  postStockCount,
  saveCountLine,
  startCount,
} from "@/lib/dal/counts";
import { PermissionError } from "@/lib/dal/session";
import { LedgerError } from "@/lib/stock/ledger";

function codeFor(error: unknown): string {
  if (error instanceof PermissionError) return "not_allowed";
  if (error instanceof CountError) return error.code;
  if (error instanceof LedgerError) return error.code;
  console.error(error);
  return "unknown";
}

export async function createCount(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const categoryId = String(formData.get("categoryId") ?? "") || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;

  let countId: string;
  try {
    const result = await startCount({ name, categoryId, notes });
    countId = result.countId;
  } catch (error) {
    redirect(`/counts/new?error=${codeFor(error)}`);
  }

  revalidatePath("/counts");
  redirect(`/counts/${countId}`);
}

/**
 * Saves the whole sheet in one submission.
 *
 * Receiving is deliberately line-at-a-time, because it happens box in hand over
 * an hour. A count is the opposite shape of work: the shelf is counted on paper
 * first, then the numbers are typed in one sitting. Saving them together also
 * means the variance list is right the moment it appears, rather than settling
 * one row at a time.
 */
export async function saveSheet(formData: FormData) {
  const countId = String(formData.get("countId") ?? "");

  const entries = formData.getAll("lineId").map((raw) => {
    const lineId = String(raw);
    const counted = String(formData.get(`qty:${lineId}`) ?? "").trim();
    const reason = String(formData.get(`reason:${lineId}`) ?? "").trim() || null;
    return {
      lineId,
      // Blank is "not counted yet", which is different from a counted zero.
      countedQty: counted === "" ? null : Number(counted.replace(/\D/gu, "")),
      reason,
    };
  });

  try {
    for (const entry of entries) {
      await saveCountLine(entry);
    }
  } catch (error) {
    redirect(`/counts/${countId}?error=${codeFor(error)}`);
  }

  revalidatePath(`/counts/${countId}`);
  redirect(`/counts/${countId}?saved=1`);
}

export async function postCountAction(formData: FormData) {
  const countId = String(formData.get("countId") ?? "");

  let adjusted = 0;
  try {
    const result = await postStockCount(countId);
    adjusted = result.adjusted;
  } catch (error) {
    redirect(`/counts/${countId}?error=${codeFor(error)}`);
  }

  revalidatePath("/counts");
  revalidatePath("/items");
  revalidatePath("/alerts");
  redirect(`/counts/${countId}?posted=${adjusted}`);
}

export async function cancelCountAction(formData: FormData) {
  const countId = String(formData.get("countId") ?? "");

  try {
    await cancelStockCount(countId);
  } catch (error) {
    redirect(`/counts/${countId}?error=${codeFor(error)}`);
  }

  revalidatePath("/counts");
  redirect(`/counts/${countId}?cancelled=1`);
}
