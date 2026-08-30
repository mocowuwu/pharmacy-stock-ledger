"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  addTaxRate,
  SettingsError,
  updateSettings,
  verifyMailSettings,
} from "@/lib/dal/settings";
import { MaintenanceError, resetDemoData } from "@/lib/dal/maintenance";
import { PermissionError } from "@/lib/dal/session";

function codeFor(error: unknown): string {
  if (error instanceof PermissionError) return "not_allowed";
  if (error instanceof SettingsError) return error.code;
  console.error(error);
  return "unknown";
}

const number = (formData: FormData, key: string) =>
  Number(String(formData.get(key) ?? "").replace(/\D/gu, ""));

export async function saveSettings(formData: FormData) {
  try {
    await updateSettings({
      businessName: String(formData.get("businessName") ?? ""),
      businessTagline: String(formData.get("businessTagline") ?? "") || null,
      businessAddress: String(formData.get("businessAddress") ?? "") || null,
      businessPhone: String(formData.get("businessPhone") ?? "") || null,
      npwp: String(formData.get("npwp") ?? "") || null,
      licenceNumber: String(formData.get("licenceNumber") ?? "") || null,
      receiptLocale: formData.get("receiptLocale") === "en" ? "en" : "id",
      receiptFooter: String(formData.get("receiptFooter") ?? "") || null,
      timezone: String(formData.get("timezone") ?? "Asia/Jakarta"),
      taxEnabled: formData.get("taxEnabled") === "on",
      taxMode: formData.get("taxMode") === "inclusive" ? "inclusive" : "exclusive",
      expiringUrgentDays: number(formData, "expiringUrgentDays"),
      expiringNoticeDays: number(formData, "expiringNoticeDays"),
      deadStockNoSaleDays: number(formData, "deadStockNoSaleDays"),
      deadStockExpiryDays: number(formData, "deadStockExpiryDays"),
      allowReturnRestock: formData.get("allowReturnRestock") === "on",
      returnsEnabled: formData.get("returnsEnabled") === "on",
      barcodesEnabled: formData.get("barcodesEnabled") === "on",
      narkotikaEnabled: formData.get("narkotikaEnabled") === "on",
      suppliersEnabled: formData.get("suppliersEnabled") === "on",
      categoriesEnabled: formData.get("categoriesEnabled") === "on",
      countsEnabled: formData.get("countsEnabled") === "on",
      disposeEnabled: formData.get("disposeEnabled") === "on",
      digestEnabled: formData.get("digestEnabled") === "on",
      digestEmail: String(formData.get("digestEmail") ?? "") || null,
      digestHour: number(formData, "digestHour"),
      smtpHost: String(formData.get("smtpHost") ?? "") || null,
      smtpPort: number(formData, "smtpPort"),
      smtpUser: String(formData.get("smtpUser") ?? "") || null,
      // Blank leaves whatever is stored alone; the screen never had it to
      // begin with, so an empty field is the normal case.
      smtpPassword: String(formData.get("smtpPassword") ?? "") || null,
      smtpFrom: String(formData.get("smtpFrom") ?? "") || null,
      smtpSecure: formData.get("smtpSecure") === "on",
    });
  } catch (error) {
    redirect(`/settings?error=${codeFor(error)}`);
  }

  // Settings decide what every screen shows -- which nav entries appear,
  // whether tax fields exist, how alerts are worded -- so the whole app is
  // revalidated rather than this page alone.
  revalidatePath("/", "layout");
  redirect("/settings?saved=1");
}

export async function createTaxRate(formData: FormData) {
  // Typed as a percentage because that is how a rate is discussed; stored as
  // basis points so no float ever touches a tax figure.
  const percent = Number(String(formData.get("percent") ?? "").replace(",", "."));

  try {
    await addTaxRate({
      name: String(formData.get("name") ?? ""),
      rateBps: Number.isFinite(percent) ? Math.round(percent * 100) : NaN,
      effectiveFrom: String(formData.get("effectiveFrom") ?? ""),
    });
  } catch (error) {
    redirect(`/settings?error=${codeFor(error)}`);
  }

  revalidatePath("/settings");
  redirect("/settings?rateAdded=1");
}


/**
 * Opens a connection to the mail server and authenticates, without sending.
 *
 * A wrong password should be found when it is typed, not at seven the next
 * morning when nobody is watching.
 */
export async function testMailSettings() {
  const result = await verifyMailSettings();
  redirect(
    result.ok
      ? "/settings?mail=ok"
      : `/settings?mail=failed&detail=${encodeURIComponent(result.error.slice(0, 120))}`,
  );
}

/** Clears the demo catalogue and its history. Owner only, typed confirmation. */
export async function wipeDemoData(formData: FormData) {
  const confirmation = String(formData.get("confirmation") ?? "");

  try {
    await resetDemoData(confirmation);
  } catch (error) {
    const code =
      error instanceof MaintenanceError
        ? error.code
        : error instanceof PermissionError
          ? "not_allowed"
          : "unknown";
    if (code === "unknown") console.error(error);
    redirect(`/settings?error=${code}`);
  }

  revalidatePath("/", "layout");
  redirect("/settings?wiped=1");
}
