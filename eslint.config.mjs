import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Android app's screens are linted with the website's rules; its
    // native project, build output and dependencies are not source.
    "mobile/android/**",
    "mobile/dist/**",
    "mobile/node_modules/**",
    "mobile/release/**",
  ]),
]);

export default eslintConfig;
