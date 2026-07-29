import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Geist, Geist_Mono } from "next/font/google";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { RepositoryProvider } from "@/lib/repository/provider";
import { SiteHeader } from "@/components/app-shell/site-header";
import { StorageBanner } from "@/components/app-shell/storage-banner";
import "../globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app" });
  return { title: t("name"), description: t("tagline") };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();

  // Opts this route into static rendering; without it every page becomes
  // dynamic the moment a translation is read.
  setRequestLocale(locale);
  const t = await getTranslations("app");

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-plane text-ink">
        <NextIntlClientProvider>
          <RepositoryProvider>
            {/* First tab stop on every page. */}
            <a
              href="#main"
              className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:border focus:border-line focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium"
            >
              {t("skipToContent")}
            </a>

            <SiteHeader />
            <StorageBanner />

            <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
              <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
                {children}
              </div>
            </main>
          </RepositoryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
