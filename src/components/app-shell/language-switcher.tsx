"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";

/**
 * Links, not a `<select>`.
 *
 * A select needs JavaScript to navigate and gives each language no URL of its
 * own; links work before hydration, can be opened in a new tab, and are
 * crawlable. `hrefLang` states what is on the other end, and `lang` on the
 * label makes a screen reader pronounce "Español" in Spanish rather than
 * reading it with an English voice.
 */
export function LanguageSwitcher() {
  const t = useTranslations("language");
  const pathname = usePathname();
  const active = useLocale();

  return (
    <nav aria-label={t("label")} className="shrink-0">
      <ul className="flex items-center gap-0.5 whitespace-nowrap">
        {routing.locales.map((locale: Locale) => {
          const current = locale === active;
          return (
            <li key={locale}>
              <Link
                // `pathname` here is locale-agnostic, so this preserves the
                // page the reader is on instead of dumping them at the root.
                href={pathname}
                locale={locale}
                hrefLang={locale}
                lang={locale}
                aria-current={current ? "true" : undefined}
                className={[
                  "rounded px-1.5 py-1 text-xs transition-colors",
                  current
                    ? "font-semibold text-ink"
                    : "text-ink-muted hover:bg-hover-wash hover:text-ink",
                ].join(" ")}
              >
                {t(locale)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
