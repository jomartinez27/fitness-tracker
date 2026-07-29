import createMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Everything except API routes, Next internals, and anything with a file
  // extension. `/api/extract` must not be locale-prefixed — it is a machine
  // endpoint, not a page.
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
