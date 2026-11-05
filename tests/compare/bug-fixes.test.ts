// tests/compare/bug-fixes.test.ts
// Regression tests for the four bugs fixed in spec 02 review.
//
// Bug 1: Spend caps reset on every fork (shared ledger).
// Bug 2: Spend added after a call is the estimate, not actual cost.
// Bug 3: A cap hit part way through the live future loses completed steps.
// Bug 4: No test catches a stale answer after a model call edit.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Recorder } from "../../src/recorder/recorder.js";
import { forkTrace } from "../../src/compare/fork.js";
import {
  createSpendLedger,
  computeActualCostUsd,
  MODEL_PRICES,
  estimateCallCostUsd,
} from "../../src/server/caps.js";
import type {
  ModelCallInput,
  ModelCallOutput,
  Trace,
  ModelCallStep,
} from "../../src/trace/types.js";
import type { ModelAdapter, ToolRegistry } from "../../src/recorder/types.js";
import { makeStandInAdapters } from "../fixtures/stand-in-agent.js";

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let parentTrace: Trace;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-bugfix-"));

  const adapters = makeStandInAdapters();
  const recorder = new Recorder({
    modelAdapter: adapters.modelAdapter,
    toolRegistry: adapters.toolRegistry,
    traceDir: tmpDir,
  });

  // 4 steps: model_call(stub), tool_call, tool_result, model_call(stub).
  parentTrace = await recorder.run("hello");
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GPT4O = MODEL_PRICES["gpt-4o"]!;

// A tool registry with a no-op echo tool.
const echoRegistry: ToolRegistry = {
  echo: async (args) => args["text"],
};

// A stop response with optional token counts.
function stopResponse(tokens?: { input: number; output: number }): ModelCallOutput {
  return {
    message: { role: "assistant", content: "done" },
    finishReason: "stop",
    ...(tokens ? { tokens } : {}),
  };
}

// A tool-call response with optional token counts.
function toolCallResponse(
  id: string,
  tokens?: { input: number; output: number }
): ModelCallOutput {
  return {
    message: { role: "assistant", content: "" },
    finishReason: "tool_calls",
    toolCalls: [{ id, name: "echo", arguments: { text: "x" } }],
    ...(tokens ? { tokens } : {}),
  };
}

// Adapter that returns each response in sequence.
function sequenceAdapter(responses: ModelCallOutput[]): ModelAdapter {
  let cursor = 0;
  return async (_input: ModelCallInput): Promise<ModelCallOutput> => {
    const r = responses[cursor];
    if (r === undefined) {
      throw new Error(`sequenceAdapter exhausted at cursor=${cursor}`);
    }
    cursor += 1;
    return r;
  };
}

// ---------------------------------------------------------------------------
// Bug 1: shared ledger prevents spending past the cap across forks.
//
// Two forks share one ledger. The first fork makes one live model call. The
// second fork's pre-call estimate check adds its estimate on top of the spend
// the first fork left in the shared ledger and trips the cap.
//
// Without the fix (each fork creates capState = {0,0}), the second fork's
// check sees 0 accumulated spend and succeeds. With the fix it returns cap_hit.
// ---------------------------------------------------------------------------

describe("bug 1: shared ledger carries spend across forks", () => {
  it("second fork is cap_hit when the first fork exhausted the budget", async () => {
    // The pre-call cap check uses the estimate (maxTokens times the output
    // price), not the actual cost. Default maxTokens is 1024 when settings
    // omit it, so each fork's pre-call estimate is estimateCallCostUsd.
    //   est    = 1024 * GPT4O.outputUsdPerToken
    //   actual = 1    * GPT4O.outputUsdPerToken   (tokens {input:0, output:1})
    const est = estimateCallCostUsd("gpt-4o", 1024);
    const actualCostFirstCall = computeActualCostUsd("gpt-4o", 0, 1);

    // Size the session cap at exactly one estimate:
    //   first fork:  0 + est  <= est   -> passes, then charges actual (< est)
    //   second fork: actual + est > est -> trips, because actual > 0
    // checkCaps trips only on strictly greater, so the first fork's equal case
    // passes. The second fork trips only because the shared ledger carries the
    // first fork's actual spend. With a fresh ledger it would start at 0 and
    // pass, which is the bug this test guards against.
    const capConfig = {
      sessionLimitUsd: est,
      overallLimitUsd: 1.0,
    };

    const firstModelStep = parentTrace.steps.find(
      (s): s is ModelCallStep => s.kind === "model_call"
    )!;
    expect(firstModelStep).toBeDefined();

    const forkBase = {
      parentTrace,
      forkEdit: {
        forkPointStepId: firstModelStep.id,
        edit: { kind: "model_call" as const, field: "model" as const, value: "gpt-4o" },
      },
      toolRegistry: echoRegistry,
      traceDir: tmpDir,
      capConfig,
    };

    // First fork: one live call (stop response). Actual cost = GPT4O.outputUsdPerToken.
    const liveAdapter1 = sequenceAdapter([stopResponse({ input: 0, output: 1 })]);
    const ledger = createSpendLedger();

    const first = await forkTrace({ ...forkBase, modelAdapter: liveAdapter1, spendLedger: ledger });
    expect(first.status).toBe("ok");

    // Ledger now holds actualCostFirstCall.
    expect(ledger.get().sessionSpendUsd).toBeCloseTo(actualCostFirstCall, 12);

    // Second fork: ledger (actual) + estimate (1024 * outputUsdPerToken) > cap.
    const liveAdapter2 = sequenceAdapter([stopResponse({ input: 0, output: 1 })]);
    const second = await forkTrace({ ...forkBase, modelAdapter: liveAdapter2, spendLedger: ledger });
    expect(second.status).toBe("cap_hit");
  });
});

// ---------------------------------------------------------------------------
// Bug 2: actual cost from token counts is added, not the estimate.
//
// The fork changes the model to gpt-4o. The pre-call estimate uses the default
// maxTokens (1024) and gpt-4o's output price. The adapter returns a response
// with tiny token counts so the actual cost is far smaller than the estimate.
// The ledger must hold the actual, not the estimate.
//
// Without the fix (ledger.add(estimated) instead of ledger.add(actual)),
// the ledger holds the estimate and the close-to assertion fails.
// ---------------------------------------------------------------------------

describe("bug 2: actual cost is added to the ledger, not the estimate", () => {
  it("ledger reflects token counts from the response, not maxTokens * price", async () => {
    // Default maxTokens = 1024 in the cap check when settings.maxTokens is absent.
    const estimate = estimateCallCostUsd("gpt-4o", 1024);

    // Actual: 1 input token + 1 output token.
    const actual = computeActualCostUsd("gpt-4o", 1, 1);

    // The two must genuinely differ to guard against a vacuous test.
    expect(actual).toBeLessThan(estimate / 100);

    const ledger = createSpendLedger();

    // Cap large enough to never interfere.
    const capConfig = {
      sessionLimitUsd: estimate * 100,
      overallLimitUsd: estimate * 100,
    };

    const firstModelStep = parentTrace.steps.find(
      (s): s is ModelCallStep => s.kind === "model_call"
    )!;
    expect(firstModelStep).toBeDefined();

    // One call that returns tiny token counts and stops.
    const liveAdapter = sequenceAdapter([stopResponse({ input: 1, output: 1 })]);

    const result = await forkTrace({
      parentTrace,
      forkEdit: {
        forkPointStepId: firstModelStep.id,
        edit: { kind: "model_call", field: "model", value: "gpt-4o" },
      },
      modelAdapter: liveAdapter,
      toolRegistry: echoRegistry,
      traceDir: tmpDir,
      capConfig,
      spendLedger: ledger,
    });

    expect(result.status).toBe("ok");

    // Ledger must hold the actual cost, not the estimate.
    expect(ledger.get().sessionSpendUsd).toBeCloseTo(actual, 12);
    expect(ledger.get().sessionSpendUsd).not.toBeCloseTo(estimate, 5);
  });
});

// ---------------------------------------------------------------------------
// Bug 3: partial branch keeps completed live steps on a cap hit mid-loop.
//
// The fork edits the first model_call step (changing model to gpt-4o). The
// live adapter returns tool_call responses so the loop runs multiple turns.
// Each pre-call check uses the estimate, so the cap is sized from the estimate
// plus one actual charge to let exactly two charged calls through.
//
// The live phase produces:
//   - call 0 (direct from forkTrace): check 0 + est <= cap, charged (actual)
//   - prefill call inside continueFrom: pre-computed, no check and no charge
//   - call 2 (cap-aware): check actual + est <= cap, charged (actual)
//   - call 3 (cap-aware): check 2*actual + est > cap, trips CapSentinel
//
// collectedLiveSteps at CapSentinel time (6 steps):
//   model_call-1, tool_call-1, tool_result-1,
//   model_call-2, tool_call-2, tool_result-2
//
// stepsAfterEdited = slice(1) = 5 steps.
// Branch live steps = editedStep + 5 = 6 total.
//
// Without the fix, the partial branch has 0 live steps.
// ---------------------------------------------------------------------------

describe("bug 3: partial branch keeps completed steps on cap hit", () => {
  it("partial branch has exactly the live steps that completed before the cap", async () => {
    // Pre-call checks use the estimate; charges use the actual cost.
    //   est    = 1024 * GPT4O.outputUsdPerToken   (default maxTokens)
    //   actual = 1    * GPT4O.outputUsdPerToken   (tokens {input:0, output:1})
    const est = estimateCallCostUsd("gpt-4o", 1024);
    const actual = computeActualCostUsd("gpt-4o", 0, 1);

    // Cap = est + actual. This lets exactly two charged calls through:
    //   call 0 check: 0 + est          <= est + actual  -> passes
    //   call 2 check: actual + est     <= est + actual  -> passes (equal)
    //   call 3 check: 2*actual + est   >  est + actual   -> trips (actual > 0)
    // checkCaps trips only on strictly greater, so the equal case on call 2
    // passes.
    const capConfig = {
      sessionLimitUsd: est + actual,
      overallLimitUsd: 1.0,
    };

    // cursor 0: direct call 0 (forkTrace's immediate live call)
    // cursor 1: cap-aware call 2 inside continueFrom
    // cursor 2: never reached (cap fires before call 3)
    const liveAdapter = sequenceAdapter([
      toolCallResponse("tc-0", { input: 0, output: 1 }),
      toolCallResponse("tc-1", { input: 0, output: 1 }),
      toolCallResponse("tc-2", { input: 0, output: 1 }),
    ]);

    const ledger = createSpendLedger();

    const firstModelStep = parentTrace.steps.find(
      (s): s is ModelCallStep => s.kind === "model_call"
    )!;
    expect(firstModelStep).toBeDefined();

    const result = await forkTrace({
      parentTrace,
      forkEdit: {
        forkPointStepId: firstModelStep.id,
        edit: { kind: "model_call", field: "model", value: "gpt-4o" },
      },
      modelAdapter: liveAdapter,
      toolRegistry: echoRegistry,
      traceDir: tmpDir,
      capConfig,
      spendLedger: ledger,
    });

    expect(result.status).toBe("cap_hit");
    if (result.status !== "cap_hit") return;

    const branch = result.partialBranch;
    const liveSteps = branch.steps.filter((s) => s.live);

    // editedStep (model_call) + 5 from stepsAfterEdited = 6 live steps.
    expect(liveSteps).toHaveLength(6);
    expect(liveSteps.filter((s) => s.kind === "model_call")).toHaveLength(2);
    expect(liveSteps.filter((s) => s.kind === "tool_call")).toHaveLength(2);
    expect(liveSteps.filter((s) => s.kind === "tool_result")).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Bug 4: edited model_call step carries the live output, not the recorded one.
//
// The parent is recorded with an adapter that returns "Original answer".
// The fork live adapter returns "Different answer".
// The edited step must carry "Different answer".
//
// Without the fix (output: originalStep.output), the edited step holds
// "Original answer" and both assertions below fail.
// ---------------------------------------------------------------------------

describe("bug 4: edited model_call step carries the live output", () => {
  let parentWithKnownOutput: Trace;
  const ORIGINAL_CONTENT = "Original answer";
  const LIVE_CONTENT = "Different answer";

  beforeAll(async () => {
    const originalAdapter: ModelAdapter = async (): Promise<ModelCallOutput> => ({
      message: { role: "assistant", content: ORIGINAL_CONTENT },
      finishReason: "stop",
    });

    const recorder = new Recorder({
      modelAdapter: originalAdapter,
      toolRegistry: echoRegistry,
      traceDir: tmpDir,
    });

    parentWithKnownOutput = await recorder.run("test task");
  });

  it("edited step output is the live answer, not the recorded answer", async () => {
    const liveAdapter: ModelAdapter = async (): Promise<ModelCallOutput> => ({
      message: { role: "assistant", content: LIVE_CONTENT },
      finishReason: "stop",
    });

    const firstModelStep = parentWithKnownOutput.steps.find(
      (s): s is ModelCallStep => s.kind === "model_call"
    )!;
    expect(firstModelStep).toBeDefined();

    // Confirm the parent step has the original content (verifies the test
    // setup is correct).
    expect(firstModelStep.output.message.content).toBe(ORIGINAL_CONTENT);

    const result = await forkTrace({
      parentTrace: parentWithKnownOutput,
      forkEdit: {
        forkPointStepId: firstModelStep.id,
        edit: { kind: "model_call", field: "model", value: "fork-model" },
      },
      modelAdapter: liveAdapter,
      toolRegistry: echoRegistry,
      traceDir: tmpDir,
      capConfig: { sessionLimitUsd: 10, overallLimitUsd: 100 },
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const editedStep = result.branch.steps.find(
      (s): s is ModelCallStep => s.edited && s.kind === "model_call"
    );
    expect(editedStep).toBeDefined();

    // The edited step must carry the live answer.
    expect(editedStep!.output.message.content).toBe(LIVE_CONTENT);

    // It must differ from the recorded answer in the parent.
    expect(editedStep!.output.message.content).not.toBe(ORIGINAL_CONTENT);
  });
});
