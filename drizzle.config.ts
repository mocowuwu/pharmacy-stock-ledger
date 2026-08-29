import type { Config } from "drizzle-kit";

/**
 * Migrations are generated against a real Postgres dialect regardless of which
 * driver runs them, so the SQL is identical for PGlite (development) and a
 * Postgres server (production).
 */
export default {
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/pharmacy",
  },
  strict: true,
  verbose: true,
} satisfies Config;
