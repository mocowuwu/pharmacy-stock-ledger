import { describe, expect, it } from "vitest";
import { applyRateBps, formatMoney, parseMoney, splitInclusiveTax } from "./money";
import {
  addDays,
  daysBetween,
  daysUntilExpiry,
  endOfMonth,
  formatExpiry,
  isExpired,
  today,
} from "./date";

describe("formatMoney", () => {
  it("uses Indonesian grouping and no decimals for rupiah", () => {
    expect(formatMoney(15_000)).toBe("Rp 15.000");
    expect(formatMoney(1_500_000)).toBe("Rp 1.500.000");
    expect(formatMoney(0)).toBe("Rp 0");
  });

  it("formats amounts a 32-bit column could not hold", () => {
    // Past INT_MAX (2,147,483,647) -- the reason money columns are BIGINT.
    expect(formatMoney(9_500_000_000)).toBe("Rp 9.500.000.000");
  });

  it("can omit the symbol for table cells and inputs", () => {
    expect(formatMoney(15_000, { bare: true })).toBe("15.000");
  });
});

describe("parseMoney", () => {
  it("reads an Indonesian-formatted price without dividing it by a thousand", () => {
    // The trap this function exists for: parseFloat("15.000") is 15.
    expect(parseMoney("15.000")).toBe(15_000);
    expect(parseMoney("1.500.000")).toBe(1_500_000);
  });

  it("accepts what people actually type", () => {
    expect(parseMoney("15000")).toBe(15_000);
    expect(parseMoney("Rp 15.000")).toBe(15_000);
    expect(parseMoney("  rp15000 ")).toBe(15_000);
    expect(parseMoney("15,000")).toBe(15_000);
  });

  it("refuses ambiguous input rather than being confidently wrong", () => {
    // Reading this as 1.500.000 would be a hundredfold error that still looks
    // like a plausible price, so it is rejected instead.
    expect(parseMoney("15.000,00")).toBeNull();
  });

  it("returns null for unreadable input", () => {
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("12x00")).toBeNull();
  });

  it("round-trips through formatMoney", () => {
    for (const amount of [0, 500, 15_000, 1_500_000, 9_500_000_000]) {
      expect(parseMoney(formatMoney(amount))).toBe(amount);
    }
  });
});

describe("tax arithmetic", () => {
  it("applies a basis-point rate without floats", () => {
    expect(applyRateBps(100_000, 1100)).toBe(11_000); // 11%
    expect(applyRateBps(15_000, 1200)).toBe(1_800); // 12%
  });

  it("splits an inclusive amount so the parts sum to the original", () => {
    for (const gross of [15_000, 99_999, 1_234_567]) {
      const { net, tax } = splitInclusiveTax(gross, 1100);
      expect(net + tax).toBe(gross);
    }
  });
});

describe("expiry dates", () => {
  it("renders unambiguously in both locales", () => {
    // Never "03/04/2027", which is two different days depending on the reader.
    expect(formatExpiry("2027-03-15", "id")).toBe("15 Mar 2027");
    expect(formatExpiry("2027-03-15", "en")).toBe("15 Mar 2027");
    expect(formatExpiry("2027-05-01", "id")).toBe("1 Mei 2027");
    expect(formatExpiry("2027-05-01", "en")).toBe("1 May 2027");
  });

  it("converts a printed expiry month to the last day of that month", () => {
    expect(endOfMonth(2027, 3)).toBe("2027-03-31");
    expect(endOfMonth(2027, 2)).toBe("2027-02-28");
    expect(endOfMonth(2028, 2)).toBe("2028-02-29"); // leap year
    expect(endOfMonth(2027, 12)).toBe("2027-12-31");
  });

  it("counts whole days across month and year boundaries", () => {
    expect(daysBetween("2027-03-01", "2027-03-31")).toBe(30);
    expect(daysBetween("2027-12-31", "2028-01-01")).toBe(1);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2); // leap year
    expect(daysBetween("2027-03-31", "2027-03-01")).toBe(-30);
  });

  it("treats stock as good through the whole of its expiry date", () => {
    const t = today();
    expect(isExpired(t)).toBe(false);
    expect(isExpired(addDays(t, -1))).toBe(true);
    expect(isExpired(addDays(t, 1))).toBe(false);
    expect(daysUntilExpiry(t)).toBe(0);
    expect(daysUntilExpiry(addDays(t, 30))).toBe(30);
  });

  it("is not shifted by the host machine's timezone", () => {
    // Asia/Jakarta is UTC+7, so a naive UTC "today" is a day behind for the
    // first seven hours of every local day. Both zones must agree on a date
    // that is unambiguously in the past or future.
    const jakarta = today("Asia/Jakarta");
    const utc = today("UTC");
    expect(Math.abs(daysBetween(utc, jakarta))).toBeLessThanOrEqual(1);
    expect(isExpired(addDays(jakarta, -5), "Asia/Jakarta")).toBe(true);
    expect(isExpired(addDays(jakarta, 5), "Asia/Jakarta")).toBe(false);
  });
});
