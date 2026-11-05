// tests/server/routes-stop-ownership.test.ts
// Task 8 (R-08, R-10a): a stop belongs to the session that owns the fork.
//
// Session B cannot stop session A's running fork: /api/stop from B gets a 404
// and never aborts A's fork. A's fork runs to completion, so its saved branch
// is the full future (endReason "stop", every live step present), not a partial
// branch cut short by an abort. The ownership gate is what makes this hold: the
// stop handler aborts the fork's signal only when the caller's session owns the
// fork.

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
  const traceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-stopown-"));
  const staticRoot = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-stopstat-"));
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
  return { base: `http://127.0.0.1:${port}` };
}

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

describe("routes: a stop belongs to the fork's session (R-08, R-10a)", () => {
  it("session B's stop of A's fork gets a 404 and A's fork is not aborted", async () => {
    const { base } = await startServer();

    // Session A records a parent and starts a fork bound to a forkId and a
    // stream.
    const a = makeClient(base);
    const aRec = (await (
      await a.fetch("/api/record", json({ task: "owned" }))
    ).json()) as { runId: string };
    const aTrace = (await (
      await a.fetch(`/api/traces/${aRec.runId}`)
    ).json()) as Trace;
    const aStep = aTrace.steps.find((s) => s.kind === "model_call")!;

    const forkId = "fork-" + Math.random().toString(36).slice(2);
    const streamId = "s-" + Math.random().toString(36).slice(2);

    // Open A's stream first, then kick off A's fork without awaiting it, so B
    // can try to stop it while it may still be running.
    const streamPromise = a.fetch(`/api/stream/${streamId}`);
    await new Promise((r) => setTimeout(r, 20));
    const forkPromise = a.fetch(
      "/api/fork",
      json({
        parentRunId: aRec.runId,
        forkPointStepId: aStep.id,
        edit: { kind: "model_call", field: "model", value: "fake" },
        streamId,
        forkId,
      })
    );

    // Session B (a different cookie) mints its own session, then tries to stop
    // A's fork by its forkId. The stop is refused with a 404.
    const b = makeClient(base);
    await b.fetch("/api/record", json({ task: "intruder" }));
    const stopRes = await b.fetch("/api/stop", json({ forkId }));
    expect(stopRes.status).toBe(404);

    // A's fork completes on its own. Because B's stop never aborted it, the
    // saved branch is the full future: it ends with "stop", not "aborted", and
    // carries every live step the fake model produces (edited model call, tool
    // call, tool result, final model call).
    const aForkRes = await forkPromise;
    const aForked = (await aForkRes.json()) as ForkResponse;
    expect(aForked.status).toBe("ok");
    if (aForked.status !== "ok") return;

    const branch = (await (
      await a.fetch(`/api/traces/${aForked.runId}`)
    ).json()) as Trace;
    expect(branch.endReason).toBe("stop");
    const liveSteps = branch.steps.filter((s) => s.live);
    expect(liveSteps.length).toBe(4);

    // Close A's stream.
    await streamPromise;
  });
});
