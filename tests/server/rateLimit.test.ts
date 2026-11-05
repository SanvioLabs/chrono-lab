// tests/server/rateLimit.test.ts
// Task 7 (R-09): the token-bucket rate limiter.
//
// A burst past the per-session record limit is rejected; a burst past the
// per-IP limit is rejected (even with no session cookie); a burst past the
// global limit is rejected; buckets refill over time. check(key, nowMs) takes
// the clock, so a test advances nowMs to exercise refill without real waiting.
//
// Written before createRateLimiter is implemented. Until then it throws
// "not implemented" and every case fails.

import { describe, it, expect } from "vitest";
import { createRateLimiter } from "../../src/server/rateLimit.js";
import type { RateLimitConfig } from "../../src/server/rateLimit.js";

const BASE: RateLimitConfig = {
  recordPerSessionPerMin: 3,
  forkPerSessionPerMin: 5,
  perIpPerMin: 100,
  globalPerMin: 1000,
};

const T0 = 1_000_000;

describe("rate limiter per-session record bucket", () => {
  it("rejects a burst past the per-session record limit", () => {
    const limiter = createRateLimiter(BASE);
    const key = { action: "record" as const, ip: "1.1.1.1", sessionId: "s1" };

    // The first recordPerSessionPerMin calls pass at the same instant.
    for (let i = 0; i < BASE.recordPerSessionPerMin; i++) {
      expect(limiter.check(key, T0).allowed).toBe(true);
    }
    // The next one is rejected with a plain reason.
    const over = limiter.check(key, T0);
    expect(over.allowed).toBe(false);
    if (!over.allowed) {
      expect(typeof over.reason).toBe("string");
      expect(over.reason.length).toBeGreaterThan(0);
    }
  });

  it("refills the per-session record bucket over time", () => {
    const limiter = createRateLimiter(BASE);
    const key = { action: "record" as const, ip: "2.2.2.2", sessionId: "s2" };

    for (let i = 0; i < BASE.recordPerSessionPerMin; i++) {
      limiter.check(key, T0);
    }
    expect(limiter.check(key, T0).allowed).toBe(false);

    // One full minute later the bucket has refilled.
    expect(limiter.check(key, T0 + 60_000).allowed).toBe(true);
  });
});

describe("rate limiter per-IP bucket (R-09)", () => {
  it("rejects a burst past the per-IP limit even with no session cookie", () => {
    // Make the per-IP limit the binding one; record/fork per-session are large.
    const config: RateLimitConfig = {
      recordPerSessionPerMin: 10_000,
      forkPerSessionPerMin: 10_000,
      perIpPerMin: 2,
      globalPerMin: 10_000,
    };
    const limiter = createRateLimiter(config);

    // No sessionId on the key: dropping the cookie must not escape the limit.
    const key = { action: "record" as const, ip: "9.9.9.9" };

    expect(limiter.check(key, T0).allowed).toBe(true);
    expect(limiter.check(key, T0).allowed).toBe(true);
    expect(limiter.check(key, T0).allowed).toBe(false);
  });
});

describe("rate limiter global bucket", () => {
  it("rejects a burst past the global limit across different IPs and sessions", () => {
    const config: RateLimitConfig = {
      recordPerSessionPerMin: 10_000,
      forkPerSessionPerMin: 10_000,
      perIpPerMin: 10_000,
      globalPerMin: 2,
    };
    const limiter = createRateLimiter(config);

    // Different IPs and sessions, but all draw on the one global bucket.
    expect(
      limiter.check({ action: "record", ip: "1.0.0.1", sessionId: "a" }, T0)
        .allowed
    ).toBe(true);
    expect(
      limiter.check({ action: "fork", ip: "1.0.0.2", sessionId: "b" }, T0)
        .allowed
    ).toBe(true);
    // The third call exhausts the global bucket regardless of source.
    expect(
      limiter.check({ action: "record", ip: "1.0.0.3", sessionId: "c" }, T0)
        .allowed
    ).toBe(false);
  });
});

describe("rate limiter separates record and fork per-session buckets", () => {
  it("fork budget is independent of the record budget for one session", () => {
    const limiter = createRateLimiter(BASE);
    const ip = "3.3.3.3";
    const sessionId = "s3";

    // Exhaust the record bucket.
    for (let i = 0; i < BASE.recordPerSessionPerMin; i++) {
      limiter.check({ action: "record", ip, sessionId }, T0);
    }
    expect(
      limiter.check({ action: "record", ip, sessionId }, T0).allowed
    ).toBe(false);

    // The fork bucket for the same session is untouched.
    expect(
      limiter.check({ action: "fork", ip, sessionId }, T0).allowed
    ).toBe(true);
  });
});
