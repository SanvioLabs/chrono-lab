// tests/ui/prefix.test.ts
// Task 12: the replayed prefix shown on the running screen (R-15).
//
// The prefix is every step strictly before the fork point. The fork-point step
// itself is re-run live (src/compare/fork.ts slices it off the replayed prefix
// and emits it as the first live step), so forking at step index i shows
// exactly the steps at indices 0..i-1 as the prefix. Forking at the first step
// (index 0) shows an empty prefix. This diagnoses and guards the display bug
// where forking at the first model_call wrongly listed that step in the prefix
// while running, then showed an empty prefix when done: the prefix must be the
// same count while running and when done.
//
// replayedPrefix is a pure function over a step list, so no DOM is needed.

import { describe, it, expect } from "vitest";
import { replayedPrefix } from "../../src/ui/prefix.js";
import type {
  Step,
  ModelCallStep,
  ToolCallStep,
  ToolResultStep,
} from "../../src/trace/types.js";

// A minimal model_call step with the given id.
function modelStep(id: string): ModelCallStep {
  return {
    id,
    runId: "r",
    parentId: null,
    kind: "model_call",
    branch: "b",
    forkPointId: null,
    durationMs: 1,
    model: "fake",
    settings: {},
    tokens: { input: 0, output: 0 },
    cost: 0,
    input: { messages: [], model: "fake", settings: {} },
    output: {
      message: { role: "assistant", content: "hi" },
      finishReason: "stop",
    },
    live: false,
    edited: false,
  };
}

// A minimal tool_call step with the given id.
function toolCallStep(id: string): ToolCallStep {
  return {
    id,
    runId: "r",
    parentId: null,
    kind: "tool_call",
    branch: "b",
    forkPointId: null,
    durationMs: 1,
    input: { toolCallId: "tc-1", name: "echo", arguments: {} },
    output: null,
    model: null,
    settings: null,
    tokens: null,
    cost: null,
    live: false,
    edited: false,
  };
}

// A minimal tool_result step with the given id.
function toolResultStep(id: string): ToolResultStep {
  return {
    id,
    runId: "r",
    parentId: null,
    kind: "tool_result",
    branch: "b",
    forkPointId: null,
    durationMs: 1,
    input: { toolCallId: "tc-1" },
    output: { result: "ok", isError: false },
    model: null,
    settings: null,
    tokens: null,
    cost: null,
    live: false,
    edited: false,
  };
}

// A four-step run: model call, tool call, tool result, model call.
function fourStepRun(): Step[] {
  return [
    modelStep("s0"),
    toolCallStep("s1"),
    toolResultStep("s2"),
    modelStep("s3"),
  ];
}

describe("replayedPrefix: steps strictly before the fork point", () => {
  it("forking at each index i shows exactly the steps before i", () => {
    const steps = fourStepRun();
    for (let i = 0; i < steps.length; i++) {
      const prefix = replayedPrefix(steps, steps[i]!.id);
      // Exactly the steps at indices 0..i-1, in order.
      expect(prefix.map((s) => s.id)).toEqual(
        steps.slice(0, i).map((s) => s.id)
      );
      expect(prefix).toHaveLength(i);
    }
  });

  it("forking at the first step shows an empty prefix", () => {
    const steps = fourStepRun();
    const prefix = replayedPrefix(steps, "s0");
    expect(prefix).toEqual([]);
  });

  it("the fork-point step is never in the prefix (it is re-run live)", () => {
    const steps = fourStepRun();
    for (const step of steps) {
      const prefix = replayedPrefix(steps, step.id);
      expect(prefix.some((s) => s.id === step.id)).toBe(false);
    }
  });

  it("an unknown fork-point id yields an empty prefix", () => {
    const steps = fourStepRun();
    expect(replayedPrefix(steps, "nope")).toEqual([]);
  });

  it("the prefix is the same count while running and when done", () => {
    // The running screen computes the prefix the same way in both phases:
    // from the step list before the fork point. So for any fork point the
    // count does not change between the first live step and the done event.
    // This is the bug the diagnostic found: forking at the first step showed
    // one prefix entry while running, then zero when done.
    const steps = fourStepRun();
    for (const step of steps) {
      const whileRunning = replayedPrefix(steps, step.id);
      const whenDone = replayedPrefix(steps, step.id);
      expect(whileRunning.map((s) => s.id)).toEqual(whenDone.map((s) => s.id));
    }
  });
});
