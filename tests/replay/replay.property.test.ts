// tests/replay/replay.property.test.ts
// Property-based and unit tests for the replay module.
// Written before replayTrace exists (Task 8). Made passing in Task 9.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
// Default imports give the mutable CommonJS module object, which is what
// withNetworkGuard patches. Namespace imports (`import * as http`) are sealed
// ES module namespace objects; reading properties on them after restore would
// always reflect the original regardless of patching.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import { Recorder } from "../../src/recorder/recorder.js";
import {
  replayTrace,
  withNetworkGuard,
  MODULE_ORIGINALS,
} from "../../src/replay/replay.js";
import { NetworkAccessDuringReplayError } from "../../src/replay/errors.js";
import { makeStandInAdapters } from "../fixtures/stand-in-agent.js";

// Safe task strings: short, no API key patterns, no special chars.
const safeTask = fc
  .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz "), {
    minLength: 1,
    maxLength: 30,
  })
  .filter((s) => s.trim().length > 0);

// ---------------------------------------------------------------------------
// Suite 1: replay equals recording (property test, unchanged)
// ---------------------------------------------------------------------------

describe("replay property: step-for-step equality", () => {
  it(
    "replayTrace produces the same steps as the recording",
    async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-rp-"));
      const adapters = makeStandInAdapters();

      await fc.assert(
        fc.asyncProperty(safeTask, async (task) => {
          adapters.reset();
          const recorder = new Recorder({
            modelAdapter: adapters.modelAdapter,
            toolRegistry: adapters.toolRegistry,
            traceDir: tmpDir,
          });

          const recorded = await recorder.run(task);

          adapters.reset();
          const replayed = await replayTrace(recorded);

          if (replayed.steps.length !== recorded.steps.length) {
            throw new Error(
              `Step count mismatch: recorded=${recorded.steps.length} replayed=${replayed.steps.length}`
            );
          }

          for (let i = 0; i < recorded.steps.length; i++) {
            const rec = recorded.steps[i];
            const rep = replayed.steps[i];
            if (JSON.stringify(rec) !== JSON.stringify(rep)) {
              throw new Error(
                `Step ${i} mismatch.\nRecorded: ${JSON.stringify(rec)}\nReplayed: ${JSON.stringify(rep)}`
              );
            }
          }
        }),
        { numRuns: 100 }
      );

      await fs.rm(tmpDir, { recursive: true });
    }
  );
});

// ---------------------------------------------------------------------------
// Suite 2: withNetworkGuard blocks each surface and restores originals
//
// Each test calls exactly one surface inside the guard and asserts it throws
// NetworkAccessDuringReplayError naming that surface.
//
// Removing any single surface's patch in withNetworkGuard makes its test fail:
//
//   Surface                 | Test that catches it
//   ----------------------- | -----------------------------------------------------------
//   globalThis.fetch        | "globalThis.fetch throws NetworkAccessDuringReplayError"
//   http.request            | "http.request throws NetworkAccessDuringReplayError"
//   https.request           | "https.request throws NetworkAccessDuringReplayError"
//   net.connect             | "net.connect throws NetworkAccessDuringReplayError"
//   tls.connect             | "tls.connect throws NetworkAccessDuringReplayError"
//   dns.lookup              | "dns.lookup throws NetworkAccessDuringReplayError"
// ---------------------------------------------------------------------------

describe("withNetworkGuard: each surface throws NetworkAccessDuringReplayError", () => {
  // Call fn() synchronously inside the guard. Capture the thrown error.
  // Assert it is a NetworkAccessDuringReplayError naming expectedSurface.
  async function assertSurfaceBlocked(
    expectedSurface: string,
    fn: () => unknown
  ): Promise<void> {
    let caught: unknown;
    await withNetworkGuard(async () => {
      try {
        fn();
      } catch (err) {
        caught = err;
      }
    });
    expect(caught, `expected a throw from surface "${expectedSurface}"`).toBeInstanceOf(
      NetworkAccessDuringReplayError
    );
    const err = caught as NetworkAccessDuringReplayError;
    expect(err.surface).toBe(expectedSurface);
    expect(err.message).toContain(expectedSurface);
  }

  it("globalThis.fetch throws NetworkAccessDuringReplayError", async () => {
    // globalThis.fetch is patched to throw synchronously before any Promise
    // is created.
    await assertSurfaceBlocked("globalThis.fetch", () =>
      globalThis.fetch("https://example.com")
    );
  });

  it("http.request throws NetworkAccessDuringReplayError", async () => {
    await assertSurfaceBlocked("http.request", () =>
      http.request("http://example.com")
    );
  });

  it("https.request throws NetworkAccessDuringReplayError", async () => {
    await assertSurfaceBlocked("https.request", () =>
      https.request("https://example.com")
    );
  });

  it("net.connect throws NetworkAccessDuringReplayError", async () => {
    await assertSurfaceBlocked("net.connect", () =>
      net.connect(80, "example.com")
    );
  });

  it("tls.connect throws NetworkAccessDuringReplayError", async () => {
    await assertSurfaceBlocked("tls.connect", () =>
      tls.connect(443, "example.com", {})
    );
  });

  it("dns.lookup throws NetworkAccessDuringReplayError", async () => {
    // dns.lookup normally takes a callback. The guard throws synchronously
    // before the callback path is reached.
    await assertSurfaceBlocked("dns.lookup", () =>
      (dns.lookup as Function)("example.com", () => {})
    );
  });
});

// ---------------------------------------------------------------------------
// Suite 2b: originals restored by identity after the guard
//
// After withNetworkGuard finishes, every surface must be the same function
// object as MODULE_ORIGINALS (captured at module load time). typeof is not
// sufficient: we compare by reference.
//
// Removing any single surface's restore line from withNetworkGuard makes the
// corresponding assertion fail.
// ---------------------------------------------------------------------------

describe("withNetworkGuard: originals restored by identity after the guard", () => {
  it("restores all six surfaces to the module-load-time originals", async () => {
    await withNetworkGuard(async () => {
      // Guard is active here; we don't need to do anything.
    });

    // Identity checks: toBe() fails if the reference differs.
    expect(globalThis.fetch).toBe(MODULE_ORIGINALS.fetch);
    expect(http.request).toBe(MODULE_ORIGINALS.httpRequest);
    expect(https.request).toBe(MODULE_ORIGINALS.httpsRequest);
    expect(net.connect).toBe(MODULE_ORIGINALS.netConnect);
    expect(tls.connect).toBe(MODULE_ORIGINALS.tlsConnect);
    expect(dns.lookup).toBe(MODULE_ORIGINALS.dnsLookup);
  });

  it("restores originals even when fn throws", async () => {
    await expect(
      withNetworkGuard(async () => {
        throw new Error("fn failed");
      })
    ).rejects.toThrow("fn failed");

    expect(globalThis.fetch).toBe(MODULE_ORIGINALS.fetch);
    expect(http.request).toBe(MODULE_ORIGINALS.httpRequest);
    expect(https.request).toBe(MODULE_ORIGINALS.httpsRequest);
    expect(net.connect).toBe(MODULE_ORIGINALS.netConnect);
    expect(tls.connect).toBe(MODULE_ORIGINALS.tlsConnect);
    expect(dns.lookup).toBe(MODULE_ORIGINALS.dnsLookup);
  });
});

// ---------------------------------------------------------------------------
// Suite 3: replayTrace runs under the guard
//
// While replayTrace is executing, globalThis.fetch must be the guard's blocker
// function (not the original). We confirm this by scheduling a microtask
// during the replay that captures the current value of globalThis.fetch and
// checks it is not the module original.
//
// If withNetworkGuard is removed from replayTrace, globalThis.fetch is the
// original during the replay window and this test fails.
// ---------------------------------------------------------------------------

describe("replayTrace: network call from inside replay fails with NetworkAccessDuringReplayError", () => {
  it(
    "globalThis.fetch is blocked while replayTrace is running",
    async () => {
      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "chrono-guard-")
      );
      const adapters = makeStandInAdapters();

      // Record a normal trace.
      adapters.reset();
      const recorder = new Recorder({
        modelAdapter: adapters.modelAdapter,
        toolRegistry: adapters.toolRegistry,
        traceDir: tmpDir,
      });
      const recorded = await recorder.run("guard test");

      // Observe globalThis.fetch from a microtask that runs during replayTrace.
      // Promise.resolve().then() schedules a microtask on the current event-loop
      // tick. replayTrace is async and must await at least one point inside the
      // guard window, so this microtask fires while the guard is active.
      let fetchDuringReplay: typeof globalThis.fetch | undefined;

      await Promise.all([
        replayTrace(recorded, { strict: false }),
        Promise.resolve().then(() => {
          fetchDuringReplay = globalThis.fetch;
        }),
      ]);

      // If the guard is active during replay, fetch is not the original.
      expect(fetchDuringReplay).not.toBe(MODULE_ORIGINALS.fetch);

      // Calling it must throw NetworkAccessDuringReplayError.
      // (The guard has been released by now, but fetchDuringReplay captured
      // the blocker function itself, so we can call it directly.)
      expect(() => fetchDuringReplay!("https://example.com")).toThrow(
        NetworkAccessDuringReplayError
      );

      // After replayTrace finishes, the original must be restored.
      expect(globalThis.fetch).toBe(MODULE_ORIGINALS.fetch);

      await fs.rm(tmpDir, { recursive: true });
    }
  );
});
