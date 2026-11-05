# Spec 02: Fork and Compare: Tasks

**Date:** 2026-11-04
**Gate:** change one step of a recorded run, get a second future, and see the
comparison.

Property-based tests come first for the three required properties. Write each
test before the code it exercises, confirm it fails, then make it pass.

---

## Task 1: Schema changes to `src/trace/types.ts`

- [x] Add `live: boolean` and `edited: boolean` to `BaseStep`. Every existing
      consumer must compile: add `live: false` and `edited: false` to the
      `ModelCallStep`, `ToolCallStep`, and `ToolResultStep` objects produced in
      `src/recorder/recorder.ts` and `src/replay/replay.ts`.
- [x] Add `parentRunId?: string` and `forkPointStepId?: string` to `Trace`.
      These fields must be omitted (not set to `undefined`) when absent, so
      that the in-memory trace and its round-tripped form remain strictly equal.
- [x] Update `TRACE_VERSION` to `"1.1.0"`.
- [x] Confirm `npm run typecheck` exits 0 after this task.

Verified: npx tsc --noEmit -> exit 0.

---

## Task 2: Version migration (`src/trace/version.ts`)

- [x] Add `"1.1.0"` to `KNOWN_VERSIONS`.
- [x] Add a `"1.0.0"` arm to `migrateTrace` that copies the trace and sets
      `live: false` and `edited: false` on every step. The arm must not write
      `parentRunId: undefined` or `forkPointStepId: undefined`; omit both keys
      entirely. The arm must not mutate the input.
- [x] Confirm the existing scrub and trace property tests still pass after this
      task (`npm test`). The trace property test arbitraries may need `live` and
      `edited` added to generated steps; update them as needed.

Verified: npx vitest --run -> scrub and trace property tests pass (part of the final 78 passed, 0 failed).

---

## Task 3: Recorder branch context and `continueFrom` (`src/recorder/recorder.ts`)

- [x] Add `branch?: string` and `forkPointId?: string` to `RecorderOptions`.
      Both default to their spec 01 values (`"main"` and `null`) when absent.
- [x] Stamp every step with the resolved `branch` and `forkPointId` values
      instead of the hardcoded literals.
- [x] Set `live: false` and `edited: false` on every step the recorder writes
      via `run`.
- [x] Add `continueFrom(messages: ModelCallInput["messages"], firstStepIndex: number): Promise<Trace>`.
      The method starts the agent loop with the supplied message list. The
      `stepIndex` counter starts at `firstStepIndex`. The loop body is identical
      to `run`. The method uses the same `runId`, `branch`, and `forkPointId`
      that were set on the `Recorder` instance. Steps written by `continueFrom`
      carry `live: true` and `edited: false`.
- [x] Confirm `npm run typecheck` exits 0 and all existing tests still pass.

Verified: npx tsc --noEmit -> exit 0; npx vitest --run -> all existing tests pass (part of the final 78 passed, 0 failed).

---

## Task 4: Property test: fork never mutates its parent

*Write this test before `forkTrace` exists. Confirm it fails to compile or
fails at runtime, then proceed to Task 7 to make it pass.*

File: `tests/compare/fork.property.test.ts`

- [x] Use `fast-check` to generate a `Trace` produced by `Recorder` with the
      stand-in adapters, deep-clone it before forking, call `forkTrace` with
      an edit on the first `model_call` step (edit the `model` field to a
      fixed string), then assert that the parent `Trace` object deep-equals
      the clone made before the fork.
- [x] Run with at least 100 examples.
- [x] The test must pass after Task 7 is complete.

Verified: npx vitest --run (against the not-implemented stub, before fork existed) -> failed with "Error: not implemented" (part of the 3 failed, 26 spec 01 tests passed); npx vitest --run (after Task 7) -> passes (part of the final 78 passed, 0 failed).

---

## Task 5: Property test: compare symmetry

*Write this test before `compareBranches` exists. Confirm it fails to compile
or fails at runtime, then proceed to Task 8 to make it pass.*

File: `tests/compare/compare.property.test.ts`

- [x] Property A (symmetry): for any two `Trace` objects, `compareBranches(a, b)`
      and `compareBranches(b, a)` satisfy:
      `firstDiff.index` is equal in both calls;
      `firstDiff.aStepId` in one call equals `firstDiff.bStepId` in the other;
      the `a` stats in one call equal the `b` stats in the other.
      When `firstDiff` is `null` in one call it is `null` in both.
- [x] Property B (identical branches): given one `Trace`,
      `compareBranches(t, t)` returns `firstDiff: null` and equal stats on
      both sides (all zeros, since the split window is empty).
- [x] Run each property with at least 100 examples.
- [x] The test must pass after Task 8 is complete.

Verified: npx vitest --run (against the not-implemented stub, before compare existed) -> failed with "Error: not implemented" (part of the 3 failed, 26 spec 01 tests passed); npx vitest --run (after Task 8) -> passes (part of the final 78 passed, 0 failed).

---

## Task 6: Spend cap module (`src/server/caps.ts`)

- [x] Implement `ModelPrice`, `MODEL_PRICES`, `estimateCallCostUsd`, `CapState`,
      `CapConfig`, `CapExceededError`, `checkCaps`, and `recordSpend` as
      specified in `design.md`.
- [x] `checkCaps` throws `CapExceededError` with `reason: "session"` if
      `sessionSpendUsd + estimatedCostUsd` would exceed `sessionLimitUsd`, and
      `reason: "overall"` if `overallSpendUsd + estimatedCostUsd` would exceed
      `overallLimitUsd` (session is checked first).
- [x] `CapExceededError` carries `reason`, `limitUsd`, and `currentUsd`.
- [x] `recordSpend` returns a new `CapState` with both totals incremented; it
      does not mutate its input.
- [x] Write a unit test confirming: (a) a call whose estimated cost would push
      spend past the session cap throws `CapExceededError` with
      `reason: "session"`; (b) spend never passes the cap because the check
      runs before the call.
- [x] Confirm `npm run typecheck` exits 0.

Verified: npx tsc --noEmit -> exit 0; npx vitest --run tests/server/caps.test.ts -> passes (part of the final 78 passed, 0 failed).

Note: the first build of the spend caps missed four gaps, found in review and
fixed with a test for each: caps reset per fork, spend charged the estimate,
a cap hit dropped completed steps, and no test covered a stale answer after an
edit. A mutation check confirmed each fix: forks not sharing a spend ledger
(2 failed), charging the estimate instead of actual cost (3 failed), dropping
completed live steps on a cap hit (3 failed), and keeping the old output after
a model call edit (1 failed).

---

## Task 7: Edit types and fork operation

Files: `src/compare/types.ts`, `src/compare/errors.ts`, `src/compare/fork.ts`

- [x] Write `StepEdit`, `ForkEdit`, `ForkResult`, `ForkSuccess`, `ForkCapHit`
      in `src/compare/types.ts` exactly as in `design.md`.
- [x] Write `ForkError` in `src/compare/errors.ts`.
- [x] Implement `forkTrace(options: ForkOptions): Promise<ForkResult>` in
      `src/compare/fork.ts` following the algorithm in `design.md`:
  - Validate fork-point step exists and edit is compatible; throw `ForkError`
    if not.
  - Call `replayTrace` with `stopAtStepId` to get the prefix (the stop step is
    included; strip it before continuing).
  - For a `tool_result` edit: produce the edited step (`live: false`,
    `edited: true`), build the message list, call `recorder.continueFrom`.
    Steps from `continueFrom` carry `live: true, edited: false`.
  - For a `model_call` edit: run the edited model call live immediately to
    obtain its real output. Produce a single step carrying the new input, the
    live output, `live: true`, and `edited: true`. There is no separate
    placeholder step. Build the message list, call `recorder.continueFrom`.
    Steps from `continueFrom` carry `live: true, edited: false`.
  - Wrap the `modelAdapter` to call `checkCaps` before each live call using
    `estimateCallCostUsd`; call `recordSpend` after each call; on
    `CapExceededError` save the partial branch and return `ForkCapHit`.
  - The prefix replay runs inside `withNetworkGuard`; the live phase runs
    outside it.
  - On success, assemble the full trace: prefix steps, edited step, and steps
    from `continueFrom`. Set `parentRunId` and `forkPointStepId` on the
    `Trace` (do not set them to `undefined` for root runs; omit the keys). Save
    and return `ForkSuccess`.
- [x] Write a test confirming that a cap hit saves the partial branch and that
      the accumulated spend never exceeds either cap.
- [x] Confirm the property test from Task 4 now passes.

Verified: npx vitest --run tests/compare/bug-fixes.test.ts -> passes; npx vitest --run tests/compare/fork.property.test.ts -> passes (both part of the final 78 passed, 0 failed).

---

## Task 8: Compare operation (`src/compare/compare.ts`)

- [x] Implement `compareBranches(a: Trace, b: Trace): CompareResult` following
      the positional-walk algorithm in `design.md`. The function aligns the two
      full step lists from index 0 and compares on `kind`, `input`, and
      `output` only (ignoring `id`, `branch`, `live`, `edited`, `durationMs`).
- [x] `firstDiff` is `{ index, aStepId, bStepId }` at the split point, or
      `null` when the lists agree entirely.
- [x] Stats windows are computed from the split point to the end of each trace's
      step list.
- [x] Export `BranchStats`, `FirstDiff`, and `CompareResult`.
- [x] Write a test confirming that `compareBranches(rootTrace, branchTrace)`
      finds the correct split point when comparing a root run against one of its
      branches (this is the main use case; the root run has all `forkPointId:
      null` steps).
- [x] Confirm the property tests from Task 5 now pass.

Verified: npx vitest --run tests/compare/compare.property.test.ts -> passes (part of the final 78 passed, 0 failed).

---

## Task 9: Network guard scope test

File: `tests/compare/network-guard.test.ts`

- [x] Write a test that runs the replay phase of a fork under `withNetworkGuard`
      and confirms no network access is blocked during replay.
- [x] Write a test that confirms the network guard is not active during the live
      phase: after `replayTrace` returns, a mock network call made directly
      (outside the guard) succeeds without throwing
      `NetworkAccessDuringReplayError`.
- [x] Confirm `npm test` passes.

Verified: npx vitest --run tests/compare/network-guard.test.ts -> passes (part of the final 78 passed, 0 failed).

---

## Task 10: Typecheck and lint pass

- [x] `npm run typecheck` exits 0 with no errors.
- [x] `npm run build` exits 0.
- [x] No `any` casts without a justifying comment.

Verified: npx tsc --noEmit -> exit 0; npm run build -> exit 0.

---

## Task 11: Gate check

File: `tests/compare/gate.test.ts`

- [x] Record a run with the stand-in adapters (produces 4 steps: model_call,
      tool_call, tool_result, model_call).
- [x] Fork at the first `model_call` step, editing `model` to `"fork-model"`.
- [x] Confirm `forkTrace` returns `status: "ok"`.
- [x] Confirm the branch trace has `parentRunId` set to the parent's `runId`
      and `forkPointStepId` set to the first model_call step's `id`.
- [x] Confirm all branch steps after the fork-point step have `live: true` and
      `edited: false`.
- [x] Confirm the fork-point step (the `model_call` edit) has `live: true` and
      `edited: true`. Confirm the branch has exactly one step where
      `edited: true`. Confirm the branch has the same number of steps up to and
      including the fork point as the parent (no extra placeholder step).
- [x] Call `compareBranches(parentTrace, branch)` and confirm:
  - `firstDiff` is non-null, with the correct `index` and both step ids.
  - `a` and `b` each have a `finalOutput` string.
  - `b.totalTokens`, `b.totalCostUsd`, and `b.totalDurationMs` are numbers
    (content depends on the stand-in adapter's recorded values).
- [x] Call `compareBranches(branch, parentTrace)` and confirm the result is the
      mirror: `firstDiff.index` is the same; `firstDiff.aStepId` and
      `firstDiff.bStepId` swap; `a` and `b` stats swap.
- [x] Confirm the parent trace file on disk is unchanged (load it and
      deep-equal it against the in-memory object recorded before forking).
- [x] Confirm the branch trace file contains no API key pattern.
- [x] Run `npm test`. All tests pass (including spec 01's 26 tests).
- [x] Update `docs/kiro-usage.md` with a dated entry for this spec.

Verified: npx vitest --run tests/compare/gate.test.ts -> passes (part of the final 78 passed, 0 failed, which includes spec 01's 26 tests).

---

## Out of scope for this spec

- The lab UI (spec 03)
- The full demo agent with fake tools (spec 04)
- Server HTTP endpoints and session management (spec 03 / server)
- Import of third-party trace formats (stretch)
