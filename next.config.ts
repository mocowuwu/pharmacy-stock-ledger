import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * The private-network ranges, for `allowedDevOrigins` below.
 *
 * Written as ranges rather than as one machine's address because the address
 * is handed out by the router and changes; pinning today's IP would work until
 * the next power cut.
 */
const PRIVATE_LAN = [
  "192.168.*.*",
  "10.*.*.*",
  ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}.*.*`),
  // Bonjour names, which is how a Mac is reachable without knowing its IP.
  "*.local",
];

const nextConfig: NextConfig = {
  /**
   * Development only, and it has no effect on a production build.
   *
   * `next dev` refuses to serve its own JavaScript chunks to a page loaded from
   * an origin it was not started on -- it answers 403. Opening the till from a
   * phone on the LAN does exactly that: the address is the machine's IP, not
   * localhost. The page still renders, because the HTML comes from the server,
   * so the failure looks like nothing rather than an error -- every button is
   * present and dead, because React never hydrates.
   *
   * Testing on a phone is the point of the barcode camera, so the LAN has to
   * work.
   */
  allowedDevOrigins: PRIVATE_LAN,

  // The database driver and argon2 bindings must stay on the server rather than
  // being traced into any client bundle.
  serverExternalPackages: ["pg", "@electric-sql/pglite", "@node-rs/argon2"],
};

export default withNextIntl(nextConfig);
