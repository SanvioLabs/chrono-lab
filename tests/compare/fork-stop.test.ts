// tests/compare/fork-stop.test.ts
// Task 2 (C-03): aborting the signal after the first live step saves a partial
// branch holding the prefix plus exactly the steps completed before the abort,
// makes no further live call, and rewrites none of the steps already passed to
// onStep. A stop is a clean, saved result (ForkSuccess), not a cap hit; the
// branch is simply shorter.
//
// Written before the signal wiring. Until forkTrace checks signal.aborted in
// its step callback and falls through to save the partial branch, the fork
// either runs to completion (too many live steps) or never saves a shorter
// branch, so the assertions fail.

import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Recorder } from "../../src/recorder/recorder.js";
import { forkTrace } from "../../src/compare/fork.js";
import type {
  ModelCallInput,
  ModelCallOutput,
  ModelCallStep,
  Step,
} from "../../src/trace/types.js";
import type { ModelAdapter, ToolRegistry } from "../../src/recorder/types.js";
import { makeStandInAdapters } from "../fixtures/stand-in-agent.js";

const echoRegistry: ToolRegistry = {
  echo: async (args) => args["text"],
};

describe("forkTrace signal / stop (C-03)", () => {
  it("abort after the first live step saves the prefix plus that step, makes no further live call, and rewrites nothing already streamed", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-stop-"));

    // Record a parent run with the stand-in (4 steps).
    const standIn = makeStandInAdapters();
    const recorder = new Recorder({
      modelAdapter: standIn.modelAdapter,
      toolRegistry: standIn.toolRegistry,
      traceDir: tmpDir,
    });
    const parentTrace = await recorder.run("hello");

    const firstModelStep = parentTrace.steps.find(
      (s): s is ModelCallStep => s.kind === "model_call"
    )!;
    expect(firstModelStep).toBeDefined();

    // A live adapter that would, if left to run, keep producing tool-call turns
    // forever. We count its invocations so we can prove no further live call is
    // made after the abort. The first call (the edited model_call) returns a
    // tool_calls response so there would be more steps if we did not stop.
    let liveCalls = 0;
    const liveAdapter: ModelAdapter = async (
      _input: ModelCallInput
    ): Promise<ModelCallOutput> => {
      liveCalls += 1;
      return {
        message: { role: "assistant", content: "" },
        finishReason: "tool_calls",
        toolCalls: [
          { id: `call-${liveCalls}`, name: "echo", arguments: { text: "x" } },
        ],
      };
    };

    const controller = new AbortController();
    const streamed: Step[] = [];

    // Abort as soon as the first live step (the edited model_call) arrives.
    const onStep = (step: Step): void => {
      streamed.push(step);
      if (streamed.length === 1) {
        controller.abort();
      }
    };

    const liveCallsBefore = liveCalls;

    const result = await forkTrace({
      parentTrace,
      forkEdit: {
        forkPointStepId: firstModelStep.id,
        edit: { kind: "model_call", field: "model", value: "fake" },
      },
      modelAdapter: liveAdapter,
      toolRegistry: echoRegistry,
      traceDir: tmpDir,
      capConfig: { sessionLimitUsd: 10, overallLimitUsd: 100 },
      onStep,
      signal: controller.signal,
    });

    // A stop is a clean, saved result, not a cap hit.
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    const branch = result.branch;

    // Exactly one live step was streamed (the edited model_call) before abort.
    expect(streamed).toHaveLength(1);
    expect(streamed[0]?.kind).toBe("model_call");

    // The saved branch holds the replayed prefix plus exactly the one live
    // step completed before the abort.
    const liveSteps = branch.steps.filter((s) => s.live);
    expect(liveSteps).toHaveLength(1);
    expect(liveSteps[0]?.id).toBe(streamed[0]?.id);

    // The prefix (replayed steps) is still present: the first model_call is the
    // edited live step, so the prefix before it is empty here, but the branch
    // must still carry the fork metadata and only the completed steps.
    expect(branch.parentRunId).toBe(parentTrace.runId);
    expect(branch.forkPointStepId).toBe(firstModelStep.id);

    // No further live call was made after the abort. The edited model_call ran
    // once (liveCalls incremented from the immediate edit), and nothing after.
    expect(liveCalls - liveCallsBefore).toBe(1);

    // The step already passed to onStep is not rewritten in the saved branch:
    // its id and output match exactly what was streamed.
    const streamedFirst = streamed[0]!;
    const savedFirst = liveSteps[0]!;
    expect(savedFirst.id).toBe(streamedFirst.id);
    expect(JSON.stringify(savedFirst.output)).toBe(
      JSON.stringify(streamedFirst.output)
    );

    await fs.rm(tmpDir, { recursive: true });
  });
});
