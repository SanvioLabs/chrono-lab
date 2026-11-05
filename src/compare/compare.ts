// src/compare/compare.ts
// Compare two branch traces by positional walk.

import type { Trace, ModelCallStep, Step } from "../trace/types.js";

export interface BranchStats {
  // Sum of input+output tokens across model_call steps in the stats window.
  totalTokens: number;
  // Sum of cost across model_call steps in the stats window.
  totalCostUsd: number;
  // Sum of durationMs across all steps in the stats window.
  totalDurationMs: number;
  // Content of the last model_call step's output.message, or null.
  finalOutput: string | null;
}

export interface FirstDiff {
  index: number;
  aStepId: string;
  bStepId: string;
}

export interface CompareResult {
  firstDiff: FirstDiff | null;
  a: BranchStats;
  b: BranchStats;
}

// Compare two traces by walking their step lists in parallel from index 0.
// Steps are compared on kind, input, and output only (not id, branch, live,
// edited, or durationMs). Stats are computed over the window from the split
// point to the end of each trace.
export function compareBranches(a: Trace, b: Trace): CompareResult {
  const aSteps = a.steps;
  const bSteps = b.steps;
  const len = Math.max(aSteps.length, bSteps.length);

  let splitPoint: number | null = null;

  for (let i = 0; i < len; i++) {
    const aStep = aSteps[i];
    const bStep = bSteps[i];

    // One side is exhausted: differ at this index.
    if (aStep === undefined || bStep === undefined) {
      splitPoint = i;
      break;
    }

    // Compare on kind, input, and output only.
    if (!stepsEqual(aStep, bStep)) {
      splitPoint = i;
      break;
    }
  }

  if (splitPoint === null) {
    // All steps agreed; stats windows are empty.
    const zeroStats: BranchStats = {
      totalTokens: 0,
      totalCostUsd: 0,
      totalDurationMs: 0,
      finalOutput: null,
    };
    return { firstDiff: null, a: zeroStats, b: zeroStats };
  }

  // Build firstDiff.
  const aStepAtSplit = aSteps[splitPoint];
  const bStepAtSplit = bSteps[splitPoint];
  const firstDiff: FirstDiff = {
    index: splitPoint,
    aStepId: aStepAtSplit?.id ?? "(none)",
    bStepId: bStepAtSplit?.id ?? "(none)",
  };

  // Stats windows run from splitPoint to the end of each trace.
  const aStats = computeStats(aSteps.slice(splitPoint));
  const bStats = computeStats(bSteps.slice(splitPoint));

  return { firstDiff, a: aStats, b: bStats };
}

// Compare two steps on kind, input, and output only.
function stepsEqual(a: Step, b: Step): boolean {
  if (a.kind !== b.kind) return false;
  return (
    JSON.stringify(a.input) === JSON.stringify(b.input) &&
    JSON.stringify(a.output) === JSON.stringify(b.output)
  );
}

// Compute BranchStats over a slice of steps.
function computeStats(steps: Step[]): BranchStats {
  let totalTokens = 0;
  let totalCostUsd = 0;
  let totalDurationMs = 0;
  let finalOutput: string | null = null;

  for (const step of steps) {
    totalDurationMs += step.durationMs;
    if (step.kind === "model_call") {
      const modelStep = step as ModelCallStep;
      totalTokens += modelStep.tokens.input + modelStep.tokens.output;
      totalCostUsd += modelStep.cost;
      finalOutput = modelStep.output.message.content;
    }
  }

  return { totalTokens, totalCostUsd, totalDurationMs, finalOutput };
}
