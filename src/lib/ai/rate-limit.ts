/**
 * Per-IP token buckets guarding the extraction route (risk R1).
 *
 * Two tiers, because the two things being protected are different:
 *
 *  - **Spend.** Exceeding the model budget serves the deterministic extractor
 *    instead. The caller still gets a usable answer; we stop paying for it.
 *    A 429 here would punish a keen user for the failure of a control that
 *    exists to protect *us*.
 *  - **Resources.** Far above that, a caller is not using the product, and gets
 *    a 429. Serving free CPU and bandwidth indefinitely is its own denial of
 *    service.
 *
 * Honest about what this is: in-memory, so it holds per serverless instance and
 * resets on cold start. It is a speed bump that bounds the blast radius, not a
 * guarantee. The durable version is #31; the hard cap on spend remains the
 * credit balance on the account.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Whole seconds until a token is available — the `Retry-After` value. */
  retryAfterSeconds: number;
}

export interface TokenBucketOptions {
  /** Burst size, and the ceiling tokens refill to. */
  capacity: number;
  /** Time to regain one token. Capacity ÷ this is the sustained rate. */
  refillIntervalMs: number;
  /**
   * Cap on tracked keys.
   *
   * A map keyed by client address is itself an attack surface — spraying
   * spoofed addresses would grow it without bound until the instance dies. This
   * is the limit that makes the defence not become the vulnerability.
   */
  maxKeys?: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export function createTokenBucket({
  capacity,
  refillIntervalMs,
  maxKeys = 10_000,
}: TokenBucketOptions) {
  const buckets = new Map<string, Bucket>();

  const refilledTokens = (bucket: Bucket, now: number) =>
    Math.min(capacity, bucket.tokens + (now - bucket.updatedAt) / refillIntervalMs);

  /**
   * Evicts by how full a bucket is, never by how old it is.
   *
   * Oldest-first is the obvious policy and it is wrong here: a caller who is
   * being limited is precisely the one whose bucket must be remembered, and
   * they are often the least recently *successful*. Evicting them hands out a
   * fresh allowance — so spraying junk keys would flush your own bucket and
   * defeat the limit entirely.
   *
   * A fully refilled bucket, by contrast, is indistinguishable from a caller we
   * have never seen, so dropping it costs nothing.
   */
  function evict(now: number) {
    const scored = [...buckets.entries()].map(
      ([key, bucket]) => [key, refilledTokens(bucket, now)] as const,
    );

    for (const [key, tokens] of scored) {
      if (tokens >= capacity) buckets.delete(key);
    }
    if (buckets.size <= maxKeys) return;

    // Still over budget: a genuine flood. Drop the fullest survivors first so
    // the callers closest to their limit are the last to be forgotten.
    const survivors = scored
      .filter(([key]) => buckets.has(key))
      .sort((a, b) => b[1] - a[1]);
    for (const [key] of survivors.slice(0, buckets.size - maxKeys)) {
      buckets.delete(key);
    }
  }

  return {
    take(key: string, now: number = Date.now()): RateLimitResult {
      if (buckets.size > maxKeys) evict(now);

      const existing = buckets.get(key);
      const tokens = existing
        ? Math.min(
            capacity,
            existing.tokens + (now - existing.updatedAt) / refillIntervalMs,
          )
        : capacity;

      if (tokens < 1) {
        buckets.set(key, { tokens, updatedAt: now });
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil(((1 - tokens) * refillIntervalMs) / 1000)),
        };
      }

      buckets.set(key, { tokens: tokens - 1, updatedAt: now });
      return { allowed: true, retryAfterSeconds: 0 };
    },

    /** Test seam, and a way to clear state without restarting. */
    reset() {
      buckets.clear();
    },

    get size() {
      return buckets.size;
    },
  };
}

/**
 * Per-caller spend guard: 5 model calls back to back, then one every 12s.
 * At Opus 5 pricing that caps a single caller at roughly four cents a minute.
 */
export const modelCallLimiter = createTokenBucket({
  capacity: 5,
  refillIntervalMs: 12_000,
});

/**
 * Instance-wide spend ceiling, and the control that actually holds under attack.
 *
 * Per-caller limiting has a hole that no eviction policy closes: the key map
 * must be bounded, so a flood of unique (and spoofable) addresses will always
 * force *something* out — including the attacker's own bucket, handing them a
 * fresh allowance. Every keyed limiter with finite memory shares this.
 *
 * This one is keyed by nothing, so there is nothing to spray. It cannot deliver
 * fairness — a flood will exhaust it and push legitimate users onto the local
 * extractor — but that is the correct failure: everyone keeps a working feature
 * and the bill stops. Roughly 30 model calls a minute, about 25 cents.
 */
export const GLOBAL_KEY = "__all__";

export const globalModelCallLimiter = createTokenBucket({
  capacity: 60,
  refillIntervalMs: 2_000,
});

/** Resource guard: ~60 requests/minute before the endpoint stops answering. */
export const requestLimiter = createTokenBucket({
  capacity: 60,
  refillIntervalMs: 1_000,
});

/**
 * Best-effort client identity.
 *
 * `x-forwarded-for` is client-supplied and therefore spoofable in general; on
 * Vercel the proxy sets it, so the leftmost entry is the real client. Vercel's
 * own `x-vercel-forwarded-for` is preferred where present because it is set
 * behind the edge rather than accepted from the wire.
 *
 * Anything unidentifiable shares one bucket. That is deliberate: unknown
 * callers being rate-limited collectively is the safe direction to fail, and
 * the alternative — exempting them — is an open door.
 */
export function clientKey(headers: Headers): string {
  const candidate =
    headers.get("x-vercel-forwarded-for") ??
    headers.get("x-real-ip") ??
    headers.get("x-forwarded-for");

  const first = candidate?.split(",")[0]?.trim();
  return first && first.length <= 64 ? first : "unknown";
}
