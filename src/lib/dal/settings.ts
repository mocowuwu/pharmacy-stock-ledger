import "server-only";

import { cache } from "react";
import { and, desc, eq, gte, isNull, lt, lte, or } from "drizzle-orm";
import { getDb } from "@/db";
import { settings, taxRates } from "@/db/schema";
import { assertPermission, requireSession } from "./session";
import { recordAudit } from "@/lib/audit";
import { addDays, today } from "@/lib/format/date";
import { refusalToSaveSettings } from "@/lib/accounts/rules";

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
      returnsEnabled: true,
      barcodesEnabled: true,
      narkotikaEnabled: false,
      digestEnabled: false,
      digestEmail: null,
      updatedBy: null,
      updatedAt: new Date(),
    }
  );
});

/* ----------------------------------------------------------------- writing */

export class SettingsError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SettingsError";
  }
}

export type SettingsInput = {
  businessName: string;
  businessAddress: string | null;
  businessPhone: string | null;
  npwp: string | null;
  licenceNumber: string | null;
  receiptLocale: "id" | "en";
  receiptFooter: string | null;
  timezone: string;
  taxEnabled: boolean;
  taxMode: "inclusive" | "exclusive";
  expiringUrgentDays: number;
  expiringNoticeDays: number;
  deadStockNoSaleDays: number;
  deadStockExpiryDays: number;
  allowReturnRestock: boolean;
  returnsEnabled: boolean;
  barcodesEnabled: boolean;
  narkotikaEnabled: boolean;
  digestEnabled: boolean;
  digestEmail: string | null;
};

/**
 * Writes the settings row.
 *
 * The thresholds are checked against each other rather than only for sanity:
 * an "expiring soon" window wider than the "expiring notice" window would make
 * the urgent alert fire after the gentle one, which reads as the system being
 * broken rather than as a misconfiguration.
 */
export async function updateSettings(input: SettingsInput) {
  const session = await assertPermission("settings.manage");
  const db = await getDb();

  const refusal = refusalToSaveSettings(input);
  if (refusal) throw new SettingsError(refusal);

  const before = await getSettings();

  await db
    .update(settings)
    .set({
      businessName: input.businessName.trim(),
      businessAddress: input.businessAddress?.trim() || null,
      businessPhone: input.businessPhone?.trim() || null,
      npwp: input.npwp?.trim() || null,
      licenceNumber: input.licenceNumber?.trim() || null,
      receiptLocale: input.receiptLocale,
      receiptFooter: input.receiptFooter?.trim() || null,
      timezone: input.timezone,
      taxEnabled: input.taxEnabled,
      taxMode: input.taxMode,
      expiringUrgentDays: input.expiringUrgentDays,
      expiringNoticeDays: input.expiringNoticeDays,
      deadStockNoSaleDays: input.deadStockNoSaleDays,
      deadStockExpiryDays: input.deadStockExpiryDays,
      allowReturnRestock: input.allowReturnRestock,
      returnsEnabled: input.returnsEnabled,
      barcodesEnabled: input.barcodesEnabled,
      narkotikaEnabled: input.narkotikaEnabled,
      digestEnabled: input.digestEnabled,
      digestEmail: input.digestEmail?.trim() || null,
      updatedBy: session.user.id,
      updatedAt: new Date(),
    })
    .where(eq(settings.id, 1));

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "settings.updated",
    entityType: "settings",
    entityId: null,
    before: { ...before, updatedAt: undefined },
    after: { ...input },
  });

  return { ok: true };
}

/* --------------------------------------------------------------- tax rates */

export async function listTaxRates() {
  await assertPermission("settings.manage");
  const db = await getDb();
  return db.select().from(taxRates).orderBy(desc(taxRates.effectiveFrom));
}

/**
 * The rate in force on a given day, which is what a sale snapshots.
 *
 * Exposed so the settings screen can warn when tax is switched on with no rate
 * covering today: sales would then be booked with no PPN at all and nothing
 * would look wrong until an accountant asked.
 */
export async function effectiveTaxRate(on: string = today()) {
  await assertPermission("settings.manage");
  const db = await getDb();

  const [rate] = await db
    .select()
    .from(taxRates)
    .where(
      and(
        lte(taxRates.effectiveFrom, on),
        or(isNull(taxRates.effectiveTo), gte(taxRates.effectiveTo, on)),
      ),
    )
    .orderBy(desc(taxRates.effectiveFrom))
    .limit(1);

  return rate ?? null;
}

/**
 * Adds a rate from a date.
 *
 * The previous open-ended rate is closed the day before, rather than edited:
 * a receipt reprinted from last year must still show the rate that applied on
 * the day it was rung up, and that is only possible if old rows survive.
 */
export async function addTaxRate(input: {
  name: string;
  rateBps: number;
  effectiveFrom: string;
}) {
  const session = await assertPermission("settings.manage");
  const db = await getDb();

  if (!input.name.trim()) throw new SettingsError("name_required");
  if (!Number.isInteger(input.rateBps) || input.rateBps < 0 || input.rateBps > 10_000) {
    throw new SettingsError("invalid_rate");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.effectiveFrom)) {
    throw new SettingsError("invalid_date");
  }

  const created = await db.transaction(async (tx) => {
    await tx
      .update(taxRates)
      .set({ effectiveTo: addDays(input.effectiveFrom, -1) })
      .where(
        and(
          isNull(taxRates.effectiveTo),
          lt(taxRates.effectiveFrom, input.effectiveFrom),
        ),
      );

    const [rate] = await tx
      .insert(taxRates)
      .values({
        name: input.name.trim(),
        rateBps: input.rateBps,
        effectiveFrom: input.effectiveFrom,
        createdBy: session.user.id,
      })
      .returning();
    return rate;
  });

  await recordAudit({
    userId: session.user.id,
    actorLabel: session.user.username,
    action: "settings.tax_rate_added",
    entityType: "tax_rates",
    entityId: created.id,
    after: { ...input },
  });

  return created;
}
