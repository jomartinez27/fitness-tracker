"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { publicFlags } from "@/lib/flags";
import { LanguageSwitcher } from "./language-switcher";

const NAV = [
  { href: "/", key: "dashboard" },
  { href: "/log", key: "log" },
  // Only linked when the AI feature is on; the page itself 404s otherwise, so
  // the two cannot drift out of step.
  ...(publicFlags.ai ? ([{ href: "/describe", key: "describe" }] as const) : []),
] as const;

export function SiteHeader() {
  const t = useTranslations("app");
  const pathname = usePathname();

  return (
    <header className="border-b border-line bg-surface">
      {/*
        Spanish labels run ~20% longer than English, and at 380px they wrapped
        mid-phrase — "Registrar / sesión" split the active pill into two
        overlapping backgrounds. Two fixes, both needed: labels never wrap, and
        below `sm` the nav takes its own full-width row and scrolls sideways if
        it still doesn't fit. Scrolling a nav is a small cost; a header that
        looks broken in one of your two languages is not.
      */}
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          {t("name")}
        </Link>

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <nav
            aria-label={t("nav.label")}
            // The fade is the only cue that the row scrolls — without it a
            // third item sits just off-screen looking like it doesn't exist.
            // Mobile only: above `sm` everything fits and a fade would just be
            // an unexplained gradient. Keyboard and screen-reader users reach
            // the item regardless; this is for the eye.
            className="min-w-0 flex-1 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-1.25rem),transparent)] sm:flex-none sm:[mask-image:none]"
          >
            <ul className="flex items-center gap-1 whitespace-nowrap">
              {NAV.map(({ href, key }) => {
                const current = pathname === href;
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      // aria-current is what tells a screen reader which page
                      // it is on; the styling is only the sighted equivalent.
                      aria-current={current ? "page" : undefined}
                      className={[
                        "rounded-md px-2.5 py-1.5 text-sm transition-colors sm:px-3",
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

          <span aria-hidden="true" className="h-4 w-px bg-line" />
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
