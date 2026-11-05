// src/server/rateLimit.ts
// Token-bucket rate limiter (R-09).
//
// Four kinds of bucket, all in memory: a per-session record bucket, a
// per-session fork bucket, a per-IP bucket, and one global bucket. The per-IP
// bucket is checked on every writing call, with or without a session, so
// dropping the session cookie does not escape the limit. Buckets refill over
// time. Over-limit requests get a 429 with a plain reason. The limiter runs
// from the first deploy, not behind a flag.

// The config slice the limiter needs (from ServerConfig.rateLimit).
export interface RateLimitConfig {
  recordPerSessionPerMin: number;
  forkPerSessionPerMin: number;
  // The per-IP limit (R-09).
  perIpPerMin: number;
  globalPerMin: number;
}

// Which writing action a check is for. Record and fork have separate
// per-session buckets.
export type RateLimitAction = "record" | "fork";

// The inputs a single check needs to identify the caller.
export interface RateLimitKey {
  action: RateLimitAction;
  // The source IP, always present.
  ip: string;
  // The session id, absent when the caller has no session.
  sessionId?: string;
}

// The outcome of a check.
export type RateLimitResult =
  // Allowed; a token was taken from every bucket the check touched.
  | { allowed: true }
  // Rejected; the caller gets a 429 with this plain reason.
  | { allowed: false; reason: string };

export interface RateLimiter {
  // Checks every relevant bucket at nowMs and takes a token from each when all
  // pass. Returns { allowed: false, reason } when any bucket is empty.
  check(key: RateLimitKey, nowMs: number): RateLimitResult;
}

// One token bucket. capacity is the per-minute limit; tokens refill
// continuously at capacity per 60_000 ms, capped at capacity.
interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

const WINDOW_MS = 60_000;

// Creates a RateLimiter bound to the given config.
export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  const recordBuckets = new Map<string, Bucket>();
  const forkBuckets = new Map<string, Bucket>();
  const ipBuckets = new Map<string, Bucket>();
  const globalBucket: Bucket = { tokens: config.globalPerMin, lastRefillMs: 0 };

  // Returns the bucket for key, creating it full the first time it is seen.
  const bucketFor = (
    map: Map<string, Bucket>,
    key: string,
    capacity: number
  ): Bucket => {
    let b = map.get(key);
    if (b === undefined) {
      b = { tokens: capacity, lastRefillMs: 0 };
      map.set(key, b);
    }
    return b;
  };

  // Refills a bucket up to capacity based on time elapsed since its last
  // refill, then reports whether at least one token is available. Does not take
  // a token (taking happens only when every relevant bucket can serve).
  const refill = (b: Bucket, capacity: number, nowMs: number): void => {
    if (b.lastRefillMs === 0) {
      b.lastRefillMs = nowMs;
      return;
    }
    const elapsed = nowMs - b.lastRefillMs;
    if (elapsed <= 0) {
      return;
    }
    const refilled = (elapsed / WINDOW_MS) * capacity;
    b.tokens = Math.min(capacity, b.tokens + refilled);
    b.lastRefillMs = nowMs;
  };

  const check = (key: RateLimitKey, nowMs: number): RateLimitResult => {
    // Collect every bucket this check touches, with its capacity and a plain
    // reason to report if it is the one that is empty. Order matters only for
    // which reason is returned first; a token is taken from all or none.
    const touched: { bucket: Bucket; capacity: number; reason: string }[] = [];

    if (key.sessionId !== undefined) {
      if (key.action === "record") {
        touched.push({
          bucket: bucketFor(recordBuckets, key.sessionId, config.recordPerSessionPerMin),
          capacity: config.recordPerSessionPerMin,
          reason: "Too many record requests for this session; please wait a moment.",
        });
      } else {
        touched.push({
          bucket: bucketFor(forkBuckets, key.sessionId, config.forkPerSessionPerMin),
          capacity: config.forkPerSessionPerMin,
          reason: "Too many fork requests for this session; please wait a moment.",
        });
      }
    }

    touched.push({
      bucket: bucketFor(ipBuckets, key.ip, config.perIpPerMin),
      capacity: config.perIpPerMin,
      reason: "Too many requests from this address; please wait a moment.",
    });

    touched.push({
      bucket: globalBucket,
      capacity: config.globalPerMin,
      reason: "The service is busy; please wait a moment.",
    });

    // Refill every touched bucket, then confirm each has a token before taking
    // any. This way a rejected call consumes nothing.
    for (const t of touched) {
      refill(t.bucket, t.capacity, nowMs);
    }
    for (const t of touched) {
      if (t.bucket.tokens < 1) {
        return { allowed: false, reason: t.reason };
      }
    }
    for (const t of touched) {
      t.bucket.tokens -= 1;
    }
    return { allowed: true };
  };

  return { check };
}
