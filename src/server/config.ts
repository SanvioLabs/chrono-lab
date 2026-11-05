// src/server/config.ts
// Server config (Task 8).
//
// ServerConfig gathers the port, the caps, the rate limits, the trace and demo
// dirs, the static root, the session cap and TTL, and the model mode. The model
// API key is read from the environment only if a real model is ever wired in;
// in this spec modelMode is "fake" and no key is read. The key never appears in
// a response, a log or a trace.

import * as path from "node:path";
import type { CapConfig } from "./caps.js";

export type ModelMode = "fake" | "demo";

export interface ServerRateLimitConfig {
  recordPerSessionPerMin: number;
  forkPerSessionPerMin: number;
  // The per-IP limit (R-09).
  perIpPerMin: number;
  globalPerMin: number;
}

export interface ServerConfig {
  port: number;
  // Parent dir for per-session trace dirs.
  traceRoot: string;
  // Where the demo/ fixtures live.
  demoDir: string;
  // dist/ui; static files resolve inside this only.
  staticRoot: string;
  // sessionLimitUsd, overallLimitUsd (from caps.ts).
  caps: CapConfig;
  sessionTtlMs: number;
  // The session cap (R-07a).
  maxLiveSessions: number;
  rateLimit: ServerRateLimitConfig;
  // "fake" until spec 04; "demo" forces the fallback.
  modelMode: ModelMode;
}

// Built-in defaults, overlaid by the caller's overrides. The trace and static
// dirs resolve from the repo root so a bare defaultConfig() works for a local
// run; a test overrides them with temp dirs.
const repoRoot = process.cwd();

const BUILT_IN: ServerConfig = {
  port: 8787,
  traceRoot: path.join(repoRoot, ".traces"),
  demoDir: path.join(repoRoot, "demo"),
  staticRoot: path.join(repoRoot, "dist", "ui"),
  caps: { sessionLimitUsd: 1, overallLimitUsd: 10 },
  sessionTtlMs: 30 * 60_000,
  maxLiveSessions: 50,
  rateLimit: {
    recordPerSessionPerMin: 20,
    forkPerSessionPerMin: 40,
    perIpPerMin: 120,
    globalPerMin: 600,
  },
  modelMode: "fake",
};

// Returns a ServerConfig filled from the given overrides over built-in
// defaults. Port 0 asks the OS for an ephemeral port, which the route test
// relies on so it never collides with anything else on the machine. The
// nested caps and rateLimit objects are replaced whole when overridden, not
// merged field by field, so a test that gives a partial rateLimit always wins.
export function defaultConfig(
  overrides: Partial<ServerConfig> = {}
): ServerConfig {
  return {
    ...BUILT_IN,
    ...overrides,
    caps: overrides.caps ?? BUILT_IN.caps,
    rateLimit: overrides.rateLimit ?? BUILT_IN.rateLimit,
  };
}
