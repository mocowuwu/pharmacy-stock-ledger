import { describe, expect, it } from "vitest";
import { cronAuthorized } from "./cron";

describe("cronAuthorized", () => {
  it("accepts the bearer secret", () => {
    expect(cronAuthorized("Bearer s3cret", "s3cret")).toBe(true);
  });

  it("refuses a missing or wrong header", () => {
    expect(cronAuthorized(null, "s3cret")).toBe(false);
    expect(cronAuthorized("Bearer nope", "s3cret")).toBe(false);
    expect(cronAuthorized("s3cret", "s3cret")).toBe(false);
  });

  it("refuses everything when no secret is set, as on a clinic install", () => {
    expect(cronAuthorized("Bearer ", undefined)).toBe(false);
    expect(cronAuthorized("Bearer ", "")).toBe(false);
    expect(cronAuthorized("Bearer undefined", undefined)).toBe(false);
  });
});
