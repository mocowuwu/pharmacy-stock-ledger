import { pgEnum } from "drizzle-orm/pg-core";
import {
  ALERT_SEVERITIES,
  ALERT_TYPES,
  BATCH_STATUSES,
  DOSAGE_FORMS,
  DRUG_CLASSES,
  MOVEMENT_TYPES,
  PAYMENT_METHODS,
} from "@/lib/catalogue/enums";

export {
  RESTRICTED_DRUG_CLASSES,
  REGISTER_DRUG_CLASSES,
} from "@/lib/catalogue/enums";

/**
 * Every enum stores a stable key, never display text. Labels for both locales
 * live in the i18n message catalogues, so renaming a label is a translation
 * change and never a data migration.
 */

/**
 * Indonesian drug classification. Legally meaningful and printed as a symbol on
 * every box, which is why this replaced the generic `is_controlled` boolean:
 * it gates who may dispense what, drives the narkotika register, and is the
 * field a future prescription module branches on.
 */
export const drugClass = pgEnum("drug_class", DRUG_CLASSES);


export const dosageForm = pgEnum("dosage_form", DOSAGE_FORMS);

export const itemStatus = pgEnum("item_status", ["active", "archived"]);

/**
 * Only `active` batches are sellable. `quarantined` covers returned stock and
 * anything pulled pending a decision; `expired` is set automatically.
 */
export const batchStatus = pgEnum("batch_status", BATCH_STATUSES);

/**
 * Every reason a batch quantity can change. `opening` is distinguished from
 * `receive` so the go-live count is identifiable forever after.
 */
export const movementType = pgEnum("movement_type", MOVEMENT_TYPES);

export const saleStatus = pgEnum("sale_status", ["completed", "voided"]);

/** QRIS is included because it is ubiquitous in Indonesia. */
export const paymentMethod = pgEnum("payment_method", PAYMENT_METHODS);

export const userStatus = pgEnum("user_status", ["active", "suspended"]);

export const locale = pgEnum("locale", ["id", "en"]);

export const alertType = pgEnum("alert_type", ALERT_TYPES);

export const alertSeverity = pgEnum("alert_severity", ALERT_SEVERITIES);

export const alertStatus = pgEnum("alert_status", [
  "open",
  "acknowledged",
  "snoozed",
  "resolved",
]);

/** Whether the stored sale price already contains PPN. */
export const taxMode = pgEnum("tax_mode", ["inclusive", "exclusive"]);

export const countStatus = pgEnum("count_status", [
  "draft",
  "counting",
  "review",
  "posted",
  "cancelled",
]);
