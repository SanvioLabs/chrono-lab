// tests/compare/compare.property.test.ts
// Property tests for compareBranches.
// Written before compareBranches is implemented (Task 5). Fails with "not
// implemented" until Task 8 is complete.
//
// Property A (symmetry): swapping a and b swaps the stats and flips the step
// ids in firstDiff, but the index stays the same.
// Property B (identical branches): compareBranches(t, t) returns
// firstDiff: null and zero stats on both sides.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Recorder } from "../../src/recorder/recorder.js";
import { compareBranches } from "../../src/compare/compare.js";
import { makeStandInAdapters } from "../fixtures/stand-in-agent.js";
import type { Trace } from "../../src/trace/types.js";

// Safe task strings: short, no API key patterns.
const safeTask = fc
  .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz "), {
    minLength: 1,
    maxLength: 30,
  })
  .filter((s) => s.trim().length > 0);

// Record a trace using the stand-in adapters for a given task string.
async function recordTrace(task: string, traceDir: string): Promise<Trace> {
  const adapters = makeStandInAdapters();
  const recorder = new Recorder({
    modelAdapter: adapters.modelAdapter,
    toolRegistry: adapters.toolRegistry,
    traceDir,
  });
  return recorder.run(task);
}

describe("compareBranches property A: symmetry", () => {
  it(
    "compareBranches(a, b) and compareBranches(b, a) are mirrors",
    async () => {
      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "chrono-cmp-prop-")
      );

      await fc.assert(
        fc.asyncProperty(
          safeTask,
          safeTask,
          async (taskA, taskB) => {
            const a = await recordTrace(taskA, tmpDir);
            const b = await recordTrace(taskB, tmpDir);

            const ab = compareBranches(a, b);
            const ba = compareBranches(b, a);

            // firstDiff: index is the same in both directions.
            if (ab.firstDiff === null) {
              expect(ba.firstDiff).toBeNull();
            } else {
              expect(ba.firstDiff).not.toBeNull();
              expect(ba.firstDiff!.index).toBe(ab.firstDiff.index);
              // aStepId in ab equals bStepId in ba, and vice versa.
              expect(ba.firstDiff!.aStepId).toBe(ab.firstDiff.bStepId);
              expect(ba.firstDiff!.bStepId).toBe(ab.firstDiff.aStepId);
            }

            // Stats: a from ab equals b from ba, and b from ab equals a from ba.
            expect(ab.a.totalTokens).toBe(ba.b.totalTokens);
            expect(ab.a.totalCostUsd).toBe(ba.b.totalCostUsd);
            expect(ab.a.totalDurationMs).toBe(ba.b.totalDurationMs);
            expect(ab.a.finalOutput).toBe(ba.b.finalOutput);

            expect(ab.b.totalTokens).toBe(ba.a.totalTokens);
            expect(ab.b.totalCostUsd).toBe(ba.a.totalCostUsd);
            expect(ab.b.totalDurationMs).toBe(ba.a.totalDurationMs);
            expect(ab.b.finalOutput).toBe(ba.a.finalOutput);
          }
        ),
        { numRuns: 100 }
      );

      await fs.rm(tmpDir, { recursive: true });
    }
  );
});

describe("compareBranches property B: identical branches", () => {
  it(
    "compareBranches(t, t) returns firstDiff null and zero stats",
    async () => {
      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "chrono-cmp-same-")
      );

      await fc.assert(
        fc.asyncProperty(safeTask, async (task) => {
          const t = await recordTrace(task, tmpDir);

          const result = compareBranches(t, t);

          expect(result.firstDiff).toBeNull();
          expect(result.a.totalTokens).toBe(0);
          expect(result.a.totalCostUsd).toBe(0);
          expect(result.a.totalDurationMs).toBe(0);
          expect(result.a.finalOutput).toBeNull();
          expect(result.b.totalTokens).toBe(0);
          expect(result.b.totalCostUsd).toBe(0);
          expect(result.b.totalDurationMs).toBe(0);
          expect(result.b.finalOutput).toBeNull();
        }),
        { numRuns: 100 }
      );

      await fs.rm(tmpDir, { recursive: true });
    }
  );
});
