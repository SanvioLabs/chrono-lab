// tests/server/sessions.test.ts
// Task 6 (R-01, R-07a): the session store.
//
// get returns no session for a read-only / static call; create mints a session
// with its own traceDir and one session SpendLedger, and a second writing call
// with the same cookie returns the same session and ledger (so spend
// accumulates across forks). create throws SessionCapFull when the live session
// count is at config.maxLiveSessions; after a session expires, create succeeds
// again. sweepExpired deletes an expired session and removes its trace
// directory, and refuses to remove any path that resolves outside
// config.traceRoot.
//
// Written before the session store is implemented. Until then
// createSessionStore throws "not implemented" and every case fails.

import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as fssync from "node:fs";
import type { IncomingMessage } from "node:http";
import {
  createSessionStore,
  SessionCapFull,
} from "../../src/server/sessions.js";
import type { SessionStoreConfig } from "../../src/server/sessions.js";

// Build a minimal IncomingMessage-like object carrying an optional session
// cookie. The store only reads req.headers.cookie.
function reqWith(cookie?: string): IncomingMessage {
  const headers: Record<string, string> = {};
  if (cookie !== undefined) {
    headers["cookie"] = `sessionId=${cookie}`;
  }
  return { headers } as unknown as IncomingMessage;
}

async function makeConfig(
  overrides: Partial<SessionStoreConfig> = {}
): Promise<SessionStoreConfig> {
  const traceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-sess-"));
  return {
    traceRoot,
    sessionTtlMs: 60_000,
    maxLiveSessions: 2,
    ...overrides,
  };
}

describe("session store get / create (R-01, R-07a)", () => {
  it("get returns undefined for a read-only / static call with no session cookie", async () => {
    const config = await makeConfig();
    const store = createSessionStore(config);

    expect(store.get(reqWith())).toBeUndefined();

    await fs.rm(config.traceRoot, { recursive: true });
  });

  it("create mints a session with its own traceDir and ledger; the same cookie returns the same session", async () => {
    const config = await makeConfig();
    const store = createSessionStore(config);

    const first = store.create(reqWith());
    expect(typeof first.id).toBe("string");
    expect(first.id.length).toBeGreaterThan(0);

    // The trace dir resolves inside traceRoot and is named by the session id.
    const resolvedDir = path.resolve(first.traceDir);
    expect(resolvedDir.startsWith(path.resolve(config.traceRoot))).toBe(true);
    expect(path.basename(resolvedDir)).toBe(first.id);

    // A second writing call carrying the minted cookie returns the same
    // session and the same ledger, so spend accumulates across forks.
    first.ledger.add(0.25);
    const again = store.get(reqWith(first.id));
    expect(again).toBeDefined();
    expect(again!.id).toBe(first.id);
    expect(again!.ledger.get().sessionSpendUsd).toBeCloseTo(0.25, 12);

    await fs.rm(config.traceRoot, { recursive: true });
  });

  it("create throws SessionCapFull at the live-session cap; after expiry create succeeds again", async () => {
    const config = await makeConfig({ maxLiveSessions: 2, sessionTtlMs: 1000 });
    const store = createSessionStore(config);

    store.create(reqWith());
    store.create(reqWith());
    expect(store.liveCount()).toBe(2);

    let caught: unknown;
    try {
      store.create(reqWith());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(SessionCapFull);

    // Sweep at a time past the TTL: both sessions expire and free their slots.
    store.sweepExpired(Date.now() + config.sessionTtlMs + 1);
    expect(store.liveCount()).toBe(0);

    // create succeeds again now that slots are free.
    const fresh = store.create(reqWith());
    expect(fresh.id.length).toBeGreaterThan(0);

    await fs.rm(config.traceRoot, { recursive: true });
  });
});

describe("session store sweepExpired (R-01)", () => {
  it("deletes an expired session and removes its trace directory", async () => {
    const config = await makeConfig({ sessionTtlMs: 1000 });
    const store = createSessionStore(config);

    const session = store.create(reqWith());

    // Create the trace dir and drop a file in it so we can see it removed.
    await fs.mkdir(session.traceDir, { recursive: true });
    await fs.writeFile(path.join(session.traceDir, "run.json"), "{}", "utf-8");
    expect(fssync.existsSync(session.traceDir)).toBe(true);

    store.sweepExpired(Date.now() + config.sessionTtlMs + 1);

    expect(fssync.existsSync(session.traceDir)).toBe(false);
    expect(store.get(reqWith(session.id))).toBeUndefined();

    await fs.rm(config.traceRoot, { recursive: true });
  });

  it("refuses to remove a path that resolves outside traceRoot", async () => {
    // A sibling directory outside traceRoot that must survive a sweep.
    const parent = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-outside-"));
    const traceRoot = path.join(parent, "traces");
    await fs.mkdir(traceRoot, { recursive: true });

    const victim = path.join(parent, "victim");
    await fs.mkdir(victim, { recursive: true });
    await fs.writeFile(path.join(victim, "keep.txt"), "keep", "utf-8");

    const config: SessionStoreConfig = {
      traceRoot,
      sessionTtlMs: 1000,
      maxLiveSessions: 4,
    };
    const store = createSessionStore(config);

    // Mint a session, then point its traceDir at the victim outside traceRoot.
    const session = store.create(reqWith());
    (session as { traceDir: string }).traceDir = victim;

    // A sweep must not remove the victim: it resolves outside traceRoot.
    store.sweepExpired(Date.now() + config.sessionTtlMs + 1);

    expect(fssync.existsSync(victim)).toBe(true);
    expect(fssync.existsSync(path.join(victim, "keep.txt"))).toBe(true);

    await fs.rm(parent, { recursive: true });
  });
});
