import "server-only";

import { cache } from "react";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { settings } from "@/db/schema";
import { requireSession } from "./session";

/**
 * The single settings row.
 *
 * Readable by anyone signed in -- these are the shop's own operating
 * parameters, and screens need them to render correctly (whether tax fields
 * appear, whether a return may be restocked). Changing them needs
 * `settings.manage`, which is a separate screen. `cache` keeps a page that
 * asks twice to one query.
 */
export const getSettings = cache(async () => {
  await requireSession();
  const db = await getDb();
  const [row] = await db.select().from(settings).where(eq(settings.id, 1));

  // The migration seeds this row, but a screen should not crash if it is
  // missing -- the defaults here match the column defaults.
  return (
    row ?? {
      id: 1,
      businessName: "",
      businessAddress: null,
      businessPhone: null,
      npwp: null,
      licenceNumber: null,
      currencyCode: "IDR",
      currencyDecimals: 0,
      receiptLocale: "id" as const,
      receiptFooter: null,
      timezone: "Asia/Jakarta",
      taxEnabled: false,
      taxMode: "exclusive" as const,
      expiringUrgentDays: 30,
      expiringNoticeDays: 90,
      deadStockNoSaleDays: 90,
      deadStockExpiryDays: 180,
      allowReturnRestock: false,
      digestEnabled: false,
      digestEmail: null,
      updatedBy: null,
      updatedAt: new Date(),
    }
  );
});
