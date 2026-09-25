/**
 * Enum values as plain data, with no database imports.
 *
 * The schema builds its `pgEnum`s from these, so there is one source of truth,
 * and forms can render the options without pulling drizzle's pg-core into the
 * browser bundle.
 *
 * Values are stable keys. Their labels live in the message catalogues, so
 * renaming a label is a translation change and never a data migration.
 */

export const DRUG_CLASSES = [
  "bebas",
  "bebas_terbatas",
  "keras",
  "owa",
  "psikotropika",
  "narkotika",
  "jamu",
  "oht",
  "fitofarmaka",
  "alkes",
  "consumable",
] as const;
export type DrugClass = (typeof DRUG_CLASSES)[number];

export const DOSAGE_FORMS = [
  "tablet",
  "capsule",
  "syrup",
  "suspension",
  "injection",
  "infusion",
  "cream",
  "ointment",
  "gel",
  "drops",
  "spray",
  "suppository",
  "patch",
  "device",
  "other",
] as const;
export type DosageForm = (typeof DOSAGE_FORMS)[number];

export const PAYMENT_METHODS = [
  "tunai",
  "kartu_debit",
  "kartu_kredit",
  "qris",
  "transfer",
  "lainnya",
] as const;

export const MOVEMENT_TYPES = [
  "opening",
  "receive",
  "sale",
  "sale_void",
  "return",
  "adjust",
  "dispose",
] as const;

export const BATCH_STATUSES = [
  "active",
  "quarantined",
  "expired",
  "disposed",
  "depleted",
] as const;

export const ALERT_TYPES = [
  "expired_stock",
  "out_of_stock",
  "expiring_urgent",
  "low_stock",
  "expiring_notice",
  "dead_stock",
] as const;

export const ALERT_SEVERITIES = ["critical", "warning", "notice"] as const;

/**
 * An imported block of past sales is either counted in the reports or has been
 * withdrawn. Withdrawn, not deleted: the rows stay, so the record shows what
 * was imported, by whom, and why it was taken back out.
 */
export const HISTORY_IMPORT_STATUSES = ["active", "withdrawn"] as const;
export type HistoryImportStatus = (typeof HISTORY_IMPORT_STATUSES)[number];

/**
 * Classes that may never be restocked from a return, and that require a
 * responsible pharmacist on every movement. Enforced in code rather than left
 * to a settings toggle.
 */
export const RESTRICTED_DRUG_CLASSES = [
  "keras",
  "owa",
  "psikotropika",
  "narkotika",
] as const;

/** Classes that will require SIPNAP register reporting once stocked. */
export const REGISTER_DRUG_CLASSES = ["psikotropika", "narkotika"] as const;
