import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/**
 * Locale-aware replacements for `next/link` and the navigation hooks. Use these
 * everywhere instead of the `next/*` originals, so no component has to remember
 * to prefix a href with the current locale.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
