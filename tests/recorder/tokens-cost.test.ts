// tests/recorder/tokens-cost.test.ts
// The recorder records the tokens the model reported, and the matching cost
// from the price table (spec 01 R-01).
//
// The earlier recorder wrote tokens { input: 0, output: 0 } and cost 0 on every
// model_call step, whatever the model returned, so every trace showed zero
// tokens and zero cost and compare's totals were always zero. These tests fail
// on that version: they drive an adapter that reports tokens through a priced
// model and assert the recorded step carries those tokens and the computed
// cost.

import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Recorder } from "../../src/recorder/recorder.js";
import { computeActualCostUsd } from "../../src/server/caps.js";
import type {
  ModelCallInput,
  ModelCallOutput,
  ModelCallStep,
} from "../../src/trace/types.js";
import type { ModelAdapter, ToolRegistry } from "../../src/recorder/types.js";

const echoRegistry: ToolRegistry = {
  echo: async (args) => args["text"],
};

// An adapter that reports token counts and finishes on the first turn, so the
// run is one model_call step. Each turn reports a fixed, non-zero pair.
function reportingAdapter(
  inputTokens: number,
  outputTokens: number
): ModelAdapter {
  return async (_input: ModelCallInput): Promise<ModelCallOutput> => {
    return {
      message: { role: "assistant", content: "done" },
      finishReason: "stop",
      tokens: { input: inputTokens, output: outputTokens },
    };
  };
}

describe("Recorder records reported tokens and the matching cost (R-01)", () => {
  it("a step from an adapter reporting tokens carries those tokens and the price-table cost", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-tokens-"));

    const inputTokens = 100;
    const outputTokens = 50;
    const model = "gpt-4o"; // a priced model, so the cost is non-zero

    const recorder = new Recorder({
      modelAdapter: reportingAdapter(inputTokens, outputTokens),
      toolRegistry: echoRegistry,
      traceDir: tmpDir,
      modelName: model,
    });

    const trace = await recorder.run("hello");

    const modelStep = trace.steps.find(
      (s): s is ModelCallStep => s.kind === "model_call"
    );
    expect(modelStep).toBeDefined();

    // The recorded tokens match what the adapter reported, not zero.
    expect(modelStep!.tokens.input).toBe(inputTokens);
    expect(modelStep!.tokens.output).toBe(outputTokens);

    // The recorded cost matches the price table for the step's model.
    const expectedCost = computeActualCostUsd(model, inputTokens, outputTokens);
    expect(expectedCost).toBeGreaterThan(0);
    expect(modelStep!.cost).toBeCloseTo(expectedCost, 12);

    await fs.rm(tmpDir, { recursive: true });
  });

  it("a step from an adapter reporting no tokens carries zero tokens and zero cost", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-tokens0-"));

    // No tokens field on the output: the step records zero, not a guess.
    const noTokenAdapter: ModelAdapter = async () => ({
      message: { role: "assistant", content: "done" },
      finishReason: "stop",
    });

    const recorder = new Recorder({
      modelAdapter: noTokenAdapter,
      toolRegistry: echoRegistry,
      traceDir: tmpDir,
      modelName: "gpt-4o",
    });

    const trace = await recorder.run("hello");
    const modelStep = trace.steps.find(
      (s): s is ModelCallStep => s.kind === "model_call"
    )!;

    expect(modelStep.tokens).toEqual({ input: 0, output: 0 });
    expect(modelStep.cost).toBe(0);

    await fs.rm(tmpDir, { recursive: true });
  });
});
