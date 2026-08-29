import { describe, expect, it } from "vitest";
import { GS, gtinVariants, parseGs1Date, parseScan } from "./gs1";

describe("parseGs1Date", () => {
  it("reads YYMMDD", () => {
    expect(parseGs1Date("270315")).toBe("2027-03-15");
  });

  it("treats day 00 as the end of the month", () => {
    // A box printing only "03/2027" is good through the whole of March, so the
    // day must resolve to the last of the month and never the first.
    expect(parseGs1Date("270300")).toBe("2027-03-31");
    expect(parseGs1Date("270200")).toBe("2027-02-28");
    expect(parseGs1Date("280200")).toBe("2028-02-29");
  });

  it("applies the GS1 century rule", () => {
    expect(parseGs1Date("490101")).toBe("2049-01-01");
    expect(parseGs1Date("500101")).toBe("1950-01-01");
  });

  it("rejects impossible dates instead of rolling them over", () => {
    // Date() would silently turn 31 February into 3 March.
    expect(parseGs1Date("270231")).toBeNull();
    expect(parseGs1Date("271301")).toBeNull();
    expect(parseGs1Date("abc")).toBeNull();
  });
});

describe("parseScan", () => {
  it("reads a GS1 payload with product, lot and expiry", () => {
    const result = parseScan(`010899123456789017270300${GS}10AB1234`);
    expect(result.kind).toBe("gs1");
    if (result.kind === "gs1") {
      expect(result.gtin).toBe("08991234567890");
      expect(result.expiryDate).toBe("2027-03-31");
      expect(result.lotNumber).toBe("AB1234");
    }
  });

  it("reads a lot number that precedes the expiry", () => {
    const result = parseScan(`0108991234567890${GS}10LOT-99${GS}17271231`);
    expect(result.kind).toBe("gs1");
    if (result.kind === "gs1") {
      expect(result.lotNumber).toBe("LOT-99");
      expect(result.expiryDate).toBe("2027-12-31");
    }
  });

  it("strips the symbology prefix some scanners add", () => {
    const result = parseScan(`]d20108991234567890${GS}17270300`);
    expect(result.kind).toBe("gs1");
    if (result.kind === "gs1") expect(result.gtin).toBe("08991234567890");
  });

  it("treats a plain EAN-13 as a product code only", () => {
    expect(parseScan("8991234567890")).toEqual({
      kind: "plain",
      code: "8991234567890",
    });
  });

  it("keeps a lot number containing letters and punctuation", () => {
    const result = parseScan(`10ABC-123/X${GS}17270300`);
    expect(result.kind).toBe("gs1");
    if (result.kind === "gs1") expect(result.lotNumber).toBe("ABC-123/X");
  });

  it("keeps unrecognised identifiers instead of dropping them silently", () => {
    const result = parseScan(`0108991234567890${GS}30250`);
    expect(result.kind).toBe("gs1");
    if (result.kind === "gs1") expect(result.extra["30"]).toBe("250");
  });

  it("reports input it cannot read rather than inventing a product", () => {
    expect(parseScan("").kind).toBe("unreadable");
    expect(parseScan("hello world").kind).toBe("unreadable");
  });

  it("does not return an expiry it could not parse", () => {
    const result = parseScan(`0108991234567890${GS}17999999`);
    expect(result.kind).toBe("gs1");
    if (result.kind === "gs1") expect(result.expiryDate).toBeNull();
  });
});

describe("gtinVariants", () => {
  it("matches a GTIN-14 box against the product's EAN-13", () => {
    expect(gtinVariants("08991234567890")).toContain("8991234567890");
    expect(gtinVariants("8991234567890")).toContain("08991234567890");
  });
});
