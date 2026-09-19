import { describe, expect, it } from "vitest";
import { isSafeNextPath } from "./redirect";

describe("the sign-in redirect", () => {
  it("allows paths on this site", () => {
    expect(isSafeNextPath("/sell")).toBe(true);
    expect(isSafeNextPath("/sales/abc?x=1")).toBe(true);
  });

  it("refuses anything that leaves the site", () => {
    expect(isSafeNextPath("//evil.example")).toBe(false);
    // Browsers read the backslash as a slash: this is //evil.example.
    expect(isSafeNextPath("/\\evil.example")).toBe(false);
    expect(isSafeNextPath("/\t/evil.example")).toBe(false);
    expect(isSafeNextPath("https://evil.example")).toBe(false);
    expect(isSafeNextPath("")).toBe(false);
    expect(isSafeNextPath(null)).toBe(false);
  });
});
