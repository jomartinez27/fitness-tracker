import { defineRouting } from "next-intl/routing";

/**
 * Locale-routed URLs from v0, with only English shipped.
 *
 * `es` is deliberately absent until its catalogue exists (#24) — declaring a
 * locale we can't serve would route real users to a half-translated page.
 * Adding it is one entry here plus a message file, which is the whole point of
 * paying the routing cost up front rather than retrofitting it.
 */
export const routing = defineRouting({
  locales: ["en"],
  defaultLocale: "en",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
