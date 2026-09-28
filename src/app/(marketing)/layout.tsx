import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { inter, plexArabic } from "@/lib/fonts";
import { Providers } from "@/components/providers";
import { dirOf, isLocale } from "@/i18n/routing";
import "../globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return {
    title: t("title"),
    description: t("description"),
    manifest: "/manifest.webmanifest",
    icons: { icon: "/icon.svg", apple: "/icon-192.png" },
  };
}

export const viewport: Viewport = { themeColor: "#123a63", width: "device-width", initialScale: 1 };

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const raw = await getLocale();
  const locale = isLocale(raw) ? raw : "en";
  const dir = dirOf(locale);
  const messages = await getMessages();
  return (
    <html lang={locale} dir={dir} className={`${inter.variable} ${plexArabic.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers dir={dir}>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
