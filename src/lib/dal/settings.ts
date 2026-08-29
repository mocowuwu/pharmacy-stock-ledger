import "server-only";

import { cache } from "react";
import { and, desc, eq, gte, isNull, lt, lte, or } from "drizzle-orm";
import { getDb } from "@/db";
import { settings, taxRates } from "@/db/schema";
import { assertPermission, requireSession } from "./session";
import { recordAudit } from "@/lib/audit";
import { addDays, today } from "@/lib/format/date";
import { refusalToSaveSettings } from "@/lib/accounts/rules";
import { isKnownTimezone } from "@/lib/format/timezones";
import { verifyMail } from "@/lib/digest/send";

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
      businessTagline: null,
      digestEnabled: false,
      digestEmail: null,
      digestHour: 7,
      smtpHost: null,
      smtpPort: 587,
      smtpUser: null,
      smtpPassword: null,
      smtpFrom: null,
      smtpSecure: false,
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
  businessTagline: string | null;
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
  digestHour: number;
  smtpHost: string | null;
  smtpPort: number;
  smtpUser: string | null;
  /**
   * Blank means "leave the stored one alone". The screen never receives the
   * current password, so an empty field is the normal case on every save that
   * is not deliberately changing it.
   */
  smtpPassword: string | null;
  smtpFrom: string | null;
  smtpSecure: boolean;
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

  if (!Number.isInteger(input.digestHour) || input.digestHour < 0 || input.digestHour > 23) {
    throw new SettingsError("invalid_hour");
  }
  if (!Number.isInteger(input.smtpPort) || input.smtpPort < 1 || input.smtpPort > 65_535) {
    throw new SettingsError("invalid_port");
  }
  if (!isKnownTimezone(input.timezone)) throw new SettingsError("invalid_timezone");

  const before = await getSettings();

  await db
    .update(settings)
    .set({
      businessName: input.businessName.trim(),
      businessTagline: input.businessTagline?.trim() || null,
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
      digestHour: input.digestHour,
      smtpHost: input.smtpHost?.trim() || null,
      smtpPort: input.smtpPort,
      smtpUser: input.smtpUser?.trim() || null,
      // Only overwritten when something was actually typed.
      ...(input.smtpPassword?.trim()
        ? { smtpPassword: input.smtpPassword.trim() }
        : {}),
      smtpFrom: input.smtpFrom?.trim() || null,
      smtpSecure: input.smtpSecure,
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
    // The password is stripped from both sides: an audit log that records a
    // secret is a second place the secret lives.
    before: { ...before, updatedAt: undefined, smtpPassword: undefined },
    after: { ...input, smtpPassword: undefined },
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


/**
 * The mail configuration, with the password replaced by whether there is one.
 *
 * The settings screen needs to show that a password is stored without ever
 * receiving it: a secret that reaches the browser is a secret in the page
 * source, in the back/forward cache and in any screen recording.
 */
export async function mailSettings() {
  await assertPermission("settings.manage");
  const config = await getSettings();
  return {
    host: config.smtpHost,
    port: config.smtpPort,
    user: config.smtpUser,
    from: config.smtpFrom,
    secure: config.smtpSecure,
    hasPassword: Boolean(config.smtpPassword),
  };
}

/** Runs the connection check against the stored configuration. */
export async function verifyMailSettings() {
  await assertPermission("settings.manage");
  const config = await getSettings();
  return verifyMail({
    host: config.smtpHost,
    port: config.smtpPort,
    user: config.smtpUser,
    password: config.smtpPassword,
    from: config.smtpFrom,
    secure: config.smtpSecure,
  });
}

/**
 * The name and description, without requiring a session.
 *
 * The sign-in screen shows them, and nobody is signed in there. That is not a
 * leak: a pharmacy's name is on the shopfront. Nothing else from the settings
 * row is exposed this way.
 */
export const publicBranding = cache(async () => {
  const db = await getDb();
  const [row] = await db
    .select({
      businessName: settings.businessName,
      businessTagline: settings.businessTagline,
    })
    .from(settings)
    .where(eq(settings.id, 1));

  return {
    businessName: row?.businessName?.trim() || null,
    businessTagline: row?.businessTagline?.trim() || null,
  };
});
