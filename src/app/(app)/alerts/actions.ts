"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { acknowledgeAlert, AlertError, refreshAlerts, snoozeAlert } from "@/lib/dal/alerts";
import { PermissionError } from "@/lib/dal/session";

export async function acknowledge(formData: FormData) {
  const id = String(formData.get("alertId"));
  try {
    await acknowledgeAlert(id, String(formData.get("note") ?? ""));
  } catch (error) {
    if (error instanceof PermissionError) redirect("/alerts?error=not_allowed");
    throw error;
  }
  revalidatePath("/alerts");
  revalidatePath("/");
}

export async function snooze(formData: FormData) {
  const id = String(formData.get("alertId"));
  const days = Number(formData.get("days") ?? 7);
  try {
    await snoozeAlert(id, days);
  } catch (error) {
    if (error instanceof PermissionError) redirect("/alerts?error=not_allowed");
    if (error instanceof AlertError) redirect(`/alerts?error=${error.code}`);
    throw error;
  }
  revalidatePath("/alerts");
  revalidatePath("/");
}

export async function refresh() {
  try {
    await refreshAlerts();
  } catch (error) {
    if (error instanceof PermissionError) redirect("/alerts?error=not_allowed");
    throw error;
  }
  revalidatePath("/alerts");
  revalidatePath("/");
  redirect("/alerts?refreshed=1");
}
