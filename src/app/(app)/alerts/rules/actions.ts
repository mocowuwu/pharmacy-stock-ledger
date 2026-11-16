"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { updateAlertConfig } from "@/lib/dal/alerts";
import { AlertConfigError } from "@/lib/alerts/config";
import { CONFIGURABLE_ALERTS } from "@/lib/alerts/rules";
import { PermissionError } from "@/lib/dal/session";

/** Digits only: "30 hari" and "30" are both thirty, and a blank is 0. */
const whole = (formData: FormData, key: string) => {
  const digits = String(formData.get(key) ?? "").replace(/\D/gu, "");
  return digits === "" ? 0 : Number(digits);
};

/**
 * Saves what the pharmacy counts as an alert.
 *
 * `updateAlertConfig` checks `alerts.configure` whatever the screen showed, and
 * validates the whole set together -- a window cannot be saved on its own in a
 * way that contradicts another.
 */
export async function saveAlertRules(formData: FormData) {
  const rules = Object.fromEntries(
    CONFIGURABLE_ALERTS.map((type) => [
      type,
      {
        enabled: formData.get(`enabled_${type}`) === "on",
        severity: String(formData.get(`severity_${type}`) ?? ""),
      },
    ]),
  );

  let total = 0;
  try {
    const result = await updateAlertConfig({
      thresholds: {
        expiringUrgentDays: whole(formData, "expiringUrgentDays"),
        expiringNoticeDays: whole(formData, "expiringNoticeDays"),
        deadStockNoSaleDays: whole(formData, "deadStockNoSaleDays"),
        deadStockExpiryDays: whole(formData, "deadStockExpiryDays"),
        lowStockDefaultPoint: whole(formData, "lowStockDefaultPoint"),
        lowStockCoverDays: whole(formData, "lowStockCoverDays"),
      },
      rules,
    });
    total = result.total;
  } catch (error) {
    const code =
      error instanceof AlertConfigError
        ? error.code
        : error instanceof PermissionError
          ? "not_allowed"
          : "unknown";
    if (code === "unknown") console.error(error);
    redirect(`/alerts/rules?error=${code}`);
  }

  // The list, the dashboard tiles and the sidebar badge all read the result.
  revalidatePath("/", "layout");
  redirect(`/alerts/rules?saved=${total}`);
}
