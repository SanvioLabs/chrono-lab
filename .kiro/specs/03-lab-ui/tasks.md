# Spec 03: The Lab UI: Tasks

**Date:** 2026-11-04
**Gate:** someone who has never seen Chrono-Lab completes a full rewind and
compare without help, and the Playwright end-to-end test passes against the
deterministic fake model with no network and no API key.

Tests come before the code they exercise where a test can be written first.
Write the test, confirm it fails, then make it pass. The Playwright browser
install is a one-time setup step done outside the build (see Task 12); no task
installs browsers.

Leave a `Verified:` line under each task with the command run and its result.

---

## Task 1: Dependencies and build config

- [ ] Add `vite` `5.4.21` (the latest 5.4 release) and `@playwright/test`
      `1.48.2` to `devDependencies` in `package.json` (exact versions, no
      range). Add scripts `dev`, `build:ui`, `serve`, and `test:e2e` as in
      `design.md`.
- [ ] Add `vite.config.ts` with UI root `src/ui` and build output `dist/ui`.
- [ ] Add one zero-cost `"fake"` entry to `MODEL_PRICES` in `src/server/caps.ts`
      (matching the existing `"stub"` and `"fork-model"` entries). No logic
      change to `caps.ts`.
- [ ] Confirm `npm run typecheck` exits 0 and the existing 78 tests still pass.

Verified:

---

## Task 2: `onStep`, `signal` and the step bound on the fork and record paths (C-03)

*Write the tests first.*

Files: `tests/compare/fork-onstep.test.ts`, `tests/compare/fork-stop.test.ts`,
`tests/recorder/max-steps.test.ts`

- [ ] `onStep` test: a fork run with an `onStep` callback calls it once per live
      step, in order, and the steps collected by `onStep` equal the live steps
      in the saved branch (same ids, so nothing already streamed is rewritten).
- [ ] `signal` test: aborting the `signal` after the first live step saves a
      partial branch holding the prefix plus exactly the steps completed before
      the abort, makes no further live call, and rewrites none of the steps
      already passed to `onStep`. The test is bounded: without the stop
      behaviour it fails on an assertion, not by exhausting memory.
- [ ] Step-bound test (`tests/recorder/max-steps.test.ts`): a model that never
      stops ends a record run at `maxSteps` with `endReason: "max_steps"`; the
      default bound (`DEFAULT_MAX_STEPS`) applies when none is given; a runaway
      fork live phase ends at the bound and returns a clean `ForkSuccess` whose
      branch records `endReason: "max_steps"`.
- [ ] Add `onStep?: (step: Step) => void` and `signal?: AbortSignal` to
      `ForkOptions` in `src/compare/fork.ts`. Forward each live step to
      `options.onStep` with its final branch id (including the immediate
      model-call edit step), so an id the server streams is never rewritten in
      the saved branch. On an aborted signal, stop after the current step and
      save the partial branch, the same path a cap hit uses. A stop returns a
      `ForkSuccess` whose branch is the shorter, saved branch.
- [ ] Add the step bound to library code (see
      `design-step-bound.md`): `RecorderOptions` gains `maxSteps?: number`
      (default `DEFAULT_MAX_STEPS` = 50); the recorder loop ends cleanly at the
      bound and marks `endReason: "max_steps"`. `Trace` gains an optional
      `endReason` field. `forkTrace` passes the bound through to the live phase
      (the edited step counts as the first live step, so the inner recorder gets
      `maxSteps - 1`).
- [ ] Give the record path (`src/recorder/recorder.ts` as driven by the server)
      the same `signal` handling so a record in flight stops and saves a partial
      run; the step bound also protects the record path directly.
- [ ] Confirm all three test files pass and `npm run typecheck` exits 0.

Verified:

---

## Task 3: Deterministic fake model (`src/agent/fake-model.ts`, C-01)

- [ ] Implement `makeFakeModel(): FakeModel` returning a deterministic
      `ModelAdapter` and a sandboxed `ToolRegistry` (an `echo` tool), reusing
      the response shapes from `tests/fixtures/stand-in-agent.ts` but importable
      from `src/`. The adapter makes no network call, reads no file, and reads
      no clock. The model name stamped on steps is `"fake"`.
- [ ] Write a unit test that records a run with the fake model through
      `Recorder` and asserts the four expected steps, and that forking it with
      one `model_call` edit runs forward to a stable result. Confirm no network
      call is attempted (reuse the network-guard approach from spec 01/02).
- [ ] Confirm `npm run typecheck` exits 0.

Verified:

---

## Task 4: Synthetic demo content (`demo/`, C-02)

- [ ] Produce `demo/root-run.json` by recording the fake model once and saving
      with `saveTrace`, or by writing a valid `1.1.0` trace by hand. Produce
      `demo/prerecorded-future.json` as one forked future of it, with
      `parentRunId` and `forkPointStepId` pointing at the root run.
- [ ] Confirm both files load with `loadTrace` without a version error and that
      neither contains a string any scrub pattern would match.
- [ ] Add `demo/README.md` stating both files are synthetic content we wrote.

Verified:

---

## Task 5: The two ledgers compose (`src/server/ledger.ts`, R-07)

*Write the test first.*

File: `tests/server/ledger.test.ts`

- [ ] Test: `composeLedger(session, global)` reports `sessionSpendUsd` from the
      session ledger and `overallSpendUsd` from the global ledger, and `add`
      charges both. Two separate session ledgers that share one global ledger,
      each under the session cap, together push the global total past the
      overall cap, so the second session's check against the overall cap fails.
- [ ] Implement `ledger.ts`: one global `SpendLedger` for the server and
      `composeLedger(session, global)` as in `design.md`. `caps.ts` is unchanged
      beyond the Task 1 `"fake"` entry.
- [ ] Confirm the test passes and `npm run typecheck` exits 0.

Verified:

---

## Task 6: Session store (`src/server/sessions.ts`, R-01, R-07a)

*Write the test first.*

File: `tests/server/sessions.test.ts`

- [ ] Test: `get` returns no session for a read-only / static call; `create`
      mints a session with its own `traceDir` and one session `SpendLedger`, and
      a second writing call with the same cookie returns the same session and
      ledger (so spend accumulates across forks).
- [ ] Test: `create` throws `SessionCapFull` when the live session count is at
      `config.maxLiveSessions`; after a session expires, `create` succeeds again.
- [ ] Test: `sweepExpired` deletes an expired session and removes its trace
      directory, and refuses to remove any path that resolves outside
      `config.traceRoot`.
- [ ] Implement `SessionStore` and `Session` per `design.md`: mint only on a
      writing call, cap the live count, per-session trace dir, TTL sweep that
      resolves the dir inside `traceRoot` before `fs.rm(dir, { recursive })`.
- [ ] Confirm the tests pass and `npm run typecheck` exits 0.

Verified:

---

## Task 7: Safe static files and rate limiter (`src/server/static.ts`, `rateLimit.ts`)

*Write both tests first.*

Files: `tests/server/static.test.ts`, (rate-limit unit test alongside `rateLimit.ts`)

- [ ] Static test: a request for a file inside `dist/ui` resolves and serves; a
      request with `..`, an absolute path, or any path that escapes `dist/ui` is
      rejected with a 404 without opening a file.
- [ ] Rate-limit test: a burst past the per-session record limit is rejected; a
      burst past the per-IP limit is rejected (even with no session cookie); a
      burst past the global limit is rejected; buckets refill over time.
- [ ] Implement `static.ts`: resolve inside `config.staticRoot` only, reject
      escapes with a 404. Implement `rateLimit.ts`: per-session record and fork
      buckets, a per-IP bucket, and one global bucket, from
      `ServerConfig.rateLimit`.
- [ ] Confirm the tests pass.

Verified:

---

## Task 8: Server routes and SSE stream (`src/server/routes.ts`, `server.ts`, `config.ts`)

*Write the route test first.*

File: `tests/server/routes.test.ts`

- [ ] Test (against the fake model, modelMode `"fake"`): `POST /api/record`
      returns a `runId` and the saved trace has the expected steps;
      `GET /api/traces` returns a summary for it; `GET /api/traces/:runId`
      returns the full trace and a 404 for an unknown id;
      `POST /api/fork` with one edit returns `status: "ok"` and a new `runId`;
      `POST /api/compare` returns a `CompareResult` with the first difference
      and both branches' costs.
- [ ] Test: a read-only `GET` and a static request mint no session; the first
      `POST /api/record` or `POST /api/fork` mints one; when the live session
      count is full, a new session request gets a 503 with a plain reason
      (R-07a).
- [ ] Test: two sessions, each under the session cap, together reach the overall
      cap; the second's fork returns `status: "cap_hit"` with
      `reason: "overall"` and the partial branch saved; neither ledger passes
      its cap (R-07).
- [ ] Test: the SSE stream delivers one `step` event per step in order, then a
      terminal `done` (or `cap`) event; a stream opened by one session returns
      404 to another session (R-10a); `POST /api/stop` aborts the running fork's
      signal and returns the partial branch `runId` with no streamed step
      rewritten (R-08).
- [ ] Test: rate-limited requests get a 429 with a plain reason (R-09); every
      response is free of any API key pattern; an HTML response carries the
      same-origin-only `Content-Security-Policy` (R-01a).
- [ ] Test: in modelMode `"demo"`, a fork for a step that has a prerecorded
      future returns that future (belonging to the chosen fork point) and flags
      demo mode; a fork for a step with no prerecorded future is refused with a
      plain message, never an unrelated future (R-14, R-17).
- [ ] Implement `config.ts`, `routes.ts`, and `server.ts`: safe static serving
      (Task 7) with the CSP header, the seven endpoints, session minting only on
      a writing call, the composed ledger passed into every `forkTrace`
      (Task 5), the per-`forkId` `AbortController` for stop, stream-to-session
      binding, the rate limiter (per-session, per-IP, global), and the demo-mode
      fork that returns the future for the chosen fork point. The live phase runs
      outside `withNetworkGuard`.
- [ ] Confirm the tests pass and `npm run typecheck` exits 0.

Verified:

---

## Task 9: App state (`src/ui/state.ts`, `components/states.ts`)

*Write the state test first.*

File: `tests/ui/state.test.ts`

- [ ] State test: `AppState` and the `Loadable<T>` union cover empty, loading,
      error, ready and cap_reached; `sessionId` starts null; the transitions
      (record -> loading -> ready; fork -> running -> ready/cap_reached;
      compare -> loading -> ready) produce the states `design.md` lists.
- [ ] Implement `state.ts` and `states.ts`: one state object,
      `stateBox(region, state, readyRenderer)` that fills the region's reserved
      height for every state, a skeleton loader the size of ready content, and
      the reserved (possibly empty) banner slot. `demoMode.forkableStepIds`
      drives which fork points the edit screen enables.
- [ ] Confirm the test passes.

(The no-reflow check (R-11) is not a Vitest test; it runs in the browser in
Task 12. Vitest has no layout engine, so it cannot measure element boxes.)

Verified:

---

## Task 10: The screens and components (`src/ui/screens/`, `components/`, `draw/`)

- [ ] `timeline.ts` (R-12): steps in order with kind, summary, tokens, time;
      selecting a step opens its full input and output, escaped. Keyboard
      listbox: up/down select, Enter open, Escape close (R-19).
- [ ] `branchTree.ts` + `draw/treeSvg.ts` (R-13): branches drawn as lines
      splitting at the fork point; replayed, live and fork-point steps drawn
      distinctly by shape and colour, with the role in each node's accessible
      name (R-20). Selecting a branch loads its timeline.
- [ ] `edit.ts` (R-14): only the fields spec 02 R-01 allows for the selected
      step's kind, one edit at a time; for the prompt, list the messages, let
      the user pick one (default: the last user message), edit that message's
      content with the others read-only, and send the whole new `input.messages`
      array; no control for `tool_call` or structural fields; in demo mode
      enable only fork points in `demoMode.forkableStepIds`, others disabled with
      a plain reason; one "Run forward from here" button labelled in words.
- [ ] `running.ts` (R-15): open the SSE stream, append each live step in order
      under the replayed prefix, announce each via a live region (R-20), one
      "Stop" button (R-08); terminal `done`/`cap`/`error` handling.
- [ ] `compare.ts` (R-16): two columns aligned at the fork point, the first
      difference highlighted on both sides and labelled in text, each column's
      final output, tokens, cost and duration; a plain "these branches do not
      differ" when `firstDiff` is null.
- [ ] `banner.ts` (R-17), `stepCard.ts`, `api.ts`, `a11y.ts`, `main.ts` wiring.
- [ ] Confirm `npm run typecheck` exits 0 and `npm run build:ui` exits 0.

Verified:

---

## Task 11: The visual system and the palette contrast test (`src/ui/theme/`, R-23)

*Write the contrast test first.*

File: `tests/ui/contrast.test.ts`

- [ ] Contrast test: parse the dark and light custom-property values from
      `tokens.css`, compute the WCAG ratio for every token the UI relies on
      (each token against `--bg` and `--surface`), and assert each text token's
      pairs are at least 4.5:1 and the `--line` and `--focus` pairs at least
      3:1. The measured figures match the palette table in `design.md`.
- [ ] `tokens.css`: the palette tokens for dark (default) and light, the type
      scale, and spacing, named by role (R-21). Use the corrected values:
      `--future` light `#9a5600`, `--line` dark `#636f9c` and light `#78849e`,
      so the contrast test passes.
- [ ] `theme.css`: apply tokens; the timeline spine and node shapes; the branch
      tree's crack-in-glass split; one fork-moment animation (branch draws on
      over ~450ms, a soft `--fork` flash) that honours `prefers-reduced-motion`.
      No other element moves (R-11). No sound.
- [ ] Confirm the contrast test passes and the theme never hides a control:
      every control keeps a plain text label; colour/glow/motion are decoration
      only (R-21).

Verified:

---

## Task 12: End-to-end browser test with the no-reflow check (`tests/e2e/`, R-22, R-11)

*One-time setup, outside the build:* run `npx playwright install` on the machine
before running this test. No task below installs browsers.

- [ ] Add `tests/e2e/playwright.config.ts` starting the server with modelMode
      `"fake"`, one browser project named but not downloaded by the config.
- [ ] Write `tests/e2e/lab.spec.ts` driving the full loop: record, rewind to a
      step, edit the one allowed field (for the prompt, assert the edit changes
      one chosen message's content, defaulting to the last user message, not the
      whole array), run forward (assert live steps arrive and the Stop control is
      present), compare (assert the first difference is highlighted and both
      costs show). Assert each screen reaches the right state
      (empty/loading/ready as applicable).
- [ ] No-reflow check (R-11): at each state change, and as live steps arrive, and
      on a cap-reached state, measure the bounding boxes of the banner slot, the
      Stop button and each state region before and after, and fail on any
      movement.
- [ ] Add the keyboard-only pass and the accessible-name/role assertions from
      Task 13.
- [ ] Confirm `npm run test:e2e` passes with the browser pre-installed, with no
      network call to a model and no API key set.

Verified:

---

## Task 13: Accessibility pass (`src/ui/a11y.ts` and across screens)

- [ ] Keyboard only (R-19): every control reachable and usable by keyboard in a
      logical order, a visible focus ring at all times, no pointer-only action.
- [ ] Screen reader (R-20): every control has a name that says what it does; the
      timeline and tree expose structure and selection (`role="tree"`,
      `treeitem`, listbox roles); replayed-vs-live and the first-difference
      location are conveyed in text, not colour or shape alone.
- [ ] Assertions for accessible names and roles plus one keyboard-only pass are
      in the e2e test (Task 12).

Verified:

---

## Task 14: Gate check

- [ ] Run the full loop in a browser as a first-time user would: open the app,
      record a run, rewind to a step, change one field, run forward, compare the
      futures. Confirm it can be completed without help and without reading the
      code: every label says what it does, every state is visible, nothing
      shifts on a state change.
- [ ] Confirm the demo-mode banner shows with its reason when a cap is hit and
      when the app starts with no model configured (modelMode `"demo"`), only the
      fork points with a prerecorded future are offered, and the returned future
      belongs to the chosen fork point (R-14, R-17); the banner is absent
      (reserved but empty) otherwise.
- [ ] Confirm `npm run typecheck`, `npm run build`, `npm run build:ui`,
      `npm test`, and `npm run test:e2e` all pass.
- [ ] Update `docs/kiro-usage.md` with a dated entry for this spec.

Verified:

---

## Out of scope for this spec

- The real demo agent and the full prerecorded-future library (spec 04).
- Recording agents that run real tools with real side effects.
- Accounts and long-term storage; sessions expire.
- Uploading a visitor's own traces to the public site.
- The stretch items in `product.md`.
