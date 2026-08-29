import { describe, expect, it } from "vitest";
import {
  generateTemporaryPassword,
  hashPassword,
  hashToken,
  verifyPassword,
} from "./password";
import { checkPasswordPolicy } from "./password-policy";

describe("password hashing", () => {
  it("produces an argon2id hash and verifies it", async () => {
    const hash = await hashPassword("a-perfectly-fine-password");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "a-perfectly-fine-password")).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("a-perfectly-fine-password");
    expect(await verifyPassword(hash, "a-perfectly-fine-passwora")).toBe(false);
    expect(await verifyPassword(hash, "")).toBe(false);
  });

  it("salts, so the same password hashes differently each time", async () => {
    const a = await hashPassword("identical-input-here");
    const b = await hashPassword("identical-input-here");
    expect(a).not.toBe(b);
  });

  it("treats a malformed stored hash as a failed login, not an error", async () => {
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
    expect(await verifyPassword("", "anything")).toBe(false);
  });
});

describe("temporary passwords", () => {
  it("omits characters that are misread when written on paper", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateTemporaryPassword()).not.toMatch(/[01losizLOSIZ2]/u);
    }
  });

  it("is unique across generations", () => {
    const seen = new Set(Array.from({ length: 500 }, generateTemporaryPassword));
    expect(seen.size).toBe(500);
  });
});

describe("password policy", () => {
  it("requires real length", () => {
    expect(checkPasswordPolicy("short")).toContain("too_short");
    expect(checkPasswordPolicy("long-enough-password")).toEqual([]);
  });

  it("blocks the obvious ones and reuse of the username", () => {
    expect(checkPasswordPolicy("password")).toContain("too_common");
    expect(checkPasswordPolicy("apotek123")).toContain("too_common");
    expect(checkPasswordPolicy("budisantoso", { username: "budisantoso" }))
      .toContain("same_as_username");
  });
});

describe("session token hashing", () => {
  it("is stable and does not return the token", () => {
    const token = "some-random-session-token";
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toHaveLength(64);
  });
});
