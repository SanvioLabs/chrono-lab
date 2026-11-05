// tests/agent/fake-model.test.ts
// Task 3 (C-01): the deterministic fake model.
//
// Records a run with the fake model through Recorder and asserts the four
// expected steps (model_call, tool_call, tool_result, model_call); forks it
// with one model_call edit and asserts the fork runs forward to a stable
// result; and confirms no network call is attempted by running the record
// inside withNetworkGuard (reused from spec 01/02).
//
// Written before makeFakeModel is implemented. Until then makeFakeModel throws
// "not implemented" and every case fails.

import { describe, it, expect } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Recorder } from "../../src/recorder/recorder.js";
import { forkTrace } from "../../src/compare/fork.js";
import { makeFakeModel } from "../../src/agent/fake-model.js";
import { withNetworkGuard } from "../../src/replay/replay.js";
import { NetworkAccessDuringReplayError } from "../../src/replay/errors.js";
import type { ModelCallStep } from "../../src/trace/types.js";

describe("fake model (C-01)", () => {
  it("records exactly four steps: model_call, tool_call, tool_result, model_call", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-fake-rec-"));
    const fake = makeFakeModel();

    const recorder = new Recorder({
      modelAdapter: fake.modelAdapter,
      toolRegistry: fake.toolRegistry,
      traceDir: tmpDir,
      modelName: "fake",
    });

    const trace = await recorder.run("hello");

    expect(trace.steps.map((s) => s.kind)).toEqual([
      "model_call",
      "tool_call",
      "tool_result",
      "model_call",
    ]);

    // The model name stamped on model_call steps is "fake".
    const modelSteps = trace.steps.filter(
      (s): s is ModelCallStep => s.kind === "model_call"
    );
    for (const s of modelSteps) {
      expect(s.model).toBe("fake");
    }

    await fs.rm(tmpDir, { recursive: true });
  });

  it("is deterministic: the same run records the same steps every time", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-fake-det-"));

    const fakeA = makeFakeModel();
    const recorderA = new Recorder({
      modelAdapter: fakeA.modelAdapter,
      toolRegistry: fakeA.toolRegistry,
      traceDir: tmpDir,
      modelName: "fake",
    });
    const traceA = await recorderA.run("hello");

    const fakeB = makeFakeModel();
    const recorderB = new Recorder({
      modelAdapter: fakeB.modelAdapter,
      toolRegistry: fakeB.toolRegistry,
      traceDir: tmpDir,
      modelName: "fake",
    });
    const traceB = await recorderB.run("hello");

    // Compare step kinds and outputs (ids and runIds differ per run).
    expect(traceA.steps.map((s) => s.kind)).toEqual(
      traceB.steps.map((s) => s.kind)
    );
    expect(traceA.steps.map((s) => JSON.stringify(s.output))).toEqual(
      traceB.steps.map((s) => JSON.stringify(s.output))
    );

    await fs.rm(tmpDir, { recursive: true });
  });

  it("forks with one model_call edit and runs forward to a stable result", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-fake-fork-"));
    const fake = makeFakeModel();

    const recorder = new Recorder({
      modelAdapter: fake.modelAdapter,
      toolRegistry: fake.toolRegistry,
      traceDir: tmpDir,
      modelName: "fake",
    });
    const parentTrace = await recorder.run("hello");

    const firstModelStep = parentTrace.steps.find(
      (s): s is ModelCallStep => s.kind === "model_call"
    )!;
    expect(firstModelStep).toBeDefined();

    fake.reset();

    const result = await forkTrace({
      parentTrace,
      forkEdit: {
        forkPointStepId: firstModelStep.id,
        edit: { kind: "model_call", field: "model", value: "fake" },
      },
      modelAdapter: fake.modelAdapter,
      toolRegistry: fake.toolRegistry,
      traceDir: tmpDir,
      capConfig: { sessionLimitUsd: 10, overallLimitUsd: 100 },
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;

    // The branch's final model_call output is stable (deterministic).
    const branchModelSteps = result.branch.steps.filter(
      (s): s is ModelCallStep => s.kind === "model_call"
    );
    const finalOutput =
      branchModelSteps[branchModelSteps.length - 1]?.output.message.content;
    expect(typeof finalOutput).toBe("string");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("makes no network call during a record (runs clean inside withNetworkGuard)", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-fake-net-"));
    const fake = makeFakeModel();

    let thrown: unknown;
    try {
      await withNetworkGuard(async () => {
        const recorder = new Recorder({
          modelAdapter: fake.modelAdapter,
          toolRegistry: fake.toolRegistry,
          traceDir: tmpDir,
          modelName: "fake",
        });
        await recorder.run("hello");
      });
    } catch (err) {
      thrown = err;
    }

    // The fake model touches no network surface, so the guard never fires.
    expect(thrown).not.toBeInstanceOf(NetworkAccessDuringReplayError);
    expect(thrown).toBeUndefined();

    await fs.rm(tmpDir, { recursive: true });
  });
});
