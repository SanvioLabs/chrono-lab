// src/ui/prefix.ts
// The replayed prefix for a fork: the steps shown above the live log on the
// running screen (R-15).
//
// The prefix is every step strictly before the fork point. The fork-point
// step itself is re-run live: src/compare/fork.ts replays up to and including
// the fork point, slices that step off the end of the prefix, and emits it as
// the first live step. So forking at step index i shows exactly the steps at
// indices 0..i-1 as the prefix, and forking at the first step shows an empty
// prefix.
//
// This is a pure function over a step list, kept out of main.ts so it can be
// unit-tested without the DOM or the app's boot side effects. main.ts reads
// the step list from the currently loaded trace and calls this.

import type { Step } from "../trace/types.js";

// The replayed prefix: the steps before the fork-point step, in order. Returns
// an empty list when the fork point is the first step or is not found.
export function replayedPrefix(steps: Step[], forkPointStepId: string): Step[] {
  const idx = steps.findIndex((s) => s.id === forkPointStepId);
  if (idx < 0) return [];
  return steps.slice(0, idx);
}
