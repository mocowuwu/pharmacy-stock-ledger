"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { revokeDevice } from "@/lib/dal/offline";

export async function revokeDeviceAction(formData: FormData) {
  await revokeDevice(String(formData.get("deviceId") ?? ""));
  revalidatePath("/users/devices");
  redirect("/users/devices?revoked=1");
}
