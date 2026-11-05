// tests/server/routes-overall-cap.test.ts
// Task 8 (R-07): the overall cap is shared across sessions, and the server
// composes the session ledger with the one global ledger, not the session
// ledger with itself.
//
// Two sessions each spend a known amount under their own session cap. The
// overall cap sits between one session's spend and both together, so the first
// fork succeeds and the second is refused on the overall cap. This fails if
// routes.ts passes composeLedger(session.ledger, session.ledger): then each
// session's "overall" total is only its own session total, the second session
// never sees the first's spend, and its fork wrongly succeeds.

import { describe, it, expect, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "../../src/server/server.js";
import type { ServerHandle } from "../../src/server/server.js";
import { defaultConfig } from "../../src/server/config.js";
import type { ServerConfig } from "../../src/server/config.js";
import { estimateCallCostUsd, computeActualCostUsd } from "../../src/server/caps.js";
import type { Trace } from "../../src/trace/types.js";
import type { ForkResponse } from "../../src/server/routes.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const demoDir = path.join(repoRoot, "demo");

const running: ServerHandle[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  for (const handle of running.splice(0)) {
    await handle.stop();
  }
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function startServer(
  overrides: Partial<ServerConfig> = {}
): Promise<{ base: string }> {
  const traceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-ovcap-"));
  const staticRoot = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-ovstat-"));
  tempDirs.push(traceRoot, staticRoot);

  const config = defaultConfig({
    port: 0,
    traceRoot,
    staticRoot,
    demoDir,
    modelMode: "fake",
    maxLiveSessions: 8,
    sessionTtlMs: 60_000,
    rateLimit: {
      recordPerSessionPerMin: 100,
      forkPerSessionPerMin: 100,
      perIpPerMin: 1000,
      globalPerMin: 1000,
    },
    ...overrides,
  });

  const handle = createServer(config);
  await handle.start();
  running.push(handle);

  const { port } = handle.address();
  return { base: `http://127.0.0.1:${port}` };
}

// A cookie-aware client so a sequence of writing calls shares one session.
interface Client {
  jar: string | null;
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

function makeClient(base: string): Client {
  const client: Client = {
    jar: null,
    async fetch(input: string, init: RequestInit = {}): Promise<Response> {
      const headers = new Headers(init.headers);
      if (client.jar) headers.set("cookie", client.jar);
      const res = await fetch(base + input, { ...init, headers });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) {
        const firstPart = setCookie.split(";")[0];
        if (firstPart) client.jar = firstPart;
      }
      return res;
    },
  };
  return client;
}

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

// Runs the fake-model record + priced fork for one client and returns the fork
// response. The fork edits the model to gpt-4o so the live phase makes priced
// calls charged to both the session and the global ledgers.
async function recordThenForkPriced(
  base: string,
  task: string
): Promise<ForkResponse> {
  const client = makeClient(base);
  const rec = (await (
    await client.fetch("/api/record", json({ task }))
  ).json()) as { runId: string };
  const trace = (await (
    await client.fetch(`/api/traces/${rec.runId}`)
  ).json()) as Trace;
  const step = trace.steps.find((s) => s.kind === "model_call")!;
  return (await (
    await client.fetch(
      "/api/fork",
      json({
        parentRunId: rec.runId,
        forkPointStepId: step.id,
        edit: { kind: "model_call", field: "model", value: "gpt-4o" },
      })
    )
  ).json()) as ForkResponse;
}

describe("routes: the overall cap sits between one session and two (R-07)", () => {
  it("the first session's fork succeeds; the second's is cap_hit on overall", async () => {
    // The pre-call cap check uses the worst-case estimate for one call. One
    // priced fork call estimates this much (the default maxTokens is 1024):
    const perCallEstimate = estimateCallCostUsd("gpt-4o", 1024);

    // The fake model's fork live phase (turns 2 and 3) reports these tokens,
    // which gpt-4o prices into the actual spend charged to both ledgers:
    //   turn 2 (the immediate edited model call): { input: 14, output: 4 }
    //   turn 3 (the model call after the tool result): { input: 22, output: 6 }
    const firstCallActual = computeActualCostUsd("gpt-4o", 14, 4);
    const forkTotalActual = computeActualCostUsd("gpt-4o", 14 + 22, 4 + 6);

    // The overall cap: above the estimate plus one fork's first call, below
    // the estimate plus one fork's whole spend. The midpoint of that window
    // leaves room for the first fork's every call and refuses the second
    // fork's first call once the first fork has spent its total.
    const overallLimitUsd =
      perCallEstimate + (firstCallActual + forkTotalActual) / 2;

    const { base } = await startServer({
      caps: { sessionLimitUsd: 100, overallLimitUsd },
    });

    // Session A: its fork succeeds while the overall total is still under the
    // cap.
    const aFork = await recordThenForkPriced(base, "a");
    expect(aFork.status).toBe("ok");

    // Session B: the global total now holds A's spend, so B's first call
    // pushes the overall total past the cap and the fork is refused on
    // "overall". A session-scoped overall view (the bug) would never see A's
    // spend, so B's fork would wrongly succeed.
    const bFork = await recordThenForkPriced(base, "b");
    expect(bFork.status).toBe("cap_hit");
    if (bFork.status === "cap_hit") {
      expect(bFork.reason).toBe("overall");
      expect(typeof bFork.runId).toBe("string");
    }
  });
});
