import { bigint, timestamp } from "drizzle-orm/pg-core";

/**
 * Money column. Two deliberate choices, both driven by the rupiah:
 *
 * 1. The column is BIGINT, not INT. A 32-bit signed integer tops out at
 *    2,147,483,647 -- around Rp 2.1 billion, which a working clinic pharmacy
 *    passes in well under a year of sales. The overflow would be silent right
 *    up until it wasn't, so the wide column is not optional here.
 *
 * 2. It reads into JavaScript as `number`, not `bigint`. A double holds every
 *    integer up to 2^53 exactly -- about Rp 9 quadrillion, which is not a
 *    reachable amount for this business -- so no precision is at risk, and it
 *    avoids BigInt's inability to cross the server/client component boundary
 *    without bespoke serialisation.
 *
 * Values are whole rupiah. `currency_decimals` in settings is 0 for IDR; the
 * setting exists so the model is not hardcoded to a zero-decimal currency.
 */
export const money = (name: string) => bigint(name, { mode: "number" });

/** Quantities are always in the item's base unit (capsule, bottle, vial). */
export const qty = (name: string) => bigint(name, { mode: "number" });

/**
 * All timestamps carry a timezone. Expiry arithmetic across a date boundary is
 * exactly where a naive timestamp causes a wrong answer, and a wrong expiry is
 * a safety problem rather than a cosmetic one.
 */
export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
