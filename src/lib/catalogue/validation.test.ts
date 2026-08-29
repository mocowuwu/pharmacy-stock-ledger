import { describe, expect, it } from "vitest";
import { itemInput, supplierInput } from "./validation";

const base = {
  genericName: "Amoxicillin",
  form: "capsule",
  unit: "kapsul",
  drugClass: "keras",
  code: "",
  brandName: "",
  strength: "",
  packSize: "",
  categoryId: "",
  nie: "",
  isTaxExempt: "",
  reorderPoint: "",
  reorderQty: "",
  defaultPrice: "",
  minShelfLifeDays: "",
  notes: "",
};

function parse(overrides: Record<string, string> = {}) {
  return itemInput.safeParse({ ...base, ...overrides });
}

describe("item form validation", () => {
  it("accepts a minimal item", () => {
    const result = parse();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.genericName).toBe("Amoxicillin");
      expect(result.data.reorderPoint).toBe(0);
      expect(result.data.defaultPrice).toBe(0);
      // Blank optional fields become null, not empty strings, so the database
      // holds one representation of "not set".
      expect(result.data.brandName).toBeNull();
      expect(result.data.packSize).toBeNull();
    }
  });

  it("reads an Indonesian-formatted price as typed at the counter", () => {
    // The whole reason prices do not go through Number(): "2.500" is two and a
    // half thousand rupiah, and parseFloat would make it two and a half.
    const result = parse({ defaultPrice: "2.500" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.defaultPrice).toBe(2500);
  });

  it("handles the prices a real catalogue contains", () => {
    for (const [typed, expected] of [
      ["2.500", 2500],
      ["150000", 150000],
      ["1.250.000", 1250000],
      ["Rp 8.000", 8000],
    ] as const) {
      const result = parse({ defaultPrice: typed });
      expect(result.success, typed).toBe(true);
      if (result.success) expect(result.data.defaultPrice, typed).toBe(expected);
    }
  });

  it("refuses a price it cannot read rather than guessing", () => {
    for (const bad of ["abc", "12x00", "15.000,00"]) {
      const result = parse({ defaultPrice: bad });
      expect(result.success, bad).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toBe("invalid_price");
      }
    }
  });

  it("requires the fields a batch cannot exist without", () => {
    expect(parse({ genericName: "" }).success).toBe(false);
    expect(parse({ unit: "" }).success).toBe(false);
    expect(parse({ drugClass: "not_a_class" }).success).toBe(false);
    expect(parse({ form: "not_a_form" }).success).toBe(false);
  });

  it("rejects fractional and negative quantities", () => {
    // You cannot stock half a capsule, and a negative reorder point is a typo.
    expect(parse({ reorderPoint: "10.5" }).success).toBe(false);
    expect(parse({ reorderPoint: "-5" }).success).toBe(false);
    expect(parse({ packSize: "0" }).success).toBe(false);
  });

  it("treats an unchecked tax-exemption box as false", () => {
    const unchecked = parse({ isTaxExempt: "" });
    const checked = parse({ isTaxExempt: "true" });
    expect(unchecked.success && unchecked.data.isTaxExempt).toBe(false);
    expect(checked.success && checked.data.isTaxExempt).toBe(true);
  });

  it("keeps every Indonesian drug class", () => {
    for (const value of [
      "bebas", "bebas_terbatas", "keras", "owa",
      "psikotropika", "narkotika", "jamu", "oht",
      "fitofarmaka", "alkes", "consumable",
    ]) {
      expect(parse({ drugClass: value }).success, value).toBe(true);
    }
  });
});

describe("supplier form validation", () => {
  it("requires a name and accepts everything else empty", () => {
    expect(supplierInput.safeParse({ name: "PT Sumber Sehat" }).success).toBe(true);
    expect(supplierInput.safeParse({ name: "" }).success).toBe(false);
  });

  it("checks the email only when one was given", () => {
    expect(supplierInput.safeParse({ name: "A", email: "" }).success).toBe(true);
    expect(supplierInput.safeParse({ name: "A", email: "a@b.co" }).success).toBe(true);
    expect(supplierInput.safeParse({ name: "A", email: "not-an-email" }).success).toBe(false);
  });
});
