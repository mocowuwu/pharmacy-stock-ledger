import { afterEach, describe, expect, it } from "vitest";
import { databaseUrl } from "./client";

const saved = { DATABASE_URL: process.env.DATABASE_URL, POSTGRES_URL: process.env.POSTGRES_URL };
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function set(database?: string, postgres?: string) {
  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  if (database) process.env.DATABASE_URL = database;
  if (postgres) process.env.POSTGRES_URL = postgres;
}

describe("databaseUrl", () => {
  it("leaves a clinic install's local string exactly as written", () => {
    set("postgres://pharmacy@127.0.0.1:5432/pharmacy");
    expect(databaseUrl()).toBe("postgres://pharmacy@127.0.0.1:5432/pharmacy");
  });

  it("falls back to POSTGRES_URL, the name Supabase's Vercel integration writes", () => {
    set(undefined, "postgres://u@pooler.example.com:6543/postgres");
    expect(databaseUrl()).toBe("postgres://u@pooler.example.com:6543/postgres");
  });

  it("prefers DATABASE_URL when both are set", () => {
    set("postgres://a@h/db", "postgres://b@h/db");
    expect(databaseUrl()).toBe("postgres://a@h/db");
  });

  it("gives sslmode=require its libpq meaning", () => {
    set(undefined, "postgres://u@h:6543/postgres?sslmode=require&supa=base-pooler.x");
    expect(databaseUrl()).toBe(
      "postgres://u@h:6543/postgres?sslmode=require&supa=base-pooler.x&uselibpqcompat=true",
    );
  });

  it("does not override an explicit choice, or touch verify-full", () => {
    set("postgres://u@h/db?sslmode=require&uselibpqcompat=false");
    expect(databaseUrl()).toBe("postgres://u@h/db?sslmode=require&uselibpqcompat=false");
    set("postgres://u@h/db?sslmode=verify-full");
    expect(databaseUrl()).toBe("postgres://u@h/db?sslmode=verify-full");
  });

  it("is undefined with nothing set, which means the in-memory test database", () => {
    set();
    expect(databaseUrl()).toBeUndefined();
  });
});
