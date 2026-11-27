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
    /*
     * Android 7 is the oldest phone the app supports, and its WebView is
     * whatever the Play Store last installed -- possibly years old. Chrome 61
     * is the floor because it is the first to run module scripts, which is
     * how Vite loads the app; esbuild rewrites newer syntax (optional
     * chaining, `??`, class fields, object spread) down to it. Library calls
     * newer than that are filled in by src/polyfills.ts, and a WebView older
     * still gets index.html's "update your WebView" notice, not a blank
     * screen. `es2020` here used to mean Chrome 80: on anything older the
     * script failed to parse and the phone never got past the launch screen.
     */
    target: "chrome61",
    cssTarget: "chrome61",
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
