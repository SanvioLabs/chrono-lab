// tests/ui/editTarget.test.ts
// Task 12: step resolution for the edit region (R-14) and the kept partial
// branch on the running region (R-18).
//
// resolveEditStep and splitBranch are pure functions, so no DOM is needed. The
// edit-region case this guards: selecting model call A and then model call B
// must resolve to B, so the editor follows a model-to-model selection. The real
// render is asserted in the lab e2e test (select the first model call, then the
// last one, and check the editor shows the last one's messages). splitBranch
// reads a saved branch's replayed prefix and live steps straight from the
// branch, so the cap_reached running region shows exactly what was saved.

import { describe, it, expect } from "vitest";
import { resolveEditStep, splitBranch } from "../../src/ui/editTarget.js";
import { TRACE_VERSION } from "../../src/trace/types.js";
import type {
  Trace,
  Step,
  Message,
  ModelCallStep,
  ToolCallStep,
  ToolResultStep,
} from "../../src/trace/types.js";

// A model_call step with the given id and prompt messages. live/edited default
// false (a replayed/recorded step) unless overridden.
function modelStep(
  id: string,
  messages: Message[],
  flags: Partial<Pick<ModelCallStep, "live" | "edited">> = {}
): ModelCallStep {
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
    input: { messages, model: "fake", settings: {} },
    output: {
      message: { role: "assistant", content: "hi" },
      finishReason: "stop",
    },
    live: flags.live ?? false,
    edited: flags.edited ?? false,
  };
}

function toolCallStep(
  id: string,
  flags: Partial<Pick<ToolCallStep, "live" | "edited">> = {}
): ToolCallStep {
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
    live: flags.live ?? false,
    edited: flags.edited ?? false,
  };
}

function toolResultStep(
  id: string,
  flags: Partial<Pick<ToolResultStep, "live" | "edited">> = {}
): ToolResultStep {
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
    live: flags.live ?? false,
    edited: flags.edited ?? false,
  };
}

function trace(steps: Step[], extra: Partial<Trace> = {}): Trace {
  return {
    version: TRACE_VERSION,
    runId: "r",
    createdAt: "2026-01-01T00:00:00.000Z",
    steps,
    ...extra,
  };
}

// The first model call carries only system + user messages; the last also
// carries an assistant turn and a tool message, so the two resolve to visibly
// different editors, the same shape the lab e2e test asserts in the real DOM.
const FIRST_MESSAGES: Message[] = [
  { role: "system", content: "you are a helpful agent" },
  { role: "user", content: "summarise the meeting notes" },
];
const LAST_MESSAGES: Message[] = [
  { role: "system", content: "you are a helpful agent" },
  { role: "user", content: "summarise the meeting notes" },
  { role: "assistant", content: "calling a tool" },
  { role: "tool", content: "notes: ship on friday", toolCallId: "tc-1" },
];

describe("resolveEditStep: the editor follows the selection", () => {
  it("selecting model call A then model call B resolves to B", () => {
    const first = modelStep("s0", FIRST_MESSAGES);
    const last = modelStep("s3", LAST_MESSAGES);
    const t = trace([first, toolCallStep("s1"), toolResultStep("s2"), last]);

    // Select A: resolves to A.
    const a = resolveEditStep(t, "s0");
    expect(a?.id).toBe("s0");
    expect((a as ModelCallStep).input.messages).toHaveLength(2);

    // Now select B: resolves to B, not A. The editor follows the second
    // model-to-model selection (the bug this guards).
    const b = resolveEditStep(t, "s3");
    expect(b?.id).toBe("s3");
    expect((b as ModelCallStep).input.messages).toHaveLength(4);
    // B has an assistant and a tool message that A does not.
    const roles = (b as ModelCallStep).input.messages.map((m) => m.role);
    expect(roles).toContain("assistant");
    expect(roles).toContain("tool");
  });

  it("no selection resolves to undefined (the edit region shows its note)", () => {
    const t = trace([modelStep("s0", FIRST_MESSAGES)]);
    expect(resolveEditStep(t, null)).toBeUndefined();
  });

  it("an unknown selected id resolves to undefined", () => {
    const t = trace([modelStep("s0", FIRST_MESSAGES)]);
    expect(resolveEditStep(t, "nope")).toBeUndefined();
  });

  it("no loaded trace resolves to undefined", () => {
    expect(resolveEditStep(undefined, "s0")).toBeUndefined();
  });
});

describe("splitBranch: prefix and live steps read from the saved branch", () => {
  it("splits at the first live or edited step", () => {
    // A branch forked at s1: s0 replayed, s1 the edited fork-point step, s2/s3
    // live. The split puts s0 in the prefix and s1..s3 in the live steps.
    const t = trace(
      [
        modelStep("s0", FIRST_MESSAGES),
        modelStep("s1", LAST_MESSAGES, { live: true, edited: true }),
        toolCallStep("s2", { live: true }),
        toolResultStep("s3", { live: true }),
      ],
      { parentRunId: "p", forkPointStepId: "s1", endReason: "cap" }
    );
    const split = splitBranch(t);
    expect(split.prefix.map((s) => s.id)).toEqual(["s0"]);
    expect(split.live.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("a branch forked at the first step has an empty prefix", () => {
    const t = trace(
      [
        modelStep("s0", LAST_MESSAGES, { live: true, edited: true }),
        toolCallStep("s1", { live: true }),
      ],
      { parentRunId: "p", forkPointStepId: "s0", endReason: "cap" }
    );
    const split = splitBranch(t);
    expect(split.prefix).toEqual([]);
    expect(split.live.map((s) => s.id)).toEqual(["s0", "s1"]);
  });

  it("a run with no live step is all prefix and no live steps", () => {
    const t = trace([
      modelStep("s0", FIRST_MESSAGES),
      toolCallStep("s1"),
      toolResultStep("s2"),
      modelStep("s3", LAST_MESSAGES),
    ]);
    const split = splitBranch(t);
    expect(split.prefix.map((s) => s.id)).toEqual(["s0", "s1", "s2", "s3"]);
    expect(split.live).toEqual([]);
  });
});
