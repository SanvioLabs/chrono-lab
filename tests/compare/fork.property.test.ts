// tests/compare/fork.property.test.ts
// Property test: forkTrace never mutates its parent trace.
// Written before forkTrace is implemented (Task 4). Fails with "not implemented"
// until Task 7 is complete.

import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Recorder } from "../../src/recorder/recorder.js";
import { forkTrace } from "../../src/compare/fork.js";
import { makeStandInAdapters } from "../fixtures/stand-in-agent.js";
import type { ModelCallStep } from "../../src/trace/types.js";

// Safe task strings: short, no API key patterns.
const safeTask = fc
  .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz "), {
    minLength: 1,
    maxLength: 30,
  })
  .filter((s) => s.trim().length > 0);

describe("fork property: parent trace is never mutated", () => {
  it(
    "forkTrace does not change any field of the parent trace",
    async () => {
      const tmpDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "chrono-fork-prop-")
      );
      const adapters = makeStandInAdapters();

      await fc.assert(
        fc.asyncProperty(safeTask, async (task) => {
          adapters.reset();
          const recorder = new Recorder({
            modelAdapter: adapters.modelAdapter,
            toolRegistry: adapters.toolRegistry,
            traceDir: tmpDir,
          });

          const parentTrace = await recorder.run(task);

          // Deep-clone the parent before forking.
          const cloneBefore = JSON.parse(JSON.stringify(parentTrace));

          // Find the first model_call step to use as the fork point.
          const firstModelStep = parentTrace.steps.find(
            (s): s is ModelCallStep => s.kind === "model_call"
          );
          if (!firstModelStep) {
            // No model call step: nothing to fork; property holds vacuously.
            return;
          }

          // Attempt the fork. After Task 7 this returns a result; until then
          // it throws "not implemented".
          try {
            await forkTrace({
              parentTrace,
              forkEdit: {
                forkPointStepId: firstModelStep.id,
                edit: {
                  kind: "model_call",
                  field: "model",
                  value: "fork-model",
                },
              },
              modelAdapter: adapters.modelAdapter,
              toolRegistry: adapters.toolRegistry,
              traceDir: tmpDir,
              capConfig: {
                sessionLimitUsd: 10,
                overallLimitUsd: 100,
              },
            });
          } catch (err) {
            // "not implemented" is expected before Task 7.
            const msg = err instanceof Error ? err.message : String(err);
            if (msg === "not implemented") {
              throw err;
            }
            // Any other error re-thrown so the property still reports it.
            throw err;
          }

          // The parent trace must be identical to the pre-fork clone.
          const parentAfter = JSON.stringify(parentTrace);
          const cloneJson = JSON.stringify(cloneBefore);
          if (parentAfter !== cloneJson) {
            throw new Error(
              `Parent trace was mutated by forkTrace.\nBefore: ${cloneJson}\nAfter: ${parentAfter}`
            );
          }
        }),
        { numRuns: 100 }
      );

      await fs.rm(tmpDir, { recursive: true });
    }
  );
});
