import { describe, expect, it } from "vitest";
import { csvField, csvFilename, csvHeaders, csvRow, toCsv } from "@/lib/format/csv";

describe("csv fields", () => {
  it("leaves ordinary values alone", () => {
    expect(csvField("Paracetamol")).toBe("Paracetamol");
    expect(csvField(15_000)).toBe("15000");
    expect(csvField("2026-08-29")).toBe("2026-08-29");
  });

  it("writes a missing value as an empty field, not the word null", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
    // A batch with no lot number is a real case: legacy opening stock.
    expect(csvRow(["P-1", null, 5])).toBe("P-1,,5");
  });

  it("quotes a field containing the separator", () => {
    expect(csvField("Amoxicillin, 500 mg")).toBe('"Amoxicillin, 500 mg"');
  });

  it("doubles a quote inside a quoted field", () => {
    expect(csvField('Lot "A"')).toBe('"Lot ""A"""');
  });

  it("quotes a field containing a newline", () => {
    // Free-typed reasons can contain anything, including a pasted line break.
    expect(csvField("Rusak\nsaat kirim")).toBe('"Rusak\nsaat kirim"');
    expect(csvField("Rusak\r\nsaat kirim")).toBe('"Rusak\r\nsaat kirim"');
  });

  it("keeps money as a plain integer a spreadsheet can add up", () => {
    // Never "Rp 15.000": a formatted amount is text, and a column of text sums
    // to zero. The Indonesian thousands separator is a period, which makes the
    // wrong answer look plausible rather than obviously broken.
    expect(csvField(15_000)).toBe("15000");
    expect(csvField(2_147_483_648)).toBe("2147483648");
  });
});

describe("csv files", () => {
  it("starts with a byte-order mark and separates rows with CRLF", () => {
    const csv = toCsv(["Barang", "Jumlah"], [["Paracetamol", 10]]);

    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe("﻿Barang,Jumlah\r\nParacetamol,10\r\n");
  });

  it("carries non-ASCII text through intact", () => {
    const csv = toCsv(["Barang"], [["Obat Batuk & Flu — Dewasa"]]);
    expect(csv).toContain("Obat Batuk & Flu — Dewasa");
  });

  it("writes a header-only file when there is nothing to report", () => {
    // An empty report is a real answer -- a quiet month -- and should download
    // as a readable file rather than as nothing at all.
    expect(toCsv(["Barang", "Jumlah"], [])).toBe("﻿Barang,Jumlah\r\n");
  });

  it("names the file after the report and its window", () => {
    expect(csvFilename("penjualan", "2026-08-01", "2026-08-29")).toBe(
      "penjualan-2026-08-01_2026-08-29.csv",
    );
  });

  it("asks the browser to download rather than display it", () => {
    const headers = csvHeaders("penjualan-2026-08-01_2026-08-29.csv") as Record<
      string,
      string
    >;

    expect(headers["Content-Type"]).toBe("text/csv; charset=utf-8");
    expect(headers["Content-Disposition"]).toContain("attachment");
    expect(headers["Cache-Control"]).toBe("no-store");
  });
});
