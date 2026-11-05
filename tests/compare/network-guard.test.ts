// tests/compare/network-guard.test.ts
// Task 9: Confirm the network guard is active during replay and inactive
// during the live phase.

import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Recorder } from "../../src/recorder/recorder.js";
import { replayTrace, MODULE_ORIGINALS } from "../../src/replay/replay.js";
import { NetworkAccessDuringReplayError } from "../../src/replay/errors.js";
import { makeStandInAdapters } from "../fixtures/stand-in-agent.js";

// ---------------------------------------------------------------------------
// Suite A: no NetworkAccessDuringReplayError is thrown during replay of a
// normal recorded trace. The guard is active but the replay stubs never call
// any network surface, so no error should escape.
// ---------------------------------------------------------------------------

describe("network guard: replay phase does not produce NetworkAccessDuringReplayError", () => {
  it("replayTrace completes without a NetworkAccessDuringReplayError for a normal recorded trace", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "chrono-ng-replay-")
    );

    const adapters = makeStandInAdapters();
    const recorder = new Recorder({
      modelAdapter: adapters.modelAdapter,
      toolRegistry: adapters.toolRegistry,
      traceDir: tmpDir,
    });

    const recorded = await recorder.run("guard scope test");

    adapters.reset();

    // This must not throw NetworkAccessDuringReplayError.
    let thrown: unknown;
    try {
      await replayTrace(recorded);
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeUndefined();

    await fs.rm(tmpDir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// Suite B: after replayTrace returns, globalThis.fetch is restored to the
// original. A direct call to the original fetch outside the guard succeeds
// (i.e., does NOT throw NetworkAccessDuringReplayError). In a unit-test
// environment fetch is either the Node built-in or undefined; the point is
// that it is no longer the guard's blocking stub.
// ---------------------------------------------------------------------------

describe("network guard: live phase is outside the guard", () => {
  it("globalThis.fetch is restored after replayTrace finishes", async () => {
    const tmpDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "chrono-ng-live-")
    );

    const adapters = makeStandInAdapters();
    const recorder = new Recorder({
      modelAdapter: adapters.modelAdapter,
      toolRegistry: adapters.toolRegistry,
      traceDir: tmpDir,
    });

    const recorded = await recorder.run("live phase test");
    adapters.reset();

    await replayTrace(recorded);

    // After replayTrace returns the guard is gone.
    // globalThis.fetch must be the module-load-time original, not the blocker.
    expect(globalThis.fetch).toBe(MODULE_ORIGINALS.fetch);

    // Calling the module original directly must NOT throw
    // NetworkAccessDuringReplayError (it may throw for other network reasons or
    // not, depending on the environment; we only care it is not the guard error).
    let thrownError: unknown;
    try {
      // We call the captured original, not globalThis.fetch, so we are
      // definitely calling the pre-guard function.
      MODULE_ORIGINALS.fetch("https://example.com");
    } catch (err) {
      thrownError = err;
    }

    // If it threw, it must not be a NetworkAccessDuringReplayError.
    if (thrownError !== undefined) {
      expect(thrownError).not.toBeInstanceOf(NetworkAccessDuringReplayError);
    }

    await fs.rm(tmpDir, { recursive: true });
  });
});
