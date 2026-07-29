import { defineRouting } from "next-intl/routing";

/**
 * Locale-routed URLs, English and Spanish.
 *
 * Adding `es` was one entry here plus a message file — which is exactly what
 * paying the routing cost up front in v0 bought. Retrofitting locale segments
 * into a finished app is the expensive version of this change.
 */
export const routing = defineRouting({
  locales: ["en", "es"],
  defaultLocale: "en",
  localePrefix: "always",
});

export type Locale = (typeof routing.locales)[number];
