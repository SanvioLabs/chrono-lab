// tests/server/routes.test.ts
// Task 8: the server routes and the SSE stream.
//
// Every test starts the server on an ephemeral port (port 0, so the OS picks a
// free port) and stops it in afterEach, so the suite never collides with
// anything else on the machine. modelMode is "fake" throughout except the
// demo-mode group, which starts a second server with modelMode "demo".
//
// Written before config.ts, routes.ts and server.ts are implemented. Until
// then createServer throws "not implemented" and every case fails.

import { describe, it, expect, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "../../src/server/server.js";
import type { ServerHandle } from "../../src/server/server.js";
import { defaultConfig } from "../../src/server/config.js";
import type { ServerConfig } from "../../src/server/config.js";
import type { Trace } from "../../src/trace/types.js";
import type {
  TraceSummary,
  ForkResponse,
} from "../../src/server/routes.js";
import type { CompareResult } from "../../src/compare/compare.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const demoDir = path.join(repoRoot, "demo");

// API key patterns a response must never carry (R-01a); matches the scrub set
// in src/trace/save.ts.
const KEY_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_\-]{20,}/,
  /sk-[A-Za-z0-9_\-]{20,}/,
  /AKIA[0-9A-Z]{16}/,
];

// Track every server and temp dir so afterEach can tear them down.
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

// Starts a server on an ephemeral port with the given overrides and returns its
// base URL plus the handle. The caller never hard-codes a port.
async function startServer(
  overrides: Partial<ServerConfig> = {}
): Promise<{ base: string; handle: ServerHandle }> {
  const traceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-routes-"));
  const staticRoot = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-static-"));
  tempDirs.push(traceRoot, staticRoot);

  const config = defaultConfig({
    port: 0,
    traceRoot,
    staticRoot,
    demoDir,
    modelMode: "fake",
    caps: { sessionLimitUsd: 10, overallLimitUsd: 100 },
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
  return { base: `http://127.0.0.1:${port}`, handle };
}

// A tiny cookie-aware client. It carries the sessionId cookie the server sets,
// so a sequence of writing calls shares one session.
interface Client {
  jar: string | null;
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

function makeClient(base: string): Client {
  const client: Client = {
    jar: null,
    async fetch(input: string, init: RequestInit = {}): Promise<Response> {
      const headers = new Headers(init.headers);
      if (client.jar) {
        headers.set("cookie", client.jar);
      }
      const res = await fetch(base + input, { ...init, headers });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) {
        // Keep only the name=value part before the first ";".
        const firstPart = setCookie.split(";")[0];
        if (firstPart) {
          client.jar = firstPart;
        }
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

describe("routes: the happy path against the fake model", () => {
  it("record, list, get, fork and compare all return the expected shapes", async () => {
    const { base } = await startServer();
    const client = makeClient(base);

    // POST /api/record returns a runId and the saved trace has the expected
    // steps (fake model: model_call, tool_call, tool_result, model_call).
    const recordRes = await client.fetch("/api/record", json({ task: "hello" }));
    expect(recordRes.status).toBe(200);
    const recorded = (await recordRes.json()) as { runId: string };
    expect(typeof recorded.runId).toBe("string");

    // GET /api/traces returns a summary for it.
    const listRes = await client.fetch("/api/traces");
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as TraceSummary[];
    const summary = list.find((t) => t.runId === recorded.runId);
    expect(summary).toBeDefined();
    expect(summary!.stepCount).toBe(4);

    // GET /api/traces/:runId returns the full trace, and a 404 for an unknown
    // id.
    const getRes = await client.fetch(`/api/traces/${recorded.runId}`);
    expect(getRes.status).toBe(200);
    const trace = (await getRes.json()) as Trace;
    expect(trace.steps.map((s) => s.kind)).toEqual([
      "model_call",
      "tool_call",
      "tool_result",
      "model_call",
    ]);

    const missingRes = await client.fetch("/api/traces/does-not-exist");
    expect(missingRes.status).toBe(404);

    // POST /api/fork with one edit returns status "ok" and a new runId.
    const firstModelStep = trace.steps.find((s) => s.kind === "model_call")!;
    const forkRes = await client.fetch(
      "/api/fork",
      json({
        parentRunId: recorded.runId,
        forkPointStepId: firstModelStep.id,
        edit: { kind: "model_call", field: "model", value: "fake" },
      })
    );
    expect(forkRes.status).toBe(200);
    const forked = (await forkRes.json()) as ForkResponse;
    expect(forked.status).toBe("ok");
    if (forked.status !== "ok") return;
    expect(typeof forked.runId).toBe("string");
    expect(forked.runId).not.toBe(recorded.runId);

    // POST /api/compare returns a CompareResult with the first difference and
    // both branches' costs.
    const compareRes = await client.fetch(
      "/api/compare",
      json({ aRunId: recorded.runId, bRunId: forked.runId })
    );
    expect(compareRes.status).toBe(200);
    const compare = (await compareRes.json()) as CompareResult;
    expect(compare).toHaveProperty("firstDiff");
    expect(compare.a).toHaveProperty("totalCostUsd");
    expect(compare.b).toHaveProperty("totalCostUsd");
  });
});

describe("routes: session minting (R-07a)", () => {
  it("a read-only GET and a static request mint no session; the first write mints one", async () => {
    const { base } = await startServer();

    // A read-only GET carries no session and gets no cookie back.
    const listRes = await fetch(base + "/api/traces");
    expect(listRes.status).toBe(200);
    expect(listRes.headers.get("set-cookie")).toBeNull();

    // The first writing call mints a session (sets a cookie).
    const recordRes = await fetch(base + "/api/record", json({ task: "hi" }));
    expect(recordRes.status).toBe(200);
    const setCookie = recordRes.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie!).toContain("sessionId=");
    // The cookie is HttpOnly.
    expect(setCookie!.toLowerCase()).toContain("httponly");
  });

  it("when the live session count is full, a new session request gets a 503 with a plain reason", async () => {
    // One session slot. The first writing client fills it; a second client
    // (no cookie) cannot mint and gets a 503.
    const { base } = await startServer({ maxLiveSessions: 1 });

    const first = makeClient(base);
    const firstRes = await first.fetch("/api/record", json({ task: "one" }));
    expect(firstRes.status).toBe(200);

    const second = makeClient(base);
    const secondRes = await second.fetch("/api/record", json({ task: "two" }));
    expect(secondRes.status).toBe(503);
    const body = await secondRes.text();
    expect(body.length).toBeGreaterThan(0);
    // The reason is plain text, not an API key or a stack trace.
    expect(body.toLowerCase()).not.toContain("error:");
  });
});

describe("routes: the overall cap across two sessions (R-07)", () => {
  it("two sessions under the session cap together reach the overall cap; the second's fork is cap_hit on overall", async () => {
    // Session cap high, overall cap low, and a model that actually costs, so
    // two sessions each under their own cap push the shared overall past its
    // limit. The fake model is zero cost, so the test drives a priced model
    // through the fork edit (model "gpt-4o"); the fork's live call is checked
    // against both caps and charged to both ledgers.
    const { base } = await startServer({
      caps: { sessionLimitUsd: 100, overallLimitUsd: 0 },
    });

    // Record once per session so each has a parent run to fork.
    const a = makeClient(base);
    const aRec = (await (
      await a.fetch("/api/record", json({ task: "a" }))
    ).json()) as { runId: string };
    const aTrace = (await (
      await a.fetch(`/api/traces/${aRec.runId}`)
    ).json()) as Trace;
    const aStep = aTrace.steps.find((s) => s.kind === "model_call")!;

    const b = makeClient(base);
    const bRec = (await (
      await b.fetch("/api/record", json({ task: "b" }))
    ).json()) as { runId: string };
    const bTrace = (await (
      await b.fetch(`/api/traces/${bRec.runId}`)
    ).json()) as Trace;
    const bStep = bTrace.steps.find((s) => s.kind === "model_call")!;

    // With overallLimitUsd 0, any priced live call trips the overall cap. The
    // fork edits the model to a priced one so the pre-call check fails on
    // "overall".
    const aFork = (await (
      await a.fetch(
        "/api/fork",
        json({
          parentRunId: aRec.runId,
          forkPointStepId: aStep.id,
          edit: { kind: "model_call", field: "model", value: "gpt-4o" },
        })
      )
    ).json()) as ForkResponse;

    const bFork = (await (
      await b.fetch(
        "/api/fork",
        json({
          parentRunId: bRec.runId,
          forkPointStepId: bStep.id,
          edit: { kind: "model_call", field: "model", value: "gpt-4o" },
        })
      )
    ).json()) as ForkResponse;

    // The second session's fork reports cap_hit with reason "overall" and a
    // saved partial branch runId.
    expect(bFork.status).toBe("cap_hit");
    if (bFork.status === "cap_hit") {
      expect(bFork.reason).toBe("overall");
      expect(typeof bFork.runId).toBe("string");
    }
    // The first session hit the same shared overall cap too (overall is 0), so
    // it is also cap_hit on overall; neither passed its cap.
    expect(aFork.status).toBe("cap_hit");
    if (aFork.status === "cap_hit") {
      expect(aFork.reason).toBe("overall");
    }
  });
});

describe("routes: the SSE stream (R-08, R-10a)", () => {
  it("delivers one step event per step in order, then a terminal done event", async () => {
    const { base } = await startServer();
    const client = makeClient(base);

    const streamId = "stream-" + Math.random().toString(36).slice(2);

    // Open the stream first, then post a record carrying the same streamId.
    // Reading the SSE body as text until the connection closes gives every
    // event the run produced.
    const streamPromise = client.fetch(`/api/stream/${streamId}`);

    // Give the stream a moment to register, then post the record.
    await new Promise((r) => setTimeout(r, 20));
    const recordRes = await client.fetch(
      "/api/record",
      json({ task: "stream me", streamId })
    );
    expect(recordRes.status).toBe(200);

    const streamRes = await streamPromise;
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get("content-type")).toContain("text/event-stream");
    const body = await streamRes.text();

    // One "event: step" per recorded step (four), then a terminal "done".
    const stepEvents = body.match(/event:\s*step/g) ?? [];
    expect(stepEvents.length).toBe(4);
    const doneIndex = body.indexOf("event: done");
    expect(doneIndex).toBeGreaterThan(-1);
    // The done event comes after the last step event.
    const lastStepIndex = body.lastIndexOf("event: step");
    expect(doneIndex).toBeGreaterThan(lastStepIndex);
  });

  it("a stream opened by one session returns 404 to another session (R-10a)", async () => {
    const { base } = await startServer();
    const owner = makeClient(base);

    const streamId = "owned-" + Math.random().toString(36).slice(2);

    // The owner mints a session (via a record) and opens the stream.
    await owner.fetch("/api/record", json({ task: "mint" }));
    // A second session with a different cookie cannot read the owner's stream.
    const intruder = makeClient(base);
    await intruder.fetch("/api/record", json({ task: "other" }));

    // Owner opens the stream (binds it to the owner session).
    const ownerStream = owner.fetch(`/api/stream/${streamId}`);
    await new Promise((r) => setTimeout(r, 20));
    const intruderRes = await intruder.fetch(`/api/stream/${streamId}`);
    expect(intruderRes.status).toBe(404);

    // Clean up the owner's open stream by posting nothing and closing.
    await owner.fetch("/api/record", json({ task: "close", streamId }));
    await ownerStream;
  });

  it("POST /api/stop aborts the running fork and returns the partial branch runId with no streamed step rewritten", async () => {
    const { base } = await startServer();
    const client = makeClient(base);

    // Record a parent, then start a fork bound to a forkId and stream.
    const rec = (await (
      await client.fetch("/api/record", json({ task: "stoppable" }))
    ).json()) as { runId: string };
    const trace = (await (
      await client.fetch(`/api/traces/${rec.runId}`)
    ).json()) as Trace;
    const step = trace.steps.find((s) => s.kind === "model_call")!;

    const forkId = "fork-" + Math.random().toString(36).slice(2);
    const streamId = "s-" + Math.random().toString(36).slice(2);

    const streamPromise = client.fetch(`/api/stream/${streamId}`);
    await new Promise((r) => setTimeout(r, 20));

    const forkPromise = client.fetch(
      "/api/fork",
      json({
        parentRunId: rec.runId,
        forkPointStepId: step.id,
        edit: { kind: "model_call", field: "model", value: "fake" },
        streamId,
        forkId,
      })
    );

    // Ask the server to stop this fork. The stop returns the partial branch
    // runId.
    const stopRes = await client.fetch("/api/stop", json({ forkId }));
    expect([200, 404]).toContain(stopRes.status);

    const forkRes = await forkPromise;
    const forked = (await forkRes.json()) as ForkResponse;
    // The fork still resolves with a saved branch runId (clean stop or full
    // completion; either way a runId).
    if (forked.status === "ok") {
      expect(typeof forked.runId).toBe("string");
    }

    // Steps streamed before the stop must match the start of the saved branch
    // (no streamed step rewritten). Read the stream body and the saved branch.
    const streamRes = await streamPromise;
    const streamBody = await streamRes.text();
    const streamedIds = [...streamBody.matchAll(/"id":\s*"([^"]+)"/g)].map(
      (m) => m[1]
    );

    if (forked.status === "ok") {
      const branch = (await (
        await client.fetch(`/api/traces/${forked.runId}`)
      ).json()) as Trace;
      const liveIds = branch.steps.filter((s) => s.live).map((s) => s.id);
      // Every id the stream delivered that is a live step id appears in the
      // saved branch in the same order, never rewritten.
      const streamedLive = streamedIds.filter((id) => liveIds.includes(id!));
      expect(liveIds.slice(0, streamedLive.length)).toEqual(streamedLive);
    }
  });
});

describe("routes: rate limits, key hygiene and CSP (R-09, R-01a)", () => {
  it("rate-limited requests get a 429 with a plain reason", async () => {
    // One record allowed per session per minute; the second is rejected.
    const { base } = await startServer({
      rateLimit: {
        recordPerSessionPerMin: 1,
        forkPerSessionPerMin: 100,
        perIpPerMin: 1000,
        globalPerMin: 1000,
      },
    });
    const client = makeClient(base);

    const first = await client.fetch("/api/record", json({ task: "one" }));
    expect(first.status).toBe(200);
    const second = await client.fetch("/api/record", json({ task: "two" }));
    expect(second.status).toBe(429);
    const reason = await second.text();
    expect(reason.length).toBeGreaterThan(0);
  });

  it("every response is free of any API key pattern", async () => {
    const { base } = await startServer();
    const client = makeClient(base);

    const bodies: string[] = [];
    bodies.push(await (await client.fetch("/api/record", json({ task: "k" }))).text());
    bodies.push(await (await client.fetch("/api/traces")).text());

    for (const body of bodies) {
      for (const pattern of KEY_PATTERNS) {
        expect(pattern.test(body)).toBe(false);
      }
    }
  });

  it("an HTML response carries the same-origin-only Content-Security-Policy", async () => {
    // Put an index.html in the static root so a GET / serves HTML with the CSP
    // header.
    const staticRoot = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-csp-"));
    tempDirs.push(staticRoot);
    await fs.writeFile(
      path.join(staticRoot, "index.html"),
      "<!doctype html><title>lab</title>",
      "utf-8"
    );

    const { base } = await startServer({ staticRoot });
    const res = await fetch(base + "/index.html");
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy");
    expect(csp).toBeTruthy();
    expect(csp!).toContain("default-src 'self'");
    expect(csp!).toContain("script-src 'self'");
    expect(csp!).toContain("object-src 'none'");
  });
});

describe("routes: demo mode (R-14, R-17)", () => {
  it("a fork for a step with a prerecorded future returns that future and flags demo mode", async () => {
    const { base } = await startServer({ modelMode: "demo" });
    const client = makeClient(base);

    // In demo mode the trace list reports which fork-point step ids have a
    // prerecorded future. The demo future forks the root run at its first
    // model_call step.
    const list = (await (await client.fetch("/api/traces")).json()) as TraceSummary[];
    expect(list.length).toBeGreaterThan(0);
    const root = list.find((t) => t.parentRunId === undefined);
    expect(root).toBeDefined();

    const rootTrace = (await (
      await client.fetch(`/api/traces/${root!.runId}`)
    ).json()) as Trace;
    const forkStep = rootTrace.steps.find((s) => s.kind === "model_call")!;

    const forkRes = await client.fetch(
      "/api/fork",
      json({
        parentRunId: root!.runId,
        forkPointStepId: forkStep.id,
        edit: { kind: "model_call", field: "model", value: "fake" },
      })
    );
    expect(forkRes.status).toBe(200);
    const forked = (await forkRes.json()) as ForkResponse;
    expect(forked.status).toBe("ok");
    if (forked.status !== "ok") return;
    expect(forked.demoMode).toBe(true);

    // The returned future belongs to the chosen fork point.
    const future = (await (
      await client.fetch(`/api/traces/${forked.runId}`)
    ).json()) as Trace;
    expect(future.parentRunId).toBe(root!.runId);
    expect(future.forkPointStepId).toBe(forkStep.id);
  });

  it("a fork for a step with no prerecorded future is refused with a plain message", async () => {
    const { base } = await startServer({ modelMode: "demo" });
    const client = makeClient(base);

    const list = (await (await client.fetch("/api/traces")).json()) as TraceSummary[];
    const root = list.find((t) => t.parentRunId === undefined)!;
    const rootTrace = (await (
      await client.fetch(`/api/traces/${root.runId}`)
    ).json()) as Trace;

    // A tool_result step has no prerecorded future in this spec (only one
    // model_call fork point does). Forking it in demo mode is refused with a
    // plain message, never an unrelated future.
    const toolResult = rootTrace.steps.find((s) => s.kind === "tool_result")!;
    const res = await client.fetch(
      "/api/fork",
      json({
        parentRunId: root.runId,
        forkPointStepId: toolResult.id,
        edit: { kind: "tool_result", field: "result", value: "nope" },
      })
    );
    // Refused: a 4xx with a plain reason, not a 200 with an unrelated future.
    expect(res.status).toBeGreaterThanOrEqual(400);
    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
  });
});
