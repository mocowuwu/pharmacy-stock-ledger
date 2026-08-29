import { z } from "zod";
import { parseMoney } from "@/lib/format/money";
import { endOfMonth, isExpired, today } from "@/lib/format/date";

/**
 * Receiving a delivery.
 *
 * Two details are shaped by what is actually printed on a box:
 *
 *   - Expiry is entered as a month and year, because that is what boxes print.
 *     It resolves to the last day of that month, since stock is good through
 *     the whole of it. A scan that carries an exact date overrides this.
 *   - Quantity can be entered in packs, because "5 dus" is what the delivery
 *     note says and computing 500 by hand is where mistakes come from.
 */

const trimmed = z.string().trim();

const money = (label: string) =>
  trimmed.transform((raw, ctx) => {
    if (raw === "") return 0;
    const parsed = parseMoney(raw);
    if (parsed === null || parsed < 0) {
      ctx.addIssue({ code: "custom", message: `invalid_${label}` });
      return z.NEVER;
    }
    return parsed;
  });

const wholeNumber = (label: string, min = 1) =>
  trimmed.transform((raw, ctx) => {
    if (!/^\d+$/u.test(raw) || Number(raw) < min) {
      ctx.addIssue({ code: "custom", message: `invalid_${label}` });
      return z.NEVER;
    }
    return Number(raw);
  });

export const receiveLineInput = z
  .object({
    itemId: trimmed.uuid("required"),
    supplierId: trimmed.uuid("required"),
    lotNumber: trimmed.max(64).optional().transform((v) => (v ? v : null)),
    /** Set by a GS1 scan, which carries the exact printed date. */
    expiryDate: trimmed.optional(),
    expiryMonth: trimmed.optional(),
    expiryYear: trimmed.optional(),
    receivedDate: trimmed.optional(),
    quantity: wholeNumber("quantity"),
    quantityUnit: z.enum(["unit", "pack"]).default("unit"),
    packSize: trimmed.optional(),
    unitCost: money("cost"),
    isOpening: z.coerce.boolean().default(false),
    isLegacy: z.coerce.boolean().default(false),
    notes: trimmed.max(500).optional().transform((v) => (v ? v : null)),
  })
  .transform((raw, ctx) => {
    // Expiry: an exact scanned date wins; otherwise month and year.
    let expiry = raw.expiryDate && /^\d{4}-\d{2}-\d{2}$/u.test(raw.expiryDate)
      ? raw.expiryDate
      : null;

    if (!expiry) {
      const month = Number(raw.expiryMonth);
      const year = Number(raw.expiryYear);
      if (!Number.isInteger(month) || month < 1 || month > 12 ||
          !Number.isInteger(year) || year < 2000 || year > 2100) {
        ctx.addIssue({ code: "custom", path: ["expiryMonth"], message: "invalid_expiry" });
        return z.NEVER;
      }
      expiry = endOfMonth(year, month);
    }

    if (isExpired(expiry)) {
      // Refused at the door, which is the other half of refusing to sell it.
      ctx.addIssue({ code: "custom", path: ["expiryMonth"], message: "already_expired" });
      return z.NEVER;
    }

    // Quantity in packs is converted here so the ledger only ever sees units.
    const packSize = Number(raw.packSize);
    let qty = raw.quantity;
    let unitCost = raw.unitCost;

    if (raw.quantityUnit === "pack") {
      if (!Number.isInteger(packSize) || packSize < 1) {
        ctx.addIssue({ code: "custom", path: ["quantity"], message: "pack_size_unknown" });
        return z.NEVER;
      }
      qty = raw.quantity * packSize;
      // The invoice prices a pack, so the per-unit cost is derived. Rounding to
      // the nearest rupiah is at most half a rupiah per unit, which does not
      // matter at IDR scale -- and it keeps every stored amount a whole number.
      unitCost = Math.round(raw.unitCost / packSize);
    }

    const lotNumber = raw.isLegacy ? raw.lotNumber : raw.lotNumber;
    if (!raw.isLegacy && !lotNumber) {
      ctx.addIssue({ code: "custom", path: ["lotNumber"], message: "required" });
      return z.NEVER;
    }

    return {
      itemId: raw.itemId,
      supplierId: raw.supplierId,
      lotNumber,
      expiryDate: expiry,
      receivedDate: raw.receivedDate && /^\d{4}-\d{2}-\d{2}$/u.test(raw.receivedDate)
        ? raw.receivedDate
        : today(),
      qty,
      unitCost,
      isOpening: raw.isOpening,
      isLegacy: raw.isLegacy,
      notes: raw.notes,
    };
  });

export type ReceiveLineInput = z.infer<typeof receiveLineInput>;
