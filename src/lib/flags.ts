/**
 * Every feature flag, in one file.
 *
 * The value of centralising this is not indirection — it is that the rollout
 * story is legible from a single place, and that turning the AI feature off in
 * production is one environment variable rather than a code change.
 *
 * `NEXT_PUBLIC_*` values are inlined at build time, so they must be referenced
 * as complete literals; `process.env[name]` would silently read undefined.
 */

const isEnabled = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1";
};

/** Readable on the client. Controls whether the AI surface is offered at all. */
export const publicFlags = {
  ai: isEnabled(process.env.NEXT_PUBLIC_FEATURE_AI),
} as const;

/**
 * Server-only, and deliberately separate from the public flag.
 *
 * Hiding UI is not a kill switch: the route is a public URL whether or not
 * anything links to it. `/api/extract` therefore checks its own flag, so the
 * endpoint can be shut off independently of what the client believes
 * (ADR-0003).
 */
export const serverFlags = {
  aiRoute: isEnabled(process.env.FEATURE_AI_ROUTE, publicFlags.ai),
} as const;
