import type { CapacitorConfig } from "@capacitor/cli";
// Versioned with the pharmacy release it ships in (see android/app/build.gradle).
import pkg from "../package.json";

/**
 * The shell is served from https://localhost -- the origin the server's CORS
 * rule allows. The pharmacy server's address is only known once the device is
 * set up, so it is not in `allowNavigation`: a wildcard there would make
 * Capacitor proxy every request to the server through its own HTTP client
 * (breaking cookies and uploads). `LedgerWebViewClient` keeps navigation to
 * the one saved server origin inside the WebView instead.
 *
 * `errorPath` is deliberately not set: Capacitor would show it for every
 * main-frame HTTP error, so a website 404 would look like "server down". The
 * native client sends only connection failures and gateway errors (Tailscale
 * Serve answers 502 when the pharmacy server is stopped) to the offline screen.
 */
const config: CapacitorConfig = {
  appId: "id.cuanison.pharmacyledger",
  appName: "Apotek",
  webDir: "dist",
  server: {
    androidScheme: "https",
    // A plain http:// LAN address must work as well as the Tailscale https one.
    cleartext: true,
  },
  plugins: {
    // MainActivity pads the page clear of the bars itself, the same on every
    // WebView version; Capacitor only sets light icons on the dark chrome.
    SystemBars: {
      insetsHandling: "disable",
      style: "DARK",
    },
  },
  android: {
    allowMixedContent: true,
    appendUserAgent: `PharmacyLedgerApp/${pkg.version}`,
    backgroundColor: "#221c33",
  },
};

export default config;
