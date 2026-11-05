// tests/ui/state.test.ts
// Task 9: the app state and its transitions.
//
// AppState and the Loadable<T> union cover empty, loading, error, ready and
// cap_reached; sessionId starts null; the transitions design.md lists produce
// the right states: record -> loading -> ready; fork -> running -> ready or
// cap_reached; compare -> loading -> ready.
//
// Written before state.ts is implemented. Until then initialState and every
// transition throw "not implemented" and every case fails. These are pure
// functions over the state object, so no DOM is needed here; the no-reflow
// check lives in the e2e test (Task 12).

import { describe, it, expect } from "vitest";
import {
  initialState,
  toLoading,
  toReady,
  toError,
  toCapReached,
  appendRunningStep,
} from "../../src/ui/state.js";
import type { Loadable } from "../../src/ui/state.js";
import type { Step, Trace, ModelCallStep } from "../../src/trace/types.js";
import type { TraceSummary } from "../../src/server/routes.js";
import type { CompareResult } from "../../src/compare/compare.js";

// A minimal model_call step for the running transitions.
function liveModelStep(id: string): ModelCallStep {
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
    output: { message: { role: "assistant", content: "hi" }, finishReason: "stop" },
    live: true,
    edited: false,
  };
}

describe("app state: the starting state", () => {
  it("sessionId starts null and every region is empty; the screen is timeline", () => {
    const s = initialState();
    expect(s.sessionId).toBeNull();
    expect(s.screen).toBe("timeline");
    expect(s.traces.status).toBe("empty");
    expect(s.current.status).toBe("empty");
    expect(s.running.status).toBe("empty");
    expect(s.compare.status).toBe("empty");
    expect(s.selectedStepId).toBeNull();
    expect(s.edit).toBeNull();
    expect(s.demoMode.active).toBe(false);
    expect(s.demoMode.forkableStepIds).toEqual([]);
  });
});

describe("app state: the Loadable union covers every state", () => {
  it("empty, loading, error, ready and cap_reached are all representable", () => {
    const empty: Loadable<number> = { status: "empty" };
    const loading = toLoading<number>(empty);
    const ready = toReady<number>(7);
    const error = toError<number>("boom");
    const cap = toCapReached<number>(3, "session", 10);

    expect(empty.status).toBe("empty");
    expect(loading.status).toBe("loading");

    expect(ready.status).toBe("ready");
    if (ready.status === "ready") expect(ready.value).toBe(7);

    expect(error.status).toBe("error");
    if (error.status === "error") expect(error.message).toBe("boom");

    expect(cap.status).toBe("cap_reached");
    if (cap.status === "cap_reached") {
      expect(cap.reason).toBe("session");
      expect(cap.limitUsd).toBe(10);
      expect(cap.value).toBe(3);
    }
  });
});

describe("app state: record -> loading -> ready", () => {
  it("a record moves the current region to loading then to ready with the trace", () => {
    const start: Loadable<Trace> = { status: "empty" };
    const loading = toLoading(start);
    expect(loading.status).toBe("loading");

    const trace = {
      version: "1.1.0",
      runId: "run-1",
      createdAt: "2026-11-04T00:00:00.000Z",
      steps: [],
    } as Trace;
    const ready = toReady<Trace>(trace);
    expect(ready.status).toBe("ready");
    if (ready.status === "ready") expect(ready.value.runId).toBe("run-1");
  });

  it("the traces list follows the same path", () => {
    const loading = toLoading<TraceSummary[]>({ status: "empty" });
    expect(loading.status).toBe("loading");
    const ready = toReady<TraceSummary[]>([]);
    expect(ready.status).toBe("ready");
  });
});

describe("app state: fork -> running -> ready or cap_reached", () => {
  it("a fork starts the running region at loading, then appends each live step in order", () => {
    const loading = toLoading<Step[]>({ status: "empty" });
    expect(loading.status).toBe("loading");

    const one = appendRunningStep(loading, liveModelStep("b-0"));
    expect(one.status).toBe("ready");
    if (one.status === "ready") expect(one.value.map((s) => s.id)).toEqual(["b-0"]);

    const two = appendRunningStep(one, liveModelStep("b-1"));
    expect(two.status).toBe("ready");
    if (two.status === "ready") {
      // Steps accumulate in arrival order, nothing rewritten.
      expect(two.value.map((s) => s.id)).toEqual(["b-0", "b-1"]);
    }
  });

  it("a fork that hits a cap moves the running region to cap_reached, carrying the partial steps", () => {
    const partial = [liveModelStep("b-0")];
    const cap = toCapReached<Step[]>(partial, "overall", 100);
    expect(cap.status).toBe("cap_reached");
    if (cap.status === "cap_reached") {
      expect(cap.reason).toBe("overall");
      expect(cap.limitUsd).toBe(100);
      expect(cap.value.map((s) => s.id)).toEqual(["b-0"]);
    }
  });
});

describe("app state: compare -> loading -> ready", () => {
  it("a compare moves the compare region to loading then to ready with the result", () => {
    const loading = toLoading<CompareResult>({ status: "empty" });
    expect(loading.status).toBe("loading");

    const result: CompareResult = {
      firstDiff: null,
      a: { totalTokens: 0, totalCostUsd: 0, totalDurationMs: 0, finalOutput: null },
      b: { totalTokens: 0, totalCostUsd: 0, totalDurationMs: 0, finalOutput: null },
    };
    const ready = toReady<CompareResult>(result);
    expect(ready.status).toBe("ready");
    if (ready.status === "ready") expect(ready.value.firstDiff).toBeNull();
  });
});
