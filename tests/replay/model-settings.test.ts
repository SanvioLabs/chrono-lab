// tests/replay/model-settings.test.ts
// Strict replay must call the model adapter with the recorded step's own
// model and settings, not a hard-coded "stub" with empty settings.
//
// Spec 01's replay loop drove every call with model "stub" and settings {}.
// That only matched traces recorded with those exact values. A trace recorded
// with any other model, or with non-empty settings, failed strict replay with
// a model_call input mismatch. This test records such a trace and replays it
// strictly: it fails on the pre-fix code and passes once the loop reads the
// recorded model and settings.

import { describe, it, expect } from "vitest";
import { replayTrace } from "../../src/replay/replay.js";
import { TRACE_VERSION } from "../../src/trace/types.js";
import type {
  Trace,
  ModelCallStep,
  ToolCallStep,
  ToolResultStep,
  ModelSettings,
} from "../../src/trace/types.js";

// A model named something other than "stub", and non-empty settings. Replay
// must thread both of these back into the adapter input it compares against
// the recording.
const MODEL = "gpt-demo";
const SETTINGS: ModelSettings = { temperature: 0.7, maxTokens: 256 };

const RUN_ID = "run-model-settings";

// Build a trace with two model_call steps around one tool call/result pair.
// Each model_call records model "gpt-demo" and non-empty settings, so strict
// replay can only match if the loop reads them from the recording.
function buildTrace(): Trace {
  const firstModel: ModelCallStep = {
    id: `${RUN_ID}-0`,
    runId: RUN_ID,
    parentId: null,
    kind: "model_call",
    branch: "main",
    forkPointId: null,
    durationMs: 1,
    model: MODEL,
    settings: SETTINGS,
    tokens: { input: 0, output: 0 },
    cost: 0,
    input: {
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "hello" },
      ],
      model: MODEL,
      settings: SETTINGS,
    },
    output: {
      message: { role: "assistant", content: "" },
      finishReason: "tool_calls",
      toolCalls: [{ id: "call-1", name: "echo", arguments: { text: "hello" } }],
    },
    live: false,
    edited: false,
  };

  const toolCall: ToolCallStep = {
    id: `${RUN_ID}-1`,
    runId: RUN_ID,
    parentId: firstModel.id,
    kind: "tool_call",
    branch: "main",
    forkPointId: null,
    durationMs: 1,
    model: null,
    settings: null,
    tokens: null,
    cost: null,
    input: { toolCallId: "call-1", name: "echo", arguments: { text: "hello" } },
    output: null,
    live: false,
    edited: false,
  };

  const toolResult: ToolResultStep = {
    id: `${RUN_ID}-2`,
    runId: RUN_ID,
    parentId: toolCall.id,
    kind: "tool_result",
    branch: "main",
    forkPointId: null,
    durationMs: 1,
    model: null,
    settings: null,
    tokens: null,
    cost: null,
    input: { toolCallId: "call-1" },
    output: { result: "hello", isError: false },
    live: false,
    edited: false,
  };

  // The second model_call's recorded input carries the full message list the
  // recorder would have had after the tool result: the assistant turn and the
  // tool message appended to the first call's messages.
  const secondModel: ModelCallStep = {
    id: `${RUN_ID}-3`,
    runId: RUN_ID,
    parentId: toolResult.id,
    kind: "model_call",
    branch: "main",
    forkPointId: null,
    durationMs: 1,
    model: MODEL,
    settings: SETTINGS,
    tokens: { input: 0, output: 0 },
    cost: 0,
    input: {
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "hello" },
        { role: "assistant", content: "" },
        { role: "tool", content: "hello", toolCallId: "call-1" },
      ],
      model: MODEL,
      settings: SETTINGS,
    },
    output: {
      message: { role: "assistant", content: "Final answer: hello" },
      finishReason: "stop",
    },
    live: false,
    edited: false,
  };

  return {
    version: TRACE_VERSION,
    runId: RUN_ID,
    createdAt: "2026-11-04T00:00:00.000Z",
    steps: [firstModel, toolCall, toolResult, secondModel],
    endReason: "stop",
  };
}

describe("strict replay with a non-stub model and non-empty settings", () => {
  it("replays a trace recorded with model other than stub and non-empty settings", async () => {
    const trace = buildTrace();

    // Strict is the default. On the pre-fix loop this throws
    // ReplayError: model_call input mismatch, because the loop drove the
    // adapter with model "stub" and settings {} while the recording held
    // "gpt-demo" and { temperature, maxTokens }.
    const replayed = await replayTrace(trace);

    expect(replayed.steps.map((s) => s.kind)).toEqual([
      "model_call",
      "tool_call",
      "tool_result",
      "model_call",
    ]);

    // Replayed model_call steps carry the recorded model and settings.
    const modelSteps = replayed.steps.filter(
      (s): s is ModelCallStep => s.kind === "model_call"
    );
    for (const s of modelSteps) {
      expect(s.model).toBe(MODEL);
      expect(s.settings).toEqual(SETTINGS);
      expect(s.input.model).toBe(MODEL);
      expect(s.input.settings).toEqual(SETTINGS);
    }

    // Replaying an unchanged prefix gives back exactly the recorded steps.
    expect(JSON.stringify(replayed.steps)).toBe(JSON.stringify(trace.steps));
  });
});
