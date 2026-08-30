"use server";

import { markTutorialSeen } from "@/lib/dal/tutorial";

export async function markTutorialSeenAction() {
  await markTutorialSeen();
}
