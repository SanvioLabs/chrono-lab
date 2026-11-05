# Spec 01: Trace and Replay: Tasks

**Date:** 2026-11-03
**Gate:** a recorded run of the stand-in agent replays to the same final answer
with zero model calls, and all property-based tests pass.

Tasks are ordered so that each property test is written and seen failing before
the code that makes it pass. Complete them in order; the gate check is the last
task.

---

## Task 1: Scaffold the project

- [x] Initialise `package.json` with `type: "module"`, TypeScript strict mode,
      and the following dev dependencies (pinned to exact versions):
      `typescript`, `tsx`, `vitest`, `fast-check`, `@types/node`.
- [x] Add `tsconfig.json` targeting ES2022, `NodeNext` module resolution,
      `strict: true`, `noUncheckedIndexedAccess: true`.
- [x] Add `vitest.config.ts` with test pattern `tests/**/*.test.ts`, no watch
      by default.
- [x] Add npm scripts: `build`, `test` (single run), `typecheck`.
- [x] Create the empty source folders: `src/trace`, `src/recorder`, `src/replay`,
      `tests/trace`, `tests/replay`, `tests/fixtures`.

Verified 2026-11-04: `npm install` added 55 packages. `npx tsc --noEmit` exits 0.

---

## Task 2: Trace schema (`src/trace/types.ts`)

- [x] Write the TypeScript types exactly as specified in `design.md`:
      `Step`, `ModelCallStep`, `ToolCallStep`, `ToolResultStep`, `Trace`, and
      all supporting interfaces.
- [x] Export `TRACE_VERSION = "1.0.0"`.
- [x] Confirm `tsc --noEmit` passes with zero errors.

Verified 2026-11-04: `npx tsc --noEmit` exits 0 with no errors.

---

## Task 3: Version list and migration stubs (`src/trace/version.ts`)

- [x] Export `KNOWN_VERSIONS: readonly string[]` containing `"1.0.0"`.
- [x] Export `migrateTrace(raw: unknown, fromVersion: string): Trace` that
      returns the input unchanged for `"1.0.0"` (no migration needed) and
      throws `TraceVersionError` for any other version.
- [x] Export `TraceVersionError` (extends `Error`) with `version` on its
      prototype so callers can inspect it.

Verified 2026-11-04: `npx tsc --noEmit` exits 0. `tests/trace/scrub.test.ts`
(9 tests) passes.

---

## Task 4: Property test (write before save/load code): save/load round-trip

*Write this test before `saveTrace` and `loadTrace` exist. Confirm it fails to
compile or fails at runtime, then proceed to Task 5 to make it pass.*

**Note:** This test was written before `saveTrace` and `loadTrace` existed, but
the first build session could not run commands to observe it failing first. The
"write, see it fail, then make it pass" ordering was maintained in intent but
not verified by observation.

File: `tests/trace/trace.property.test.ts`

- [x] Use `fast-check` to generate arbitrary `Trace` values (arbitrary `runId`,
      `createdAt`, and between 0 and 20 steps with randomised field values).
      Ensure generated string values do not match any scrub pattern (see
      `design.md`) so that the round-trip property is not confused by
      intentional redaction.
- [x] Property: `saveTrace(t, path)` followed by `loadTrace(path)` produces an
      object that deep-equals `scrub(t)`. Scrubbing must be idempotent: applying
      it twice gives the same result as applying it once.
- [x] Run with at least 200 examples.
- [x] The test must pass with `vitest --run` after Task 5 is complete.

Verified 2026-11-04: `tests/trace/trace.property.test.ts` (2 tests) pass.
`npx vitest --run` 26/26 passed.

---

## Task 5: API key scrubbing and save/load (`src/trace/save.ts`)

- [x] Implement `scrubString(s: string): string` that replaces every match of
      the three key patterns listed in `design.md` with `"[REDACTED]"`. Do not
      include a generic hex pattern; see `design.md` for the justification.
- [x] Implement `scrubTrace(trace: Trace): Trace` that deep-clones the trace
      and applies `scrubString` to every string value in the tree.
- [x] Unit test (non-property): verify each pattern is caught, and that a
      string with no key pattern is returned unchanged. Include a test that a
      step `id` like `"a1b2c3d4-0"` is not redacted.
- [x] Implement `saveTrace(trace: Trace, filePath: string): Promise<void>`:
      scrub, JSON serialise with two-space indentation, atomic write (tmp file
      and rename).
- [x] Implement `loadTrace(filePath: string): Promise<Trace>`:
      read, parse, version check, migrate, return.
- [x] `loadTrace` must throw `TraceVersionError` when `version` is not in
      `KNOWN_VERSIONS`.
- [x] Confirm the property test from Task 4 now passes.

Verified 2026-11-04: `tests/trace/scrub.test.ts` (9 tests) and
`tests/trace/trace.property.test.ts` (2 tests) pass.

---

## Task 6: Recorder (`src/recorder/recorder.ts`)

- [x] Define interfaces `ModelAdapter` and `ToolRegistry` in
      `src/recorder/types.ts` (see `design.md`).
- [x] Implement `Recorder` class:
  - Constructor takes `{ modelAdapter, toolRegistry, traceDir }`.
  - `run(task: string): Promise<Trace>` drives the agent loop, writing steps
    as it goes, then saves the trace to `traceDir/<runId>.json`.
  - Generates a UUID `runId` at the start of each run.
  - Assigns sequential `id` values to steps (`<runId>-0`, `<runId>-1`, ...`).
  - Records `durationMs` with `performance.now()`.
  - Sets `branch: "main"` and `forkPointId: null` on every step.
  - Propagates any error thrown by `modelAdapter` or a tool without silently
    swallowing it.

Verified 2026-11-04: `npx tsc --noEmit` exits 0. `Recorder` used by replay
property tests.

---

## Task 7: Minimal stand-in agent fixture

File: `tests/fixtures/stand-in-agent.ts`

- [x] Implement a `makeStandInAdapters()` factory that returns:
  - `modelAdapter`: two recorded responses:
    1. A `ModelCallOutput` with `finishReason: "tool_calls"` and a single
       `ToolCallSpec` for `echo(text: "hello")`.
    2. A `ModelCallOutput` with `finishReason: "stop"` and `message.content`
       of `"Final answer: hello"`.
  - `toolRegistry`: `{ echo: async (args) => args.text }`.
- [x] The factory is stateful: each call to `modelAdapter` advances an
      internal cursor, so the second call returns the second response.
- [x] Expose a `reset()` method so tests can reuse the fixture without
      re-instantiating.
- [x] Ensure no string value in the fixture matches any scrub pattern.

Verified 2026-11-04: `npx tsc --noEmit` exits 0. Stand-in adapters used by
replay property tests.

---

## Task 8: Property test (write before replay code): replay equals recording

*Write this test before `replayTrace` exists. Confirm it fails to compile or
fails at runtime, then proceed to Task 9 to make it pass.*

**Note:** This test was written before `replayTrace` existed, but the first
build session could not run commands to observe it failing first. The "write,
see it fail, then make it pass" ordering was maintained in intent but not
verified by observation.

The first version of the zero-network test (Property 2) passed even with the
`fetch` guard removed, because it tested one shared execution path rather than
each patched surface independently. The test was rewritten so that each of the
six surfaces (`globalThis.fetch`, `http.request`, `https.request`,
`net.connect`, `tls.connect`, `dns.lookup`) has its own failing case. After
the rewrite, removing any single guard makes at least one test fail.

File: `tests/replay/replay.property.test.ts`

- [x] Property 1, step-for-step equality: for any `Trace` produced by
      `Recorder` using the stand-in adapters, `replayTrace(trace)` produces a
      `Trace` whose `steps` array deep-equals the original `steps` array
      (including the same `id`, `runId`, `kind`, `input`, `output`, `model`,
      `settings`, `tokens`, `cost`, and `durationMs` on every step).
- [x] Property 2, zero network calls: `replayTrace(trace)` never triggers any
      network access; if any attempt is made the test fails immediately with
      `NetworkAccessDuringReplayError` as the failure reason. The test must
      exercise all six patched surfaces: `http.request`, `https.request`,
      `globalThis.fetch`, `net.connect`, `tls.connect`, and `dns.lookup`. Use
      `fast-check` to vary the task string fed to the stand-in agent to confirm
      the property holds across inputs.
- [x] Run with at least 100 examples.
- [x] The test must pass with `vitest --run` after Task 9 is complete.

Verified 2026-11-04: `tests/replay/replay.property.test.ts` (10 tests) pass.
Mutation check confirmed: removing any single guard or `withNetworkGuard` call
makes at least one test fail.

---

## Task 9: Replay stubs and network patch (`src/replay/replay.ts`)

- [x] Export `ReplayError` and `NetworkAccessDuringReplayError` from
      `src/replay/errors.ts`.
- [x] Implement `replayTrace(trace: Trace, options?: ReplayOptions): Promise<Trace>`:
  - `ReplayOptions` has `{ strict?: boolean; stopAtStepId?: string | null }`.
    Both default to `true` and `null` respectively.
  - Builds a `StepIterator` over `trace.steps`.
  - Creates stub `modelAdapter` and `toolRegistry`:
    - In strict mode, the model stub deep-equals the live `input` against the
      recorded `model_call` step input, throwing `ReplayError` naming the first
      mismatching step id on any difference.
    - In strict mode, the tool stub deep-equals the live tool `name` and
      `arguments` against the recorded `tool_call` step, throwing `ReplayError`
      naming the first mismatching step id on any difference.
    - Both stubs return the recorded outputs directly and copy the recorded
      `durationMs` and `id` onto the produced step (no new timing or id
      generation).
  - When `stopAtStepId` is set, stops after producing the step with that id and
    returns a partial trace.
  - Patches `http.request`, `http.get`, `https.request`, `https.get`,
    `globalThis.fetch`, `net.connect`, `net.createConnection`, `tls.connect`,
    `dns.lookup`, and `dns.resolve` to throw `NetworkAccessDuringReplayError`
    before the agent loop starts.
  - Restores all originals in a `finally` block after the loop ends.
  - Returns the produced `Trace` with the original `runId` and step ids.
- [x] Confirm the property test from Task 8 now passes.

Verified 2026-11-04: `npx tsc --noEmit` exits 0. `npm run build` exits 0.
`tests/replay/replay.property.test.ts` (10 tests) pass.

---

## Task 10: Typecheck and lint pass

- [x] `npm run typecheck` exits 0 with no errors.
- [x] `npm run build` exits 0.
- [x] All files in `src/` have no `any` casts except where a comment
      justifies it (e.g., the generic tree-walker in `scrubTrace`).

Verified 2026-11-04: `npx tsc --noEmit` exits 0. `npm run build` exits 0.

---

## Task 11: Gate check

- [x] Run `npm test`. All tests pass.
- [x] Run the stand-in agent end-to-end: record a run, replay it, confirm the
      replayed final answer equals `"Final answer: hello"`.
- [x] Confirm the replayed trace has the same step ids and `durationMs` values
      as the recorded trace.
- [x] Confirm the recorded trace file contains no string matching
      `sk-[A-Za-z0-9_\-]{20,}` (even if the test model adapter never sends
      one; verify the scrub runs).
- [x] Confirm loading the trace file with a patched `version: "99.0.0"` throws
      `TraceVersionError` with a message naming `"99.0.0"`.
- [x] Update `docs/kiro-usage.md` with a dated entry for this spec.

Verified 2026-11-04: `npx vitest --run` 4 test files, 26 passed, 0 failed
(scrub 9, trace property 2, gate 5, replay property 10). Gate check passes.

---

## Out of scope for this spec

- Fork/branch logic (spec 02)
- The full demo agent (spec 04)
- The lab UI (spec 03)
- Spend caps and session management (spec 02 / server)
- Import from third-party trace formats (stretch)
