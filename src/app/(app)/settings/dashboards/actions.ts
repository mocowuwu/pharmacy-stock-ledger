"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { setDashboard } from "@/lib/dal/dashboard";
import { DashboardError } from "@/lib/dashboard/layouts";
import { AuthenticationError } from "@/lib/dal/session";

/**
 * Saves one account's dashboard, or returns it to the default.
 *
 * Owner only -- `setDashboard` checks, whatever the screen showed. The widgets
 * arrive as repeated `widget` fields in the order the owner arranged them.
 */
export async function saveDashboard(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  const reset = formData.get("intent") === "reset";
  const widgets = formData.getAll("widget").map(String);

  try {
    await setDashboard(userId, reset ? null : widgets);
  } catch (error) {
    const code =
      error instanceof DashboardError
        ? error.code
        : error instanceof AuthenticationError
          ? "not_allowed"
          : "unknown";
    if (code === "unknown") console.error(error);
    redirect(`/settings/dashboards?user=${encodeURIComponent(userId)}&error=${code}`);
  }

  // The account's own Beranda changes the next time it loads.
  revalidatePath("/", "layout");
  redirect(`/settings/dashboards?user=${encodeURIComponent(userId)}&saved=${reset ? "reset" : "1"}`);
}
