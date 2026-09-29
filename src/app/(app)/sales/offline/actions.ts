"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  closeOfflineReviewAs,
  OfflineReviewError,
  retryOfflineReviewAs,
} from "@/lib/dal/offline";
import { PermissionError } from "@/lib/dal/session";

function errorCode(error: unknown): string {
  if (error instanceof PermissionError) return "not_allowed";
  if (error instanceof OfflineReviewError) return error.code;
  return "unknown";
}

export async function resolveOfflineReviewAction(formData: FormData) {
  const reviewId = String(formData.get("reviewId") ?? "");
  const note = String(formData.get("note") ?? "");
  const intent = String(formData.get("intent") ?? "");

  let posted: string | null = null;
  try {
    if (intent === "post") {
      posted = (await retryOfflineReviewAs(reviewId, note)).saleNumber;
    } else {
      await closeOfflineReviewAs(reviewId, note);
    }
  } catch (error) {
    redirect(`/sales/offline?error=${errorCode(error)}&review=${reviewId}`);
  }

  revalidatePath("/sales");
  revalidatePath("/sales/offline");
  redirect(posted ? `/sales/offline?posted=${encodeURIComponent(posted)}` : "/sales/offline?closed=1");
}
