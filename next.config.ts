import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // The database driver and argon2 bindings must stay on the server rather than
  // being traced into any client bundle.
  serverExternalPackages: ["pg", "@electric-sql/pglite", "@node-rs/argon2"],
};

export default withNextIntl(nextConfig);
