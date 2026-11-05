// tests/server/routes-stream-binding.test.ts
// Task 8 (R-10a): a stream opened before any session exists binds to the
// session the following writing call uses, and no one else may open it.
//
// The UI opens the step stream first, then posts the record or fork that mints
// its session. So a stream is often opened with no session yet. The server
// leaves such a stream unbound until the writing call carrying the same
// streamId claims it; from then on it belongs to that session. A second opener
// of the same stream id (another caller, with or without a session) is refused
// with a 404, so one stream id is held by exactly one caller.

import { describe, it, expect, afterEach } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "../../src/server/server.js";
import type { ServerHandle } from "../../src/server/server.js";
import { defaultConfig } from "../../src/server/config.js";
import type { ServerConfig } from "../../src/server/config.js";

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
  const traceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-bind-"));
  const staticRoot = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-bindstat-"));
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

describe("routes: a stream opened before any session binds to its writing call (R-10a)", () => {
  it("another opener is refused while the stream is unbound, and the record that carries its id receives the steps", async () => {
    const { base } = await startServer();

    const opener = makeClient(base);
    const other = makeClient(base);
    const streamId = "pre-" + Math.random().toString(36).slice(2);

    // The opener has no session yet. It opens the stream before any writing
    // call, so the stream is left unbound.
    const streamPromise = opener.fetch(`/api/stream/${streamId}`);
    await new Promise((r) => setTimeout(r, 20));

    // A different caller cannot open the same stream id while it is unbound:
    // one stream id is held by exactly one caller.
    const otherOpen = await other.fetch(`/api/stream/${streamId}`);
    expect(otherOpen.status).toBe(404);

    // The opener posts a record carrying the same streamId. This mints the
    // opener's session and binds the stream to it, so the run's steps flow to
    // the open stream.
    const recordRes = await opener.fetch(
      "/api/record",
      json({ task: "bind me", streamId })
    );
    expect(recordRes.status).toBe(200);
    // The record minted a session (the stream is now bound to it).
    const setCookie = recordRes.headers.get("set-cookie");
    expect(setCookie).toBeTruthy();
    expect(setCookie!).toContain("sessionId=");

    // The bound stream received the run's steps and a terminal done event.
    const streamRes = await streamPromise;
    expect(streamRes.status).toBe(200);
    const body = await streamRes.text();
    const stepEvents = body.match(/event:\s*step/g) ?? [];
    expect(stepEvents.length).toBe(4);
    expect(body.indexOf("event: done")).toBeGreaterThan(-1);
  });
});
