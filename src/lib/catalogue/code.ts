/**
 * Item codes.
 *
 * Pharmacies that already keep codes on paper should be able to type their own,
 * so a code is only generated when the field is left blank. Generated codes are
 * derived from the generic name rather than being a bare sequence: "AMOX001" is
 * recognisable on a shelf label and in a stock count sheet, where "ITM00417"
 * has to be looked up.
 */

/** Up to four letters of the generic name, uppercased. "Amoxicillin" -> "AMOX". */
export function codePrefix(genericName: string): string {
  const letters = genericName
    .normalize("NFD")
    .replace(/[̀-ͯ]/gu, "")
    .replace(/[^a-zA-Z0-9]/gu, "")
    .toUpperCase();
  if (letters.length === 0) return "ITM";
  return letters.slice(0, 4).padEnd(3, "X");
}

/**
 * The next free code for a prefix, given the codes already using it.
 * Gaps are not reused: a code that once meant something should not later mean
 * something else in an old count sheet.
 */
export function nextCode(prefix: string, existing: readonly string[]): string {
  const pattern = new RegExp(`^${prefix}(\\d{3,})$`, "u");
  let highest = 0;
  for (const code of existing) {
    const match = pattern.exec(code.toUpperCase());
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  const next = highest + 1;
  return `${prefix}${String(next).padStart(3, "0")}`;
}

/** Codes are compared case-insensitively, so they are stored uppercase. */
export function normaliseCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/gu, "");
}
