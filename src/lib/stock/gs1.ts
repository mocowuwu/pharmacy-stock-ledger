import { endOfMonth } from "@/lib/format/date";

/**
 * Barcode parsing for receiving.
 *
 * Indonesian packaging is mixed, so this handles both cases the counter will
 * actually meet:
 *
 *   - A GS1 DataMatrix or GS1-128 carrying application identifiers. One scan
 *     yields the product, the lot number and the expiry date, which removes the
 *     most common source of bad expiry data: typing it.
 *   - A plain EAN-13, which identifies the product only. Lot and expiry are
 *     then typed, and the operator is told why.
 *
 * A scanner presents as a keyboard, so the input arrives as one string ending
 * in Enter. Some scanners prefix a symbology identifier (]d2, ]C1, ]e0) and
 * most emit ASCII GS (0x1D) where the barcode had FNC1.
 */

export type ScanResult =
  | {
      kind: "gs1";
      gtin: string | null;
      lotNumber: string | null;
      /** YYYY-MM-DD. GS1 day "00" means end of month, which is how boxes print it. */
      expiryDate: string | null;
      serial: string | null;
      /** AIs present but not used here, kept so nothing is silently discarded. */
      extra: Record<string, string>;
    }
  | { kind: "plain"; code: string }
  | { kind: "unreadable"; raw: string };

/** ASCII group separator, which is what a scanner emits for FNC1. */
export const GS = "\x1d";

/** Application identifiers with a fixed value length. */
const FIXED_LENGTH: Record<string, number> = {
  "00": 18, // SSCC
  "01": 14, // GTIN
  "02": 14,
  "11": 6, // production date
  "13": 6, // packaging date
  "15": 6, // best before
  "16": 6, // sell by
  "17": 6, // expiry
};

/** Variable-length AIs this parser understands, terminated by GS or end of input. */
const VARIABLE = new Set(["10", "21", "30", "37", "240", "241", "710", "711"]);

function stripSymbology(raw: string): string {
  // ]d2 = DataMatrix with FNC1, ]C1 = Code 128 with FNC1, ]e0 = GS1 DataBar.
  return raw.replace(/^\](?:d2|C1|e0|Q3|J1)/u, "");
}

/**
 * GS1 dates are YYMMDD. A day of "00" means "end of this month", which is what
 * a box printing only a month and year actually means -- and stock is good
 * through the whole of its expiry date, so it must resolve to the last day, not
 * the first.
 */
export function parseGs1Date(value: string): string | null {
  if (!/^\d{6}$/u.test(value)) return null;
  const yy = Number(value.slice(0, 2));
  const mm = Number(value.slice(2, 4));
  const dd = Number(value.slice(4, 6));
  if (mm < 1 || mm > 12) return null;
  if (dd > 31) return null;

  // GS1 rule: 00-49 is 20xx, 50-99 is 19xx.
  const year = yy <= 49 ? 2000 + yy : 1900 + yy;
  if (dd === 0) return endOfMonth(year, mm);

  const iso = `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  // Reject impossible days such as 31 February rather than let Date roll over.
  const check = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(check.getTime()) || check.getUTCDate() !== dd) return null;
  return iso;
}

export function parseScan(raw: string): ScanResult {
  const input = stripSymbology(raw.trim());
  if (input === "") return { kind: "unreadable", raw };

  // A bare run of digits with no AI structure is an ordinary product barcode.
  if (/^\d{8}$|^\d{12,14}$/u.test(input)) {
    return { kind: "plain", code: input };
  }

  const found: Record<string, string> = {};
  let i = 0;
  let matchedAny = false;

  while (i < input.length) {
    if (input[i] === GS) {
      i += 1;
      continue;
    }

    let ai = input.slice(i, i + 2);
    const length: number | undefined = FIXED_LENGTH[ai];

    if (length === undefined && !VARIABLE.has(ai)) {
      // Try a three-digit AI before giving up.
      const ai3 = input.slice(i, i + 3);
      if (VARIABLE.has(ai3)) {
        ai = ai3;
      } else {
        // Unrecognised structure: stop rather than mis-assign the remainder.
        break;
      }
    }

    i += ai.length;

    let value: string;
    if (length !== undefined) {
      value = input.slice(i, i + length);
      if (value.length < length) break;
      i += length;
    } else {
      const end = input.indexOf(GS, i);
      value = end === -1 ? input.slice(i) : input.slice(i, end);
      i = end === -1 ? input.length : end + 1;
    }

    if (value === "") break;
    found[ai] = value;
    matchedAny = true;
  }

  if (!matchedAny) {
    return /^\d+$/u.test(input)
      ? { kind: "plain", code: input }
      : { kind: "unreadable", raw };
  }

  const { "01": gtin, "10": lot, "17": expiry, "21": serial, ...rest } = found;
  return {
    kind: "gs1",
    gtin: gtin ?? null,
    lotNumber: lot ?? null,
    expiryDate: expiry ? parseGs1Date(expiry) : null,
    serial: serial ?? null,
    extra: rest,
  };
}

/**
 * A GTIN-14 is an EAN-13 with a packaging-level digit in front, so a box scanned
 * as GTIN-14 and the same product's EAN-13 have to match on the last 13.
 */
export function gtinVariants(code: string): string[] {
  const digits = code.replace(/\D/gu, "");
  const variants = new Set<string>([digits]);
  if (digits.length === 14) variants.add(digits.slice(1));
  if (digits.length === 13) variants.add(`0${digits}`);
  return [...variants];
}
