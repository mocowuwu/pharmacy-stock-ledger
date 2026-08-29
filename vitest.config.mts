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
