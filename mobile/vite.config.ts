import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * The app bundles a handful of the server's own modules (`@/` is the server's
 * `src/`) so that the offline till computes totals, FEFO and expiry exactly as
 * the server does. Those modules read `process.env` for a default timezone;
 * the till always passes the snapshot's timezone explicitly, and the `define`
 * below only stops a stray read from throwing in the WebView.
 */
const serverSrc = fileURLToPath(new URL("../src", import.meta.url));

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${serverSrc}/` },
    ],
  },
  define: {
    "process.env": {},
  },
  server: {
    // The shared modules live one level up.
    fs: { allow: [".."] },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2020",
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
