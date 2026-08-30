import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
