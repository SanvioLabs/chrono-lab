// tests/recorder/max-steps.test.ts
// The step bound (maxSteps) ends a run that never stops.
//
// A model that keeps asking for a tool would loop forever, and with a
// zero-cost model the spend caps never stop it. The Recorder ends the run
// cleanly at maxSteps and marks why (endReason "max_steps"); forkTrace passes
// the bound into the live phase, so a runaway fork ends the same way instead
// of exhausting memory.

import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Recorder, DEFAULT_MAX_STEPS } from "../../src/recorder/recorder.js";
import { forkTrace } from "../../src/compare/fork.js";
import type {
  ModelCallInput,
  ModelCallOutput,
  ModelCallStep,
} from "../../src/trace/types.js";
import type { ModelAdapter, ToolRegistry } from "../../src/recorder/types.js";

// A model that never stops: every turn asks for the echo tool again. Left
// unbounded it would loop forever.
function neverStopsAdapter(): ModelAdapter {
  let n = 0;
  return async (_input: ModelCallInput): Promise<ModelCallOutput> => {
    n += 1;
    return {
      message: { role: "assistant", content: "" },
      finishReason: "tool_calls",
      toolCalls: [{ id: `call-${n}`, name: "echo", arguments: { text: "x" } }],
    };
  };
}

const echoRegistry: ToolRegistry = {
  echo: async (args) => args["text"],
};

describe("Recorder step bound (maxSteps)", () => {
  it("ends a never-stopping record run at the bound, marking endReason max_steps", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-maxsteps-"));
    const maxSteps = 7;

    const recorder = new Recorder({
      modelAdapter: neverStopsAdapter(),
      toolRegistry: echoRegistry,
      traceDir: tmpDir,
      maxSteps,
    });

    const trace = await recorder.run("hello");

    // The run ended at the bound rather than looping forever.
    expect(trace.steps.length).toBeLessThanOrEqual(maxSteps);
    expect(trace.steps.length).toBeGreaterThan(0);
    expect(trace.endReason).toBe("max_steps");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("defaults the bound to DEFAULT_MAX_STEPS when none is given", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-maxdef-"));

    const recorder = new Recorder({
      modelAdapter: neverStopsAdapter(),
      toolRegistry: echoRegistry,
      traceDir: tmpDir,
    });

    const trace = await recorder.run("hello");

    expect(trace.steps.length).toBeLessThanOrEqual(DEFAULT_MAX_STEPS);
    expect(trace.endReason).toBe("max_steps");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("bounds a runaway fork live phase so it ends instead of looping forever", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-forkmax-"));

    // Record a short parent run (model_call then stop) to fork from.
    const parentRecorder = new Recorder({
      modelAdapter: async () => ({
        message: { role: "assistant", content: "done" },
        finishReason: "stop",
      }),
      toolRegistry: echoRegistry,
      traceDir: tmpDir,
    });
    const parentTrace = await parentRecorder.run("hello");

    const firstModelStep = parentTrace.steps.find(
      (s): s is ModelCallStep => s.kind === "model_call"
    )!;
    expect(firstModelStep).toBeDefined();

    const maxSteps = 9;

    // The live model never stops; the bound must end the fork cleanly.
    const result = await forkTrace({
      parentTrace,
      forkEdit: {
        forkPointStepId: firstModelStep.id,
        edit: { kind: "model_call", field: "model", value: "fake" },
      },
      modelAdapter: neverStopsAdapter(),
      toolRegistry: echoRegistry,
      traceDir: tmpDir,
      capConfig: { sessionLimitUsd: 10, overallLimitUsd: 100 },
      maxSteps,
    });

    // A step-bound end is a clean, saved result, not a cap hit.
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const liveSteps = result.branch.steps.filter((s) => s.live);
    expect(liveSteps.length).toBeLessThanOrEqual(maxSteps);
    expect(liveSteps.length).toBeGreaterThan(0);
    expect(result.branch.endReason).toBe("max_steps");

    await fs.rm(tmpDir, { recursive: true });
  });
});
