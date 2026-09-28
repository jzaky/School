import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { inter, plexArabic } from "@/lib/fonts";
import { Providers } from "@/components/providers";
import { dirOf, isLocale } from "@/i18n/routing";
import "../../globals.css";

// Every product page depends on the signed-in user, so nothing under [locale] is prerendered.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: isLocale(locale) ? locale : "en", namespace: "meta" });
  return {
    title: { default: t("appTitle"), template: `%s · ${t("appTitle")}` },
    description: t("description"),
    manifest: "/manifest.webmanifest",
    icons: { icon: "/icon.svg", apple: "/icon-192.png" },
    appleWebApp: { capable: true, title: t("appShort"), statusBarStyle: "default" },
  };
}

export const viewport: Viewport = { themeColor: "#123a63", width: "device-width", initialScale: 1 };

export default async function AppLocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
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
