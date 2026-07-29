import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import en from "../../../messages/en.json";

const usePathname = vi.hoisted(() => vi.fn(() => "/log"));

vi.mock("@/i18n/navigation", async () => {
  const { forwardRef } = await import("react");
  return {
    usePathname,
    Link: forwardRef<HTMLAnchorElement, Record<string, unknown>>(
      ({ href, locale, children, ...rest }, ref) => (
        <a ref={ref} href={`/${locale}${href}`} {...rest}>
          {children as React.ReactNode}
        </a>
      ),
    ),
  };
});

const { LanguageSwitcher } = await import("./language-switcher");

function renderSwitcher(locale: "en" | "es" = "en") {
  render(
    <NextIntlClientProvider locale={locale} messages={en} timeZone="UTC">
      <LanguageSwitcher />
    </NextIntlClientProvider>,
  );
}

describe("LanguageSwitcher", () => {
  it("offers every routed locale as a real link", () => {
    // Links, not a select: they work before hydration and can be opened in a
    // new tab.
    renderSwitcher();
    expect(screen.getByRole("link", { name: "English" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Español" })).toBeInTheDocument();
  });

  it("keeps the reader on the page they were already on", () => {
    // Sending someone back to the home page to change language loses their
    // place — a small thing that feels broken every time.
    renderSwitcher();
    expect(screen.getByRole("link", { name: "Español" })).toHaveAttribute("href", "/es/log");
  });

  it("marks the active language for assistive tech, not just visually", () => {
    renderSwitcher("es");
    expect(screen.getByRole("link", { name: "Español" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("link", { name: "English" })).not.toHaveAttribute("aria-current");
  });

  it("tags each link with its own language so it is pronounced correctly", () => {
    // Without `lang`, a screen reader reads "Español" with an English voice.
    renderSwitcher();
    const spanish = screen.getByRole("link", { name: "Español" });
    expect(spanish).toHaveAttribute("lang", "es");
    expect(spanish).toHaveAttribute("hreflang", "es");
  });

  it("labels the group so it is not just two loose links", () => {
    renderSwitcher();
    expect(screen.getByRole("navigation", { name: "Language" })).toBeInTheDocument();
  });
});
