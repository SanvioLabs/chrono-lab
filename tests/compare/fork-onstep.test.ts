// tests/compare/fork-onstep.test.ts
// Task 2 (C-03): forkTrace forwards each live step to options.onStep, in order,
// and the steps collected by onStep equal the live steps in the saved branch.
//
// Written before the onStep wiring. Until forkTrace forwards live steps to
// options.onStep, the collected list is empty and the assertions fail.

import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Recorder } from "../../src/recorder/recorder.js";
import { forkTrace } from "../../src/compare/fork.js";
import { makeStandInAdapters } from "../fixtures/stand-in-agent.js";
import type { ModelCallStep, Step } from "../../src/trace/types.js";

describe("forkTrace onStep (C-03)", () => {
  it("calls onStep once per live step, in order, matching the saved branch's live steps", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-onstep-"));
    const adapters = makeStandInAdapters();

    const recorder = new Recorder({
      modelAdapter: adapters.modelAdapter,
      toolRegistry: adapters.toolRegistry,
      traceDir: tmpDir,
    });

    // Parent run: model_call, tool_call, tool_result, model_call.
    const parentTrace = await recorder.run("hello");

    // Fork at the first model_call. The stand-in's responses 2 and 3 drive the
    // fork live phase (tool_calls then stop), so the live future has the same
    // four-step shape.
    const firstModelStep = parentTrace.steps.find(
      (s): s is ModelCallStep => s.kind === "model_call"
    )!;
    expect(firstModelStep).toBeDefined();

    const collected: Step[] = [];

    const result = await forkTrace({
      parentTrace,
      forkEdit: {
        forkPointStepId: firstModelStep.id,
        edit: { kind: "model_call", field: "model", value: "fake" },
      },
      modelAdapter: adapters.modelAdapter,
      toolRegistry: adapters.toolRegistry,
      traceDir: tmpDir,
      capConfig: { sessionLimitUsd: 10, overallLimitUsd: 100 },
      onStep: (step) => collected.push(step),
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    // The saved branch's live steps (in order).
    const branchLiveSteps = result.branch.steps.filter((s) => s.live);

    // onStep must have fired once per live step, and in the same order.
    expect(collected).toHaveLength(branchLiveSteps.length);
    expect(collected.map((s) => s.kind)).toEqual(
      branchLiveSteps.map((s) => s.kind)
    );
    expect(collected.map((s) => s.id)).toEqual(
      branchLiveSteps.map((s) => s.id)
    );

    // The immediate model-call edit step (the fork point's live step) is
    // included: the first collected step is a model_call and is edited.
    expect(collected[0]?.kind).toBe("model_call");
    expect(collected[0]?.edited).toBe(true);

    await fs.rm(tmpDir, { recursive: true });
  });
});
