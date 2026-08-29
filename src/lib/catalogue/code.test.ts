import { describe, expect, it } from "vitest";
import { codePrefix, nextCode, normaliseCode } from "./code";

describe("codePrefix", () => {
  it("takes four letters from the generic name", () => {
    expect(codePrefix("Amoxicillin")).toBe("AMOX");
    expect(codePrefix("Paracetamol")).toBe("PARA");
  });

  it("ignores spacing and punctuation", () => {
    expect(codePrefix("Vitamin B-Complex")).toBe("VITA");
    expect(codePrefix("N-Acetylcysteine")).toBe("NACE");
  });

  it("pads a very short name rather than producing a one-letter prefix", () => {
    expect(codePrefix("Zn")).toBe("ZNX");
  });

  it("falls back for a name with no usable characters", () => {
    expect(codePrefix("   ")).toBe("ITM");
    expect(codePrefix("---")).toBe("ITM");
  });
});

describe("nextCode", () => {
  it("starts at 001", () => {
    expect(nextCode("AMOX", [])).toBe("AMOX001");
  });

  it("continues from the highest existing number", () => {
    expect(nextCode("AMOX", ["AMOX001", "AMOX002"])).toBe("AMOX003");
  });

  it("does not reuse a gap", () => {
    // A code that once meant one item must not later mean another, or an old
    // count sheet silently refers to the wrong thing.
    expect(nextCode("AMOX", ["AMOX001", "AMOX003"])).toBe("AMOX004");
  });

  it("ignores codes belonging to other prefixes", () => {
    expect(nextCode("AMOX", ["PARA009", "AMOX001"])).toBe("AMOX002");
  });

  it("keeps counting past three digits", () => {
    expect(nextCode("AMOX", ["AMOX999"])).toBe("AMOX1000");
  });
});

describe("normaliseCode", () => {
  it("uppercases and strips whitespace", () => {
    expect(normaliseCode("  amox 001 ")).toBe("AMOX001");
  });
});
