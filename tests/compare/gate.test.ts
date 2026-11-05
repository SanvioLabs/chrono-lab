// tests/compare/gate.test.ts
// Gate check for spec 02: record a run, fork with one edit of each kind,
// and verify all invariants from Task 11.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Recorder } from "../../src/recorder/recorder.js";
import { forkTrace } from "../../src/compare/fork.js";
import { compareBranches } from "../../src/compare/compare.js";
import { loadTrace } from "../../src/trace/save.js";
import {
  makeStandInAdapters,
  makeStopOnlyAdapters,
} from "../fixtures/stand-in-agent.js";
import type { Trace, ModelCallStep, ToolResultStep } from "../../src/trace/types.js";

let tmpDir: string;
let parentTrace: Trace;
let parentTracePath: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-gate02-"));

  const adapters = makeStandInAdapters();
  const recorder = new Recorder({
    modelAdapter: adapters.modelAdapter,
    toolRegistry: adapters.toolRegistry,
    traceDir: tmpDir,
  });

  // Records exactly 4 steps: model_call, tool_call, tool_result, model_call.
  parentTrace = await recorder.run("hello");
  parentTracePath = path.join(tmpDir, `${parentTrace.runId}.json`);
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// Gate A: fork with a model_call edit (editing the `model` field)
// ---------------------------------------------------------------------------

describe("gate: model_call edit fork", () => {
  let branch: Trace;
  let firstModelStep: ModelCallStep;

  beforeAll(async () => {
    const adapters = makeStandInAdapters();

    firstModelStep = parentTrace.steps.find(
      (s): s is ModelCallStep => s.kind === "model_call"
    )!;
    expect(firstModelStep).toBeDefined();

    const result = await forkTrace({
      parentTrace,
      forkEdit: {
        forkPointStepId: firstModelStep.id,
        edit: { kind: "model_call", field: "model", value: "fork-model" },
      },
      modelAdapter: adapters.modelAdapter,
      toolRegistry: adapters.toolRegistry,
      traceDir: tmpDir,
      capConfig: { sessionLimitUsd: 10, overallLimitUsd: 100 },
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    branch = result.branch;
  });

  it("forkTrace returns status 'ok'", () => {
    expect(branch).toBeDefined();
  });

  it("branch has parentRunId set to parent runId", () => {
    expect(branch.parentRunId).toBe(parentTrace.runId);
  });

  it("branch has forkPointStepId set to the first model_call step id", () => {
    expect(branch.forkPointStepId).toBe(firstModelStep.id);
  });

  it("fork-point step in branch has live: true and edited: true", () => {
    const editedSteps = branch.steps.filter((s) => s.edited);
    expect(editedSteps).toHaveLength(1);
    const editedStep = editedSteps[0]!;
    expect(editedStep.live).toBe(true);
    expect(editedStep.edited).toBe(true);
  });

  it("branch has exactly one step where edited: true", () => {
    const editedSteps = branch.steps.filter((s) => s.edited);
    expect(editedSteps).toHaveLength(1);
  });

  it("all steps after the fork-point step have live: true and edited: false", () => {
    // The fork-point step is at index 0 (first model call); all steps after it
    // are live and not edited.
    const afterFork = branch.steps.slice(1);
    for (const step of afterFork) {
      expect(step.live).toBe(true);
      expect(step.edited).toBe(false);
    }
  });

  it("branch has the same step count as the parent (no extra placeholder step)", () => {
    expect(branch.steps).toHaveLength(parentTrace.steps.length);
  });

  it("branch has the same number of steps up to and including the fork point as the parent", () => {
    const parentForkIndex = parentTrace.steps.findIndex(
      (s) => s.id === firstModelStep.id
    );
    expect(branch.steps.slice(0, parentForkIndex + 1)).toHaveLength(
      parentTrace.steps.slice(0, parentForkIndex + 1).length
    );
  });

  it("compareBranches(parent, branch) finds a firstDiff at index 0", () => {
    const result = compareBranches(parentTrace, branch);
    expect(result.firstDiff).not.toBeNull();
    expect(result.firstDiff!.index).toBe(0);
    expect(result.firstDiff!.aStepId).toBe(firstModelStep.id);
    expect(result.firstDiff!.bStepId).toBe(branch.steps[0]!.id);
  });

  it("compareBranches(parent, branch): both sides have a finalOutput string", () => {
    const result = compareBranches(parentTrace, branch);
    expect(typeof result.a.finalOutput).toBe("string");
    expect(typeof result.b.finalOutput).toBe("string");
  });

  it("compareBranches(parent, branch): b stats are numbers", () => {
    const result = compareBranches(parentTrace, branch);
    expect(typeof result.b.totalTokens).toBe("number");
    expect(typeof result.b.totalCostUsd).toBe("number");
    expect(typeof result.b.totalDurationMs).toBe("number");
  });

  it("compareBranches(branch, parent) is the mirror of compareBranches(parent, branch)", () => {
    const ab = compareBranches(parentTrace, branch);
    const ba = compareBranches(branch, parentTrace);

    expect(ab.firstDiff).not.toBeNull();
    expect(ba.firstDiff).not.toBeNull();

    expect(ba.firstDiff!.index).toBe(ab.firstDiff!.index);

    expect(ba.firstDiff!.aStepId).toBe(ab.firstDiff!.bStepId);
    expect(ba.firstDiff!.bStepId).toBe(ab.firstDiff!.aStepId);

    expect(ba.a.totalTokens).toBe(ab.b.totalTokens);
    expect(ba.a.totalCostUsd).toBe(ab.b.totalCostUsd);
    expect(ba.a.totalDurationMs).toBe(ab.b.totalDurationMs);
    expect(ba.a.finalOutput).toBe(ab.b.finalOutput);

    expect(ba.b.totalTokens).toBe(ab.a.totalTokens);
    expect(ba.b.totalCostUsd).toBe(ab.a.totalCostUsd);
    expect(ba.b.totalDurationMs).toBe(ab.a.totalDurationMs);
    expect(ba.b.finalOutput).toBe(ab.a.finalOutput);
  });

  it("parent trace file on disk is unchanged after the model_call fork", async () => {
    const loaded = await loadTrace(parentTracePath);
    expect(JSON.stringify(loaded)).toBe(JSON.stringify(parentTrace));
  });

  it("branch trace file contains no API key pattern", async () => {
    const branchPath = path.join(tmpDir, `${branch.runId}.json`);
    const raw = await fs.readFile(branchPath, "utf-8");
    expect(raw).not.toMatch(/sk-[A-Za-z0-9_\-]{20,}/);
    expect(raw).not.toMatch(/AKIA[0-9A-Z]{16}/);
  });
});

// ---------------------------------------------------------------------------
// Gate B: fork with a tool_result edit
// Uses makeStopOnlyAdapters so the live phase after the edited tool result
// produces exactly one model_call (stop) step, keeping the branch at 4 steps.
// ---------------------------------------------------------------------------

describe("gate: tool_result edit fork", () => {
  let branch: Trace;
  let toolResultStep: ToolResultStep;

  beforeAll(async () => {
    // makeStopOnlyAdapters: model always returns stop immediately, so
    // continueFrom produces exactly one model_call step.
    const adapters = makeStopOnlyAdapters();

    toolResultStep = parentTrace.steps.find(
      (s): s is ToolResultStep => s.kind === "tool_result"
    )!;
    expect(toolResultStep).toBeDefined();

    const result = await forkTrace({
      parentTrace,
      forkEdit: {
        forkPointStepId: toolResultStep.id,
        edit: { kind: "tool_result", field: "result", value: "edited result" },
      },
      modelAdapter: adapters.modelAdapter,
      toolRegistry: adapters.toolRegistry,
      traceDir: tmpDir,
      capConfig: { sessionLimitUsd: 10, overallLimitUsd: 100 },
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    branch = result.branch;
  });

  it("forkTrace returns status 'ok' for a tool_result edit", () => {
    expect(branch).toBeDefined();
  });

  it("branch has parentRunId set to parent runId", () => {
    expect(branch.parentRunId).toBe(parentTrace.runId);
  });

  it("branch has forkPointStepId set to the tool_result step id", () => {
    expect(branch.forkPointStepId).toBe(toolResultStep.id);
  });

  it("fork-point step in branch has live: false and edited: true", () => {
    const editedSteps = branch.steps.filter((s) => s.edited);
    expect(editedSteps).toHaveLength(1);
    const editedStep = editedSteps[0]!;
    expect(editedStep.live).toBe(false);
    expect(editedStep.edited).toBe(true);
  });

  it("branch has exactly one step where edited: true", () => {
    expect(branch.steps.filter((s) => s.edited)).toHaveLength(1);
  });

  it("all steps after the fork-point step have live: true and edited: false", () => {
    const forkIndex = branch.steps.findIndex((s) => s.edited);
    const afterFork = branch.steps.slice(forkIndex + 1);
    for (const step of afterFork) {
      expect(step.live).toBe(true);
      expect(step.edited).toBe(false);
    }
  });

  it("the edited tool result carries the new value", () => {
    const editedStep = branch.steps.find(
      (s): s is ToolResultStep => s.edited && s.kind === "tool_result"
    );
    expect(editedStep).toBeDefined();
    expect(editedStep!.output.result).toBe("edited result");
  });

  it("compareBranches(parent, branch) finds a firstDiff at the fork point index", () => {
    const result = compareBranches(parentTrace, branch);
    expect(result.firstDiff).not.toBeNull();
    const forkIndex = parentTrace.steps.findIndex(
      (s) => s.id === toolResultStep.id
    );
    expect(result.firstDiff!.index).toBe(forkIndex);
    expect(result.firstDiff!.aStepId).toBe(toolResultStep.id);
    expect(result.firstDiff!.bStepId).toBe(
      branch.steps[forkIndex]!.id
    );
  });

  it("compareBranches(parent, branch): both sides have a finalOutput string", () => {
    const result = compareBranches(parentTrace, branch);
    expect(typeof result.a.finalOutput).toBe("string");
    expect(typeof result.b.finalOutput).toBe("string");
  });

  it("compareBranches(branch, parent) is the mirror", () => {
    const ab = compareBranches(parentTrace, branch);
    const ba = compareBranches(branch, parentTrace);

    expect(ab.firstDiff).not.toBeNull();
    expect(ba.firstDiff).not.toBeNull();

    expect(ba.firstDiff!.index).toBe(ab.firstDiff!.index);
    expect(ba.firstDiff!.aStepId).toBe(ab.firstDiff!.bStepId);
    expect(ba.firstDiff!.bStepId).toBe(ab.firstDiff!.aStepId);
  });

  it("parent trace file on disk is still unchanged after tool_result fork", async () => {
    const loaded = await loadTrace(parentTracePath);
    expect(JSON.stringify(loaded)).toBe(JSON.stringify(parentTrace));
  });

  it("branch trace file contains no API key pattern", async () => {
    const branchPath = path.join(tmpDir, `${branch.runId}.json`);
    const raw = await fs.readFile(branchPath, "utf-8");
    expect(raw).not.toMatch(/sk-[A-Za-z0-9_\-]{20,}/);
    expect(raw).not.toMatch(/AKIA[0-9A-Z]{16}/);
  });
});
