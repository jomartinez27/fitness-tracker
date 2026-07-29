"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

const NAV = [
  { href: "/", key: "dashboard" },
  { href: "/log", key: "log" },
] as const;

export function SiteHeader() {
  const t = useTranslations("app");
  const pathname = usePathname();

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          {t("name")}
        </Link>

        <nav aria-label={t("nav.label")}>
          <ul className="flex items-center gap-1">
            {NAV.map(({ href, key }) => {
              const current = pathname === href;
              return (
                <li key={href}>
                  <Link
                    href={href}
                    // aria-current is what tells a screen reader which page it
                    // is on; the styling below is only the sighted equivalent.
                    aria-current={current ? "page" : undefined}
                    className={[
                      "rounded-md px-3 py-1.5 text-sm transition-colors",
                      current
                        ? "bg-hover-wash font-semibold text-ink"
                        : "text-ink-2 hover:bg-hover-wash hover:text-ink",
                    ].join(" ")}
                  >
                    {t(`nav.${key}`)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </header>
  );
}
