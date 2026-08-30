import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const here = import.meta.dirname;

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    // Each integration test builds its own in-memory database; running files in
    // parallel processes keeps them isolated without any shared fixture.
    testTimeout: 30_000,
    // Each file's `beforeAll` builds a database: PGlite's wasm has to compile
    // and the migrations have to run, and on a cold cache with 19 files
    // starting at once that passes vitest's 10s default and the whole file
    // fails on a timeout rather than on anything it was testing.
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": resolve(here, "src"),
      // `server-only` throws outside a React Server Component. The modules
      // under test are genuinely server-side, so the marker is stubbed rather
      // than the guard removed from the source.
      "server-only": resolve(here, "tests/helpers/server-only-stub.ts"),
    },
  },
});
