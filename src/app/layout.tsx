import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import "./globals.css";

// Bundled in ./fonts, not fetched from Google at build time: the build runs on
// the pharmacy's own machine at every install and update, and a clinic
// connection that could not reach fonts.googleapis.com failed it outright.
// See fonts/README.md.
//
// Plus Jakarta Sans: the design reference's body face. Legible at small sizes,
// which matters here for dosage instructions and inventory codes.
const sans = localFont({
  src: "./fonts/PlusJakartaSans-Variable.woff2",
  weight: "200 800",
  variable: "--font-jakarta-sans",
});
// Geist Mono stays for batch numbers and document IDs -- it disambiguates
// 0/O and 1/l, which matters more for ledger legibility than matching the
// reference's Courier Prime.
const mono = localFont({
  src: "./fonts/GeistMono-Variable.woff2",
  weight: "100 900",
  variable: "--font-geist-mono",
});

/**
 * Stated rather than left to the framework's default, because the till is run
 * on a phone: without `width=device-width` a mobile browser lays the page out
 * at 980px and scales it down, which turns every button into a target the
 * cashier has to pinch-zoom to hit. Zooming is left enabled -- a pharmacist
 * reading an expiry date off a small screen has every reason to.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The sidebar colour, so the browser chrome and the app agree at the edges.
  themeColor: "#221c33",
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return { title: t("name"), description: t("tagline") };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The locale comes from the signed-in user's own preference, not the URL --
  // see src/i18n/config.ts for why the two are kept apart.
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html
      lang={locale}
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
