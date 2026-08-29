/**
 * CSV generation, to RFC 4180.
 *
 * Comma-separated with CRLF line endings and a UTF-8 byte-order mark. The BOM
 * is what makes a spreadsheet read `Amoksisilin` and `Rp` correctly instead of
 * as mojibake; Google Sheets strips it silently.
 *
 * The rule that matters most here: **money is written as a plain integer.**
 * `15000`, never `Rp 15.000`. A formatted amount is text to a spreadsheet, so a
 * column of them sums to zero, and the Indonesian thousands separator is a
 * period -- exactly the trap `money.ts` exists to avoid, arriving from the
 * other direction. Dates are `YYYY-MM-DD` for the same reason: unambiguous, and
 * sortable as text.
 */

export type CsvValue = string | number | null | undefined;
export type CsvRow = readonly CsvValue[];

const BOM = "﻿";
const EOL = "\r\n";

/**
 * Quotes a field only when it has to be: a comma, a quote, a CR or an LF.
 * Quoting everything would also be valid, but it makes the file harder to read
 * and to diff, and a report is something people open and look at.
 */
export function csvField(value: CsvValue): string {
  if (value === null || value === undefined) return "";

  const text = typeof value === "number" ? String(value) : value;
  if (!/[",\r\n]/u.test(text)) return text;

  // A quote inside a quoted field is escaped by doubling it.
  return `"${text.replaceAll('"', '""')}"`;
}

export function csvRow(row: CsvRow): string {
  return row.map(csvField).join(",");
}

/** A whole file: header row, then the body. */
export function toCsv(header: CsvRow, rows: readonly CsvRow[]): string {
  return BOM + [csvRow(header), ...rows.map(csvRow)].join(EOL) + EOL;
}

/**
 * A filename that says what the file is without needing to be opened:
 * `penjualan-2026-08-01_2026-08-29.csv`.
 */
export function csvFilename(report: string, from: string, to: string): string {
  return `${report}-${from}_${to}.csv`;
}

/** The response headers a browser needs to download rather than display it. */
export function csvHeaders(filename: string): HeadersInit {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    // A report is a snapshot of a moving system; a cached copy would be wrong
    // the moment the next sale is rung up.
    "Cache-Control": "no-store",
  };
}
