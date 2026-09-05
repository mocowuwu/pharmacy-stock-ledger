import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { locale, taxMode } from "./enums";
import { ts } from "./columns";
import { users } from "./users";

/** Single-row configuration table. The check constraint keeps it single-row. */
export const settings = pgTable(
  "settings",
  {
    id: integer("id").primaryKey().default(1),

    businessName: text("business_name").notNull().default(""),
    /**
     * The line under the name, on the sidebar and the sign-in screen. A
     * description of the business rather than of the software -- the staff read
     * it every day and "Sistem persediaan" tells them nothing they don't know.
     */
    businessTagline: text("business_tagline"),
    businessAddress: text("business_address"),
    businessPhone: text("business_phone"),
    /** Tax identification number. Only meaningful once the business is a PKP. */
    npwp: text("npwp"),
    /** Apotek licence number, for the receipt footer. */
    licenceNumber: text("licence_number"),

    currencyCode: text("currency_code").notNull().default("IDR"),
    /**
     * 0 for the rupiah, which has no minor unit in practical use. The setting
     * exists so the money model is not hardcoded to a zero-decimal currency.
     */
    currencyDecimals: integer("currency_decimals").notNull().default(0),

    /**
     * The receipt is customer-facing, so its language is a property of the
     * business rather than of whichever cashier is signed in. A cashier working
     * in English must not hand an Indonesian customer an English receipt.
     */
    receiptLocale: locale("receipt_locale").notNull().default("id"),
    receiptFooter: text("receipt_footer"),

    /** Expiry is a calendar-day concept, so it needs the pharmacy's own zone. */
    timezone: text("timezone").notNull().default("Asia/Jakarta"),

    /**
     * Off by default: a clinic pharmacy below the PKP registration threshold
     * does not charge PPN at all, and sees no tax fields anywhere.
     */
    taxEnabled: boolean("tax_enabled").notNull().default(false),
    taxMode: taxMode("tax_mode").notNull().default("exclusive"),

    /* Alert thresholds, in days. Defaults match the design doc. */
    expiringUrgentDays: integer("expiring_urgent_days").notNull().default(30),
    expiringNoticeDays: integer("expiring_notice_days").notNull().default(90),
    deadStockNoSaleDays: integer("dead_stock_no_sale_days").notNull().default(90),
    deadStockExpiryDays: integer("dead_stock_expiry_days").notNull().default(180),

    /**
     * Permits restocking returned stock for sealed OTC and devices. Restricted
     * drug classes are refused in code regardless of this flag.
     */
    allowReturnRestock: boolean("allow_return_restock").notNull().default(false),

    /*
     * Module switches.
     *
     * These decide what the pharmacy is shown, not what it is allowed to do.
     * Turning a module off hides its menu entry and its entry points; it never
     * refuses a request, because a courtesy that starts refusing is a control
     * with no audit trail, and it would strand records already in the system.
     * Permissions remain the only control.
     */

    /** Taking medicine back over the counter. */
    returnsEnabled: boolean("returns_enabled").notNull().default(true),

    /**
     * The scan fields on receiving and at the till. Worth off until a scanner
     * is actually plugged in: the field is built to swallow fast keyboard
     * input ending in Enter, which is a nuisance without one.
     */
    barcodesEnabled: boolean("barcodes_enabled").notNull().default(true),

    /**
     * Off until the pharmacy first stocks these classes. While off, the two
     * classes are not offered when creating an item -- but any item already
     * carrying one still displays it. A module switch never rewrites data.
     */
    narkotikaEnabled: boolean("narkotika_enabled").notNull().default(false),

    /** Supplier records and the receiving screen's supplier picker. */
    suppliersEnabled: boolean("suppliers_enabled").notNull().default(true),

    /** Item categories, used for organizing the catalogue and filtering. */
    categoriesEnabled: boolean("categories_enabled").notNull().default(true),

    /** Physical stock counts and their posting screen. */
    countsEnabled: boolean("counts_enabled").notNull().default(true),

    /** Disposing expired or damaged stock as a loss. */
    disposeEnabled: boolean("dispose_enabled").notNull().default(true),

    /**
     * The spreadsheet-import entry point on the katalog screen. Off by default:
     * a bulk loader is worth surfacing only once someone is about to use it, and
     * `items.import` is the actual control regardless of this switch.
     */
    importEnabled: boolean("import_enabled").notNull().default(false),

    digestEnabled: boolean("digest_enabled").notNull().default(false),
    digestEmail: text("digest_email"),
    /** Local hour the digest is sent, 0-23. The job decides; nothing polls. */
    digestHour: integer("digest_hour").notNull().default(7),

    /*
     * Outgoing mail, configured by the owner rather than by an environment
     * variable, because the person who knows the mailbox password is the owner
     * and not whoever deploys the container.
     *
     * With no host set the digest renders to a file instead of sending, so the
     * feature is usable and inspectable before any account exists.
     */
    smtpHost: text("smtp_host"),
    smtpPort: integer("smtp_port").notNull().default(587),
    smtpUser: text("smtp_user"),
    /**
     * Never leaves the server. The settings screen is told whether one is set,
     * never what it is, and only overwrites it when a new one is typed.
     */
    smtpPassword: text("smtp_password"),
    smtpFrom: text("smtp_from"),
    /** True for implicit TLS on 465; STARTTLS on 587 is negotiated either way. */
    smtpSecure: boolean("smtp_secure").notNull().default(false),

    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [check("settings_is_singleton", sql`${t.id} = 1`)],
);

/**
 * PPN rates with effective dates, rather than one mutable number in settings.
 *
 * The Indonesian general rate has moved more than once in recent years. If the
 * rate were a single editable field, reprinting a receipt from before a change
 * would apply today's rate and the reprint would be wrong. Sales snapshot the
 * rate they used; this table is what they snapshot from.
 */
export const taxRates = pgTable(
  "tax_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Basis points, so 11% is 1100 and no float ever touches a tax figure. */
    rateBps: integer("rate_bps").notNull(),
    effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
    /** Null while current. */
    effectiveTo: date("effective_to", { mode: "string" }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("tax_rates_rate_sane", sql`${t.rateBps} >= 0 and ${t.rateBps} <= 10000`),
    check(
      "tax_rates_period_ordered",
      sql`${t.effectiveTo} is null or ${t.effectiveTo} >= ${t.effectiveFrom}`,
    ),
    index("tax_rates_effective_idx").on(t.effectiveFrom),
  ],
);
