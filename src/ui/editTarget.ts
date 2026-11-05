// src/ui/editTarget.ts
// Pure step resolution for the edit region (R-14) and the kept partial branch
// on the running region (R-18).
//
// Kept out of main.ts so it can be unit-tested without the DOM or the app's
// boot side effects. main.ts reads the loaded trace and the selected id and
// calls these; the edit region then renders whatever step they return, so
// selecting model call A and then model call B resolves to B.

import type { Trace, Step } from "../trace/types.js";

// The step whose editor the edit region should render: the step in the trace
// whose id matches the selection. Returns undefined when nothing is selected or
// the selected id is not in the trace, so the edit region shows its empty note.
// Pure over the trace and the selected id, so a test can assert that selecting
// A then B resolves to B without touching the DOM.
export function resolveEditStep(
  trace: Trace | undefined,
  selectedStepId: string | null
): Step | undefined {
  if (trace === undefined || selectedStepId === null) return undefined;
  return trace.steps.find((s) => s.id === selectedStepId);
}

// A saved branch split into the replayed prefix and the live steps, read from
// the branch itself. The running region's cap_reached state shows the partial
// branch exactly as it was saved (R-18): the prefix is every step before the
// first live/edited step, the live steps are the rest. forkTrace saves a branch
// as [...prefixSteps, ...liveSteps], marking only the live steps live (and the
// fork-point step edited), so the split is a single scan for the first such
// step.
export interface SplitBranch {
  prefix: Step[];
  live: Step[];
}

// Splits a saved branch trace into its replayed prefix and its live steps. The
// first step that is live or edited marks the fork point; everything from there
// on is live, everything before it is the replayed prefix. A trace with no live
// step (an unforked root run) is all prefix and no live steps.
export function splitBranch(trace: Trace): SplitBranch {
  const forkIndex = trace.steps.findIndex((s) => s.live || s.edited);
  if (forkIndex < 0) {
    return { prefix: [...trace.steps], live: [] };
  }
  return {
    prefix: trace.steps.slice(0, forkIndex),
    live: trace.steps.slice(forkIndex),
  };
}
