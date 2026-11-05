# Spec 02: Fork and Compare: Design

**Date:** 2026-11-04

---

## Overview

Four modules, one new module added:

```
src/trace/      extended: live flag, edited flag, parentRunId, forkPointStepId, version 1.1.0
src/recorder/   extended: branch and forkPointId context; continueFrom entry point
src/replay/     unchanged API; stopAtStepId already supports the prefix replay
src/compare/    new: ForkResult, compareBranches
```

The fork operation is a function, not a class. It composes `replayTrace` (for
the prefix), a user-supplied edit, and a `Recorder.continueFrom` call (for the
live future).

---

## Schema changes (C-01, C-02, C-03)

### Trace version 1.1.0

The version bumps because `live` and `edited` are required fields on every
step. A loader that does not know about them would silently ignore them, which
is fine for display but breaks the compare symmetry requirement. Bumping the
version forces old code to migrate rather than silently omit the fields.

New `TRACE_VERSION = "1.1.0"`. `KNOWN_VERSIONS` becomes `["1.0.0", "1.1.0"]`.

`migrateTrace` gains a `"1.0.0"` arm:

```typescript
case "1.0.0": {
  const migrated = raw as Trace_1_0_0;  // local type alias for the old shape
  return {
    ...migrated,
    version: "1.1.0",
    // parentRunId and forkPointStepId are absent on root runs; omit them
    // entirely so the in-memory and serialised forms stay consistent.
    steps: migrated.steps.map((s) => ({ ...s, live: false, edited: false })),
  };
}
```

Note: the migration arm must not write `parentRunId: undefined` or
`forkPointStepId: undefined`. JSON serialisation drops `undefined` values, so a
migrated trace compared with the same trace after a save-and-load cycle would
fail a deep-equality check if those keys are present as `undefined` in memory.
Omit both keys instead.

### Updated TypeScript types

```typescript
// src/trace/types.ts additions

interface BaseStep {
  // ... existing fields unchanged ...
  live: boolean;    // false for recorded/replayed steps; true for live fork steps
  edited: boolean;  // true for the step at the fork point (combined with live per case)
}

interface Trace {
  // ... existing fields unchanged ...
  parentRunId?: string;       // absent on root runs
  forkPointStepId?: string;   // absent on root runs
}
```

No other type changes. `ModelCallStep`, `ToolCallStep`, and `ToolResultStep`
inherit `live` and `edited` from `BaseStep` automatically.

---

## Edit types (`src/compare/types.ts`)

An edit describes the one change a user makes at the fork point.

```typescript
export type StepEdit =
  | { kind: "model_call"; field: "messages"; value: Message[] }
  | { kind: "model_call"; field: "model";    value: string }
  | { kind: "model_call"; field: "settings"; value: ModelSettings }
  | { kind: "tool_result"; field: "result";  value: unknown };
```

The edit type is narrow by design. Only the fields listed in R-01 are
representable. Attempting to build an edit for a `tool_call` step or a
structural field is a TypeScript compile error, not a runtime check.

---

## Spend caps (`src/server/caps.ts`, preview for spec 02)

Spec 02 introduces the cap check. The full server belongs to a later spec, but
the cap logic must exist here because R-05 requires it to run before every live
call.

```typescript
export interface ModelPrice {
  inputUsdPerToken: number;   // price per input token
  outputUsdPerToken: number;  // price per output token
}

// Price table keyed by model identifier. Values are intentionally conservative
// (rounded up to the nearest whole cent per million tokens).
export const MODEL_PRICES: Record<string, ModelPrice>;

// Returns an upper-bound cost estimate for a call given the model and maxTokens.
// Uses the model's output price for all maxTokens since that is the worst case.
export function estimateCallCostUsd(model: string, maxTokens: number): number;

export interface CapState {
  sessionSpendUsd: number;   // accumulated spend for this session so far
  overallSpendUsd: number;   // accumulated spend across all sessions
}

export interface CapConfig {
  sessionLimitUsd: number;
  overallLimitUsd: number;
}

// Thrown by checkCaps if either cap would be exceeded.
export class CapExceededError extends Error {
  readonly reason: "session" | "overall";
  readonly limitUsd: number;
  readonly currentUsd: number;
}

// Throws CapExceededError if sessionSpendUsd + estimatedCostUsd > sessionLimit,
// or if overallSpendUsd + estimatedCostUsd > overallLimit (session checked first).
// Returns void if the call may proceed.
export function checkCaps(
  config: CapConfig,
  state: CapState,
  estimatedCostUsd: number
): void;

// Adds actualCostUsd to both spend totals and returns the updated state.
export function recordSpend(state: CapState, actualCostUsd: number): CapState;
```

The fork operation holds a mutable `CapState` object. Before each live model
call it calls `estimateCallCostUsd` (using the model identifier and the
`maxTokens` setting from the call, or a conservative default when `maxTokens`
is absent), then calls `checkCaps`. After the call it calls `recordSpend` to
update the counters.

---

## Recorder changes (C-03)

### Branch context

Add optional constructor fields to `RecorderOptions`:

- `branch?: string` defaults to `"main"` when absent.
- `forkPointId?: string` defaults to `null` when absent.

Every step written by the recorder uses the resolved values instead of
hardcoded literals.

### `continueFrom` entry point

```typescript
continueFrom(
  messages: ModelCallInput["messages"],
  firstStepIndex: number
): Promise<Trace>
```

`continueFrom` starts the agent loop with the supplied message list. The
`stepIndex` counter starts at `firstStepIndex` so generated step ids are
`${runId}-${firstStepIndex}`, `${runId}-${firstStepIndex+1}`, and so on, with
no collision with ids already assigned to prefix steps.

The loop body is identical to `run`. The only differences are the starting
messages and the starting index. The method returns a `Trace` containing only
the steps the recorder itself produced (prefix and edited steps are assembled
by `forkTrace`).

The `runId` used inside `continueFrom` is the same `branchRunId` that was used
to construct the edited step in `forkTrace`, ensuring all new ids share the
same run prefix.

---

## Fork operation (`src/compare/fork.ts`)

### stopAtStepId behaviour in the replay phase

`replayTrace` with `stopAtStepId` stops after the step whose id matches
`stopAtStepId` is included in the output (confirmed from `src/replay/replay.ts`:
the loop checks `outputSteps.some(s => s.id === stopAtStepId)` after the step
is pushed, so the stop step is present in the returned trace). The prefix
therefore includes the fork-point step itself. `forkTrace` strips it before
constructing the edited replacement.

### Types

```typescript
export type ForkEdit = {
  forkPointStepId: string;
  edit: StepEdit;
};

export type ForkSuccess = {
  status: "ok";
  branch: Trace;
};

export type ForkCapHit = {
  status: "cap_hit";
  reason: "session" | "overall";
  limitUsd: number;
  partialBranch: Trace;
};

export type ForkResult = ForkSuccess | ForkCapHit;

export interface ForkOptions {
  parentTrace: Trace;
  forkEdit: ForkEdit;
  modelAdapter: ModelAdapter;
  toolRegistry: ToolRegistry;
  traceDir: string;
  capConfig: CapConfig;
  branchId?: string;   // defaults to a generated UUID
}

export async function forkTrace(options: ForkOptions): Promise<ForkResult>;
```

### Algorithm

1. Validate that the fork-point step exists in `parentTrace.steps` and that the
   edit is compatible with that step's `kind`. Throw `ForkError` if not.

2. Call `replayTrace(parentTrace, { stopAtStepId: forkEdit.forkPointStepId })`
   under `withNetworkGuard` to get the prefix. The returned steps include the
   fork-point step. Strip the fork-point step from the end; the prefix is now
   all steps before it. The live phase that follows runs outside
   `withNetworkGuard`.

3. Produce the edited step. Two paths diverge here based on edit kind:

   **`tool_result` edit:** Copy the fork-point step, apply the new result,
   assign `id: "${branchRunId}-0"`, set `branch` to `branchId`, set
   `forkPointId` to the original step's `id`, set `live: false`, set
   `edited: true`. No live call is made for this step. Build the message list
   for `continueFrom` from the messages up to and including the edited tool
   result. Call `recorder.continueFrom(messages, 1)` (index 1 since the edited
   step is index 0). All steps returned by `continueFrom` carry `live: true,
   edited: false`.

   **`model_call` edit:** Apply the new input fields to a copy of the
   fork-point step. Run this edited model call live immediately via the
   cap-aware `modelAdapter` wrapper (see step 5). Fill in the real output on
   the step. Assign `id: "${branchRunId}-0"`, set `branch` to `branchId`, set
   `forkPointId` to the original step's `id`, set `live: true`, set
   `edited: true`. This single step is both the record of the user's edit and
   the first live step of the future. Build the message list for `continueFrom`
   from the messages up to and including this live output. Call
   `recorder.continueFrom(messages, 1)`. All steps returned by `continueFrom`
   carry `live: true, edited: false`.

4. No separate placeholder step is produced for a `model_call` edit. The
   fork-point step in the branch has a real output and carries both flags set.
   The step count of the branch up to and including the fork point matches the
   step count of the parent up to and including the fork point.

5. Construct a cap-aware `ModelAdapter` wrapper: before forwarding each call to
   the real `modelAdapter`, call `estimateCallCostUsd` and `checkCaps`. On
   `CapExceededError`, throw a sentinel that `forkTrace` catches. After each
   call returns, call `recordSpend` with the step's `cost` field.

6. Instantiate `Recorder` with `branchRunId`, the cap-aware adapter, the real
   `toolRegistry`, `branch: branchId`, and `forkPointId: forkEdit.forkPointStepId`.

7. On success: prepend the replayed prefix steps and the edited step to the
   steps returned by `continueFrom`. Assemble the full branch `Trace` with
   `parentRunId: options.parentTrace.runId` and
   `forkPointStepId: forkEdit.forkPointStepId`. Save to disk. Return
   `ForkSuccess`.

8. On `CapExceededError` (caught from the sentinel): assemble the partial branch
   from the prefix, the edited step, and any live steps completed before the
   cap was hit. Save the partial branch. Return `ForkCapHit`.

### Step id scheme for branches

Prefix steps keep their original ids. The edited step gets
`"${branchRunId}-0"`. Steps from `continueFrom` get
`"${branchRunId}-1"`, `"${branchRunId}-2"`, etc. The `branchRunId` is a fresh
UUID, so no ids collide with parent steps.

### Immutability of the parent

The replayed prefix is produced by `replayTrace`, which copies steps with
spread (`{ ...recorded }`). The `parentTrace` object is never mutated. No
field on any parent step is written. The parent trace file is never touched.

---

## Compare operation (`src/compare/compare.ts`)

```typescript
export interface BranchStats {
  totalTokens: number;       // sum of input+output tokens across model_call steps in the stats window
  totalCostUsd: number;      // sum of cost across model_call steps in the stats window
  totalDurationMs: number;   // sum of durationMs across all steps in the stats window
  finalOutput: string | null; // content of the last model_call step's output.message, or null
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

export function compareBranches(a: Trace, b: Trace): CompareResult;
```

### Algorithm

Comparison aligns both full step lists from index 0, not just the futures. This
makes root-vs-branch comparison work: the root's steps before the fork point
and the branch's replayed prefix share the same `kind`, `input`, and `output`
values, so they agree on the compared fields and the walk naturally finds the
divergence.

1. Walk `a.steps` and `b.steps` in parallel by index. At each index compare the
   pair on `kind`, `input` (deep equality), and `output` (deep equality). The
   fields `id`, `branch`, `live`, `edited`, and `durationMs` are excluded from
   comparison. The first index where any compared field differs (or where one
   list is exhausted before the other) is the split point.

2. If a split point is found, `firstDiff` is
   `{ index: splitPoint, aStepId: a.steps[splitPoint].id, bStepId: b.steps[splitPoint].id }`.
   When one side has no step at `splitPoint` (the shorter list ended first),
   the missing id is the first extra step id from the longer list (with the
   shorter side represented by the step immediately past its end; the shorter
   side's id at that point does not exist, so use the special sentinel
   `"(none)"`). If no split point exists, `firstDiff` is `null`.

3. The stats window for each side is all steps from `splitPoint` to the end of
   that trace's step list. When `firstDiff` is `null`, both windows are empty
   and all stats are zero (the branches are identical).

4. Compute `BranchStats` for each side over its window.

5. Return `{ firstDiff, a: statsA, b: statsB }`.

### Why this replaces the `forkPointId`-based future

The previous design defined "future" as steps where `forkPointId` is non-null.
The root run's steps all have `forkPointId: null`, so comparing a root run
against a branch would yield an empty future for the root, giving wrong stats
and a wrong `firstDiff`. The positional walk fixes this without requiring any
change to the trace schema.

### Symmetry

When `a` and `b` swap:
- `splitPoint` is the same index (positional walk produces the same result).
- `firstDiff.aStepId` becomes what was `firstDiff.bStepId` and vice versa.
- Stats swap positions but are computed from the same inputs.

This is directly testable as a property (see tasks).

---

## Error types (`src/compare/errors.ts`)

```typescript
// Thrown when the fork-point step id is not found in the parent trace,
// or when the edit is incompatible with the step kind.
export class ForkError extends Error {
  readonly forkPointStepId: string;
}
```

---

## Files to create

```
src/compare/
  errors.ts      ForkError
  types.ts       StepEdit, ForkEdit, ForkResult, ForkSuccess, ForkCapHit
  fork.ts        forkTrace
  compare.ts     compareBranches, BranchStats, CompareResult, FirstDiff
src/server/
  caps.ts        CapConfig, CapExceededError, checkCaps, recordSpend,
                 estimateCallCostUsd, MODEL_PRICES, CapState
tests/compare/
  fork.property.test.ts    property tests: parent immutability, cap halt
  compare.property.test.ts property tests: symmetry, identical-branch result
  gate.test.ts             end-to-end gate check
```

## Files to modify

```
src/trace/types.ts      add live and edited to BaseStep; add parentRunId, forkPointStepId to Trace
src/trace/version.ts    add "1.1.0" to KNOWN_VERSIONS; add migration arm for "1.0.0"
src/recorder/recorder.ts  add branch and forkPointId to RecorderOptions; stamp on steps;
                          add continueFrom entry point
```

---

## Invariants carried forward from spec 01

- `replayTrace` calls `withNetworkGuard` internally. The prefix replay makes
  zero live calls. The live phase runs after `replayTrace` returns, outside the
  guard.
- `saveTrace` scrubs the trace before writing. The branch trace is scrubbed the
  same way.
- Step ids in `<runId>-<index>` format remain the scheme.
- `KNOWN_VERSIONS` is the single authority on what the loader accepts.
