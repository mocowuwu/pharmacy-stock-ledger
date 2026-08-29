import { z } from "zod";
import { parseMoney } from "@/lib/format/money";
import { DOSAGE_FORMS, DRUG_CLASSES } from "./enums";

/**
 * Form validation for the catalogue.
 *
 * Everything arrives from a form as a string. Money in particular must go
 * through `parseMoney` rather than `Number()` or `z.coerce.number()`:
 * `Number("15.000")` is 15, and in Indonesian that string means fifteen
 * thousand. A coercion that quietly divides a price by a thousand produces a
 * plausible-looking wrong number, which is the worst kind.
 */

const trimmed = z.string().trim();
const optionalText = trimmed.max(200).optional().transform((v) => (v ? v : null));

/** A money field entered by a person. Rejects rather than guesses. */
const moneyField = (label: string) =>
  trimmed.transform((raw, ctx) => {
    if (raw === "") return 0;
    const parsed = parseMoney(raw);
    if (parsed === null || parsed < 0) {
      ctx.addIssue({ code: "custom", message: `invalid_${label}` });
      return z.NEVER;
    }
    return parsed;
  });

/** A whole-unit quantity. Never fractional: you cannot stock half a capsule. */
const qtyField = (label: string, { min = 0 }: { min?: number } = {}) =>
  trimmed.transform((raw, ctx) => {
    if (raw === "") return null;
    if (!/^\d+$/u.test(raw)) {
      ctx.addIssue({ code: "custom", message: `invalid_${label}` });
      return z.NEVER;
    }
    const value = Number(raw);
    if (value < min) {
      ctx.addIssue({ code: "custom", message: `invalid_${label}` });
      return z.NEVER;
    }
    return value;
  });

export const itemInput = z.object({
  // Blank means "generate one" -- see lib/catalogue/code.ts.
  code: trimmed.max(32).optional().transform((v) => (v ? v : null)),
  genericName: trimmed.min(1, "required").max(200),
  brandName: optionalText,
  form: z.enum(DOSAGE_FORMS),
  strength: optionalText,
  unit: trimmed.min(1, "required").max(40),
  packSize: qtyField("pack_size", { min: 1 }),
  categoryId: trimmed.uuid().optional().or(z.literal("")).transform((v) => (v ? v : null)),
  drugClass: z.enum(DRUG_CLASSES),
  nie: optionalText,
  isTaxExempt: z.coerce.boolean().default(false),
  reorderPoint: qtyField("reorder_point").transform((v) => v ?? 0),
  reorderQty: qtyField("reorder_qty", { min: 1 }),
  defaultPrice: moneyField("price"),
  minShelfLifeDays: qtyField("min_shelf_life", { min: 0 }),
  notes: trimmed.max(2000).optional().transform((v) => (v ? v : null)),
});

export type ItemInput = z.infer<typeof itemInput>;

export const supplierInput = z.object({
  name: trimmed.min(1, "required").max(200),
  contactPerson: optionalText,
  phone: optionalText,
  email: trimmed
    .max(200)
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.string().email().safeParse(v).success, "invalid_email"),
  address: trimmed.max(500).optional().transform((v) => (v ? v : null)),
  notes: trimmed.max(2000).optional().transform((v) => (v ? v : null)),
});

export type SupplierInput = z.infer<typeof supplierInput>;

export const categoryInput = z.object({
  name: trimmed.min(1, "required").max(100),
});

/**
 * A barcode as scanned. GS1 payloads carry lot and expiry too, but those belong
 * to a batch and are parsed at receiving -- what is stored against an item is
 * only the code that identifies the product.
 */
export const barcodeInput = z.object({
  barcode: trimmed.min(4, "required").max(64),
  packSize: qtyField("pack_size", { min: 1 }),
  note: optionalText,
});

/** Turns a FormData into a plain object zod can read. Checkboxes become booleans. */
export function formToObject(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    out[key] = typeof value === "string" ? value : value.name;
  }
  return out;
}
