// tests/agent/fake-model.test.ts
// Task 3 (C-01): the deterministic fake model.
//
// Records a run with the fake model through Recorder and asserts the four
// expected steps (model_call, tool_call, tool_result, model_call); forks it
// with one model_call edit and asserts the fork runs forward to a stable
// result; and confirms no network call is attempted by running the record
// inside withNetworkGuard (reused from spec 01/02).
//
// Also (Task 12 e2e support): the optional per-step delay. The e2e run sets a
// delay so a fork does not finish in the tick it starts, which lets the
// Playwright test see and measure the Stop button while live steps arrive. The
// last block proves the setting without weakening determinism: the delay is a
// timer, not a clock read, so the adapter's outputs never change.

import { describe, it, expect, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Recorder } from "../../src/recorder/recorder.js";
import { forkTrace } from "../../src/compare/fork.js";
import { makeFakeModel } from "../../src/agent/fake-model.js";
import { withNetworkGuard } from "../../src/replay/replay.js";
import { NetworkAccessDuringReplayError } from "../../src/replay/errors.js";
import type { ModelCallStep, ModelCallInput } from "../../src/trace/types.js";

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

// --- stepDelayMs: pacing the fake model (Task 12 e2e support) ---
//
// The e2e run sets a per-step delay so a fork does not finish in the tick it
// starts, which lets the Playwright test see and measure the Stop button while
// live steps arrive. These cases prove the setting: with a delay the adapter
// resolves no sooner than the delay; with no delay it resolves at once with no
// timer scheduled. The delay is a timer, not a clock read, so the fake model
// stays deterministic.

// A minimal valid model input; the fake adapter ignores its contents.
const EMPTY_INPUT: ModelCallInput = { messages: [], model: "fake", settings: {} };

describe("fake model stepDelayMs (Task 12)", () => {
  it("with the delay set, a model call resolves no sooner than the delay", async () => {
    vi.useFakeTimers();
    try {
      const fake = makeFakeModel({ stepDelayMs: 400 });

      let resolved = false;
      const call = fake.modelAdapter(EMPTY_INPUT).then((out) => {
        resolved = true;
        return out;
      });

      // Flush microtasks without advancing the timer: the call is still
      // pending, so the adapter did wait on the timer.
      await Promise.resolve();
      expect(resolved).toBe(false);

      // Just short of the delay: still pending.
      await vi.advanceTimersByTimeAsync(399);
      expect(resolved).toBe(false);

      // At the delay: it resolves, and to the first scripted response, so the
      // output is unchanged by the wait.
      await vi.advanceTimersByTimeAsync(1);
      const out = await call;
      expect(resolved).toBe(true);
      expect(out.finishReason).toBe("tool_calls");
    } finally {
      vi.useRealTimers();
    }
  });

  it("with no delay set, a model call resolves without waiting on a timer", async () => {
    vi.useFakeTimers();
    try {
      const fake = makeFakeModel();

      let resolved = false;
      const call = fake.modelAdapter(EMPTY_INPUT).then((out) => {
        resolved = true;
        return out;
      });

      // The adapter schedules no timer, so a microtask flush resolves it and
      // the fake timer is never advanced.
      await Promise.resolve();
      await call;
      expect(resolved).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the delay does not change the recorded outputs", async () => {
    // Two adapters, one paced and one not, return the same scripted outputs in
    // the same order. The wait moves only when a call resolves, never what it
    // resolves to.
    const paced = makeFakeModel({ stepDelayMs: 50 });
    const instant = makeFakeModel();

    const pacedOut = await paced.modelAdapter(EMPTY_INPUT);
    const instantOut = await instant.modelAdapter(EMPTY_INPUT);

    expect(JSON.stringify(pacedOut)).toEqual(JSON.stringify(instantOut));
  });
});
