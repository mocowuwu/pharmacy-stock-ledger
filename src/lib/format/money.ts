/**
 * Money formatting and parsing.
 *
 * Amounts are whole rupiah held as integers. `decimals` comes from the
 * `currency_decimals` setting (0 for IDR) so the module is not hardcoded to a
 * zero-decimal currency.
 */

export type MoneyOptions = {
  /** Currency decimals, from settings. 0 for IDR. */
  decimals?: number;
  currency?: string;
  /** Omit the currency symbol -- for table cells and form inputs. */
  bare?: boolean;
};

/**
 * Formats an integer amount for display: 15000 -> "Rp 15.000".
 *
 * Indonesian convention puts a period at the thousands and a comma at the
 * decimal, which is the reverse of English. Everything goes through Intl with
 * an explicit `id-ID` locale rather than the viewer's, because the pharmacy
 * trades in rupiah whichever language the cashier reads.
 */
export function formatMoney(amount: number, opts: MoneyOptions = {}): string {
  const { decimals = 0, currency = "IDR", bare = false } = opts;
  const value = decimals > 0 ? amount / 10 ** decimals : amount;

  const formatter = new Intl.NumberFormat("id-ID", {
    style: bare ? "decimal" : "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  // Intl renders IDR as "Rp15.000" with no break; a space reads better on a
  // receipt and in dense tables.
  return formatter.format(value).replace(/^Rp\s*/u, "Rp ");
}

/**
 * Parses user-typed money into an integer amount.
 *
 * This exists because of one specific trap: in Indonesian, "15.000" means
 * fifteen thousand, but `parseFloat("15.000")` returns 15. Letting a raw parse
 * anywhere near a price field would silently divide every entered price by a
 * thousand, and the error would look like a plausible number rather than an
 * obvious fault.
 *
 * Returns null for anything it cannot read, so callers must handle failure
 * rather than receive a confident wrong number.
 */
export function parseMoney(input: string, opts: MoneyOptions = {}): number | null {
  const { decimals = 0 } = opts;

  const cleaned = input.trim().replace(/rp/iu, "").replace(/\s/gu, "");
  if (cleaned === "") return null;
  if (!/^-?[\d.,]+$/u.test(cleaned)) return null;

  const negative = cleaned.startsWith("-");
  const digitsAndSeps = negative ? cleaned.slice(1) : cleaned;

  let whole: string;
  let fraction = "";

  if (decimals === 0) {
    // For a zero-decimal currency every separator is thousands grouping, so
    // "15.000", "15,000" and "15000" all mean fifteen thousand.
    //
    // One input stays genuinely ambiguous: "15.000,00" is a formatted decimal
    // amount from a spreadsheet, and stripping its separators would read it as
    // 1.500.000 -- a hundredfold error that still looks like a plausible price.
    // Rather than guess, refuse it and let the caller ask.
    if (/[.]/u.test(digitsAndSeps) && /,\d{1,2}$/u.test(digitsAndSeps)) return null;
    whole = digitsAndSeps.replace(/[.,]/gu, "");
  } else {
    // The last separator is the decimal point only if it is followed by at
    // most `decimals` digits; otherwise it is grouping.
    const lastSep = Math.max(digitsAndSeps.lastIndexOf("."), digitsAndSeps.lastIndexOf(","));
    const tail = lastSep === -1 ? "" : digitsAndSeps.slice(lastSep + 1);
    if (lastSep !== -1 && tail.length > 0 && tail.length <= decimals && !/[.,]/u.test(tail)) {
      whole = digitsAndSeps.slice(0, lastSep).replace(/[.,]/gu, "");
      fraction = tail.padEnd(decimals, "0");
    } else {
      whole = digitsAndSeps.replace(/[.,]/gu, "");
      fraction = "0".repeat(decimals);
    }
  }

  if (whole === "" && fraction === "") return null;
  const combined = `${whole || "0"}${fraction}`;
  if (!/^\d+$/u.test(combined)) return null;

  const value = Number(combined);
  if (!Number.isSafeInteger(value)) return null;
  return negative ? -value : value;
}

/** Basis points to a multiplier: 1100 bps (11%) applied to 10000 gives 1100. */
export function applyRateBps(amount: number, rateBps: number): number {
  return Math.round((amount * rateBps) / 10_000);
}

/**
 * Splits a tax-inclusive amount into net and tax, such that net + tax is
 * exactly the original. Rounding the tax and subtracting -- rather than
 * rounding both independently -- is what keeps a receipt's lines adding up to
 * its total.
 */
export function splitInclusiveTax(
  gross: number,
  rateBps: number,
): { net: number; tax: number } {
  const tax = Math.round((gross * rateBps) / (10_000 + rateBps));
  return { net: gross - tax, tax };
}
