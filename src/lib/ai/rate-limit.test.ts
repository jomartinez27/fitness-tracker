import { describe, expect, it } from "vitest";
import { clientKey, createTokenBucket } from "./rate-limit";

describe("createTokenBucket", () => {
  it("allows a full burst and then refuses", () => {
    const bucket = createTokenBucket({ capacity: 3, refillIntervalMs: 1000 });
    const now = 0;
    expect([1, 2, 3].map(() => bucket.take("a", now).allowed)).toEqual([true, true, true]);
    expect(bucket.take("a", now).allowed).toBe(false);
  });

  it("refills over time", () => {
    const bucket = createTokenBucket({ capacity: 2, refillIntervalMs: 1000 });
    bucket.take("a", 0);
    bucket.take("a", 0);
    expect(bucket.take("a", 0).allowed).toBe(false);
    expect(bucket.take("a", 1000).allowed).toBe(true);
  });

  it("never refills above capacity", () => {
    // Otherwise a caller who waits an hour earns an hour's worth of burst.
    const bucket = createTokenBucket({ capacity: 2, refillIntervalMs: 1000 });
    bucket.take("a", 0);
    const farFuture = 60 * 60 * 1000;
    expect(bucket.take("a", farFuture).allowed).toBe(true);
    expect(bucket.take("a", farFuture).allowed).toBe(true);
    expect(bucket.take("a", farFuture).allowed).toBe(false);
  });

  it("keeps callers independent", () => {
    const bucket = createTokenBucket({ capacity: 1, refillIntervalMs: 1000 });
    expect(bucket.take("a", 0).allowed).toBe(true);
    expect(bucket.take("a", 0).allowed).toBe(false);
    expect(bucket.take("b", 0).allowed).toBe(true);
  });

  it("reports a usable retry-after", () => {
    const bucket = createTokenBucket({ capacity: 1, refillIntervalMs: 10_000 });
    bucket.take("a", 0);
    const refused = bucket.take("a", 0);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(10);
  });

  it("never reports retry-after zero when refusing", () => {
    // A `Retry-After: 0` invites an immediate retry, turning a limit into a
    // tight loop.
    const bucket = createTokenBucket({ capacity: 1, refillIntervalMs: 100 });
    bucket.take("a", 0);
    expect(bucket.take("a", 0).retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("stays bounded when sprayed with unique keys", () => {
    // The defence must not become the vulnerability: an unbounded map keyed by
    // a spoofable header is a memory-exhaustion vector.
    const bucket = createTokenBucket({
      capacity: 1,
      refillIntervalMs: 1000,
      maxKeys: 50,
    });
    for (let i = 0; i < 5000; i += 1) bucket.take(`ip-${i}`, i);
    expect(bucket.size).toBeLessThanOrEqual(100);
  });

  it("can be made to forget a limited caller under a key flood — a known hole", () => {
    // Documented rather than papered over. The key map must be bounded, so a
    // flood of unique (spoofable) addresses forces evictions, and no policy
    // reliably spares the attacker's own bucket. Every keyed limiter with
    // finite memory has this hole.
    //
    // It is why the route also consults an unkeyed global limiter: that one has
    // nothing to spray. See `globalModelCallLimiter`.
    const bucket = createTokenBucket({
      capacity: 1,
      refillIntervalMs: 60_000,
      maxKeys: 10,
    });
    bucket.take("attacker", 0);
    expect(bucket.take("attacker", 0).allowed).toBe(false);

    for (let i = 0; i < 500; i += 1) bucket.take(`noise-${i}`, 1000 + i);

    // Evicted, so the limit was evaded. Asserting it keeps the limitation
    // visible: if a future change closes it, this test fails and gets removed
    // deliberately rather than the hole being rediscovered in production.
    expect(bucket.take("attacker", 2000).allowed).toBe(true);
    expect(bucket.size).toBeLessThanOrEqual(100);
  });
});

describe("the unkeyed global limiter", () => {
  it("cannot be evaded by spraying keys, because there is no key", () => {
    // The control that actually bounds spend under attack.
    const global = createTokenBucket({ capacity: 3, refillIntervalMs: 10_000 });
    const allowed = Array.from({ length: 500 }, (_, i) =>
      global.take("__all__", i).allowed,
    ).filter(Boolean).length;

    expect(allowed).toBe(3);
  });

  it("recovers on the same schedule as any other bucket", () => {
    const global = createTokenBucket({ capacity: 1, refillIntervalMs: 10_000 });
    expect(global.take("__all__", 0).allowed).toBe(true);
    expect(global.take("__all__", 5_000).allowed).toBe(false);
    expect(global.take("__all__", 10_000).allowed).toBe(true);
  });
});

describe("clientKey", () => {
  it("prefers the header the edge sets over the one a client can send", () => {
    const headers = new Headers({
      "x-forwarded-for": "1.2.3.4",
      "x-vercel-forwarded-for": "9.9.9.9",
    });
    expect(clientKey(headers)).toBe("9.9.9.9");
  });

  it("takes the leftmost entry of a forwarding chain", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });

  it("buckets unidentifiable callers together rather than exempting them", () => {
    // Failing open here would be an open door: spoof an unparseable header,
    // skip the limit entirely.
    expect(clientKey(new Headers())).toBe("unknown");
  });

  it("refuses an absurdly long value instead of using it as a key", () => {
    const headers = new Headers({ "x-forwarded-for": "x".repeat(500) });
    expect(clientKey(headers)).toBe("unknown");
  });
});
