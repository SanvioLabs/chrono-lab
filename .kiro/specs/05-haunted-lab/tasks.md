# Spec 05: The Haunted Lab: Tasks

**Date:** 2026-11-07
**Gate:** someone who has never seen Chrono-Lab looks at a screenshot of the
compare view and can say which future is the new one and where it split, without
reading a label (requirements R-18). At least four of five adults answer both
questions correctly. Every existing unit and end-to-end test still passes.

Tests come first, as in the earlier specs. Write the test, run it, see it fail
for the right reason, then write the code that makes it pass. A test that has
never failed has not been shown to test anything.

Leave a `Verified:` line under each task with the command run and its result.
Nothing here is ticked until that line is filled. When code under this spec's
area changes, this file changes in the same commit. Keep commits small, each with
a message saying what changed and why.

Do not touch `src/agent/`, `demo/` or any spec 04 file. They belong to another
teammate.

Writing rules for every file in this spec: no em dashes, the words from
`product.md` (run, step, timeline, branch, fork point, future, replay), plain
and short. No film, show, character or device names from
`safety-and-trademarks.md`, in code comments too. Task 3h tests this against the
steering file itself, so the names are never copied into the repo.

---

## Task 1: Baseline before any costume code

- [ ] Run `npm run typecheck`, `npm test` and `npm run test:e2e`. All must pass
      before this spec starts. If any fails, stop and report it; it is not part
      of this spec.
- [ ] Run `npm run build:ui`. Record in the Verified line: the size of every file
      in `dist/ui` and the total gzipped size (for example with `gzip -c` on each
      file). This is the baseline the 60 KB budget is measured against. Also
      record the list of `devDependencies` and confirm there is no `dependencies`
      key in `package.json`.
- [ ] Confirm `tests/e2e/lab.spec.ts`, `cap.spec.ts` and `demo.spec.ts` are the
      versions that pass, by noting the commit hash. These three files are not
      edited by this spec (R-17).

Verified:

---

## Task 2: Delete the dead timeline spine

Decision (owner, 2026-11-07): delete it under this spec, as its own task at the
start of the build, in its own commit. Not under spec 03. This commit contains
nothing else.

- [ ] Search `src/` and `tests/` for `drawTimelineSpine`, `timeline-spine` and
      `timelineSvg`. At the time of writing the only hits are the definition in
      `src/ui/draw/timelineSvg.ts` and the `.timeline-spine` rules in
      `src/ui/theme/theme.css`, with no caller and no test. If a caller or a test
      turns up, stop and report it.
- [ ] Delete `drawTimelineSpine` and everything only it uses: its constants and
      helpers, the whole file `src/ui/draw/timelineSvg.ts` if nothing else is
      left in it, and the "timeline spine (decoration)" rules in `theme.css`.
      Delete any import of them.
- [ ] Run the search again: no hits in `src/` or `tests/`.
- [ ] Leave spec 03's files alone. They describe the spine as built and stay as a
      record. The commit message says this removes dead code left by spec 03, and
      why.
- [ ] `npm run typecheck`, `npm test`, `npm run build:ui` and `npm run test:e2e`
      pass. Record the gzipped total against the Task 1 baseline.

Verified:

---

## Task 3: Write the tests first (all red)

Each test below must fail now, for a reason the Verified line states (a missing
file, a missing token, a missing attribute), not because of a typo in the test.
The exceptions are the guard tests (3f budget, 3f writing, 3h banned names). They
guard what is already true and must pass at baseline. If one fails at baseline,
report what it found to the owner and do not fix it silently.

### 3a: Extend the contrast test (R-08)

File: `tests/ui/contrast.test.ts` (extend, do not weaken)

- [ ] Add the four new measured tokens to the list of tokens that must exist in
      both themes: `--past-wash`, `--future-wash`, `--fork-wash`, `--diff-wash`.
- [ ] Add a `PAIRS` list of `{ fg, bg, threshold, dark, light }` for the 25 pairs
      in the "Contrast pairs, measured 2026-11-07" table in `design.md`: 12 text
      pairs at 4.5 and 13 graphic pairs at 3. Fill each `dark` and `light` figure
      from that table. Do not leave any `null`.
- [ ] One test per pair per theme asserts the computed ratio is at or above its
      threshold, with the pair named in the failure message.
- [ ] One test per pair per theme asserts the computed ratio, rounded half up to
      two decimals, equals the figure from the table.
- [ ] Existing expectations for spec 03's tokens are unchanged.
- [ ] Both new kinds of test fail now because the four wash tokens do not exist
      in `tokens.css`. State that in the Verified line.

### 3b: Lint the costume CSS (R-01, R-08, R-10, R-13, R-16)

File: `tests/ui/costume-css.test.ts`

Reads `src/ui/theme/costume.css`, `theme.css` and `tokens.css` as text.

- [ ] Every top-level rule selector in `costume.css` (outside `@keyframes`) starts
      with `[data-costume="on"]`, and the rules are inside
      `@media (forced-colors: none)`.
- [ ] The last block in `costume.css` is the `prefers-reduced-motion: reduce`
      block with `animation: none !important` and `transition: none !important`
      on `[data-costume="on"] *`, `*::before` and `*::after`.
- [ ] No `animation`, `transition` or `@keyframes` remains in `theme.css`.
- [ ] No `url(`, `@import`, `@font-face` or `data:` in `costume.css` or
      `tokens.css`.
- [ ] No `color:` declaration in `costume.css` or `theme.css` uses a decoration
      token (`--edge`, `--haze-cold`, `--haze-warm`, `--moon`, `--fork-glow`,
      `--future-glow`).
- [ ] Every decoration token that appears in a `background*` declaration has an
      alpha of at most 0.15 in both theme blocks. `--moon` in the light block is
      the one named exception.
- [ ] `tokens.css` has no `}` inside either theme block's body, including in
      comments, so the contrast parser keeps working.

### 3c: Motifs and the crack (R-04, R-12, R-13)

Files: `tests/ui/motifs.test.ts`, `tests/ui/crack.test.ts`

- [ ] For each of `clock`, `gear`, `hourglass`, `bolt`: the root descriptor has
      `aria-hidden: "true"`, `focusable: "false"` and `data-decor`; it contains no
      `title` or `text` element; it is deterministic (two calls are deeply equal).
- [ ] The four motifs serialise to under 3 KB in total.
- [ ] `wideCrackPoints(width, height, segments, seed)`: with `fast-check`, for any
      `width > 0`, `height > 0`, `segments` from 2 to 12 and any seed string, the
      first point is `(0, height / 2)`, the last is `(width, height / 2)`, every y
      is within `[0, height]`, x never decreases, and there are `segments + 1`
      points.
- [ ] Same inputs give the same points. Two chosen different seeds give different
      points.
- [ ] `crackPoints` in `treeSvg.ts` keeps passing `tests/ui/treeSvg.test.ts`.

### 3d: Freshness (R-07)

File: `tests/ui/fresh.test.ts`

- [ ] First `mark(["a","b"])` returns both. A second `mark(["a","b","c"])` returns
      only `c`. A repeat `mark(["a","b","c"])` returns an empty set.
- [ ] After `reset()`, the same ids are fresh again.
- [ ] Property: for any list of ids marked in any number of calls, the union of
      the returned sets equals the set of distinct ids, and no id is returned
      twice.

### 3e: Sound (R-11)

File: `tests/ui/sound.test.ts`, with a fake context that counts what is created
and started.

- [ ] Creating the sound creates no context. `state()` is `"off"`.
- [ ] `playForkMoment()` while off creates and starts nothing.
- [ ] `toggle()` creates exactly one context and `state()` becomes `"on"`. A second
      `toggle()` makes it `"off"` and suspends; a third turns it on without a
      second context.
- [ ] While on, `playForkMoment()` starts at most four sources, the scheduled
      length is at most 500 ms, and no gain value passed is above 0.2.
- [ ] If the context factory returns `null` or throws, `toggle()` returns
      `"unavailable"`, `playForkMoment()` does nothing and nothing throws.

### 3f: Budget and writing (R-13, R-15)

Files: `tests/ui/budget.test.ts`, `tests/ui/writing.test.ts`

- [ ] `budget.test.ts` runs a Vite build into a temporary directory, with a
      60 second timeout, then asserts: the gzipped total of every file is under
      60 000 bytes; no `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg` or `.ico`
      file under `dist`, `src/ui` or `docs` is over 102 400 bytes; `package.json`
      has no `dependencies` key with entries, and its `devDependencies` names equal
      the set recorded in Task 1. This test passes at baseline and guards every
      later task.
- [ ] `writing.test.ts` fails if the em dash character (written as `\u2014` in the
      test, so the test file has none) appears in any file under `src/ui`,
      `.kiro/specs/05-haunted-lab`, `docs/assets.md` or `kiro-prompts/05-haunted-lab.md`.
      Existing em dashes found outside this spec's files are reported to the
      owner, not silently fixed.

### 3g: End-to-end costume checks (R-01, R-06, R-09, R-10, R-11, R-12, R-14, R-16)

File: `tests/e2e/costume.spec.ts`, run against the full-loop server like
`lab.spec.ts`. Find everything by role and accessible name, not by class, except
where a test needs `data-role`, `data-branch`, `data-decor` or
`data-fork-moment`, which the design defines.

- [ ] **Plain view.** Open `/?costume=off`. Run the full loop (record, pick the
      tool result step, edit, run forward, compare). Assert these accessible
      names are present: "Record run", "Run forward from here", "Stop", "Compare
      with parent". Assert `[data-decor]` elements are not displayed and there is
      no sound button.
- [ ] **Plain words.** In the costumed view, assert the same four names plus
      "Edit the prompt", "Edit the model" and "Edit the settings" on a model call,
      and the text "first difference", "fork point", "branch A (parent)" and
      "branch B (new future)" in compare. This list is the plain words contract
      (R-02).
- [ ] **Decoration hidden.** Every `[data-decor]` element is `aria-hidden="true"`
      or has an `aria-hidden="true"` ancestor, and is not focusable.
- [ ] **Reduced motion.** Run the fork twice. With `reducedMotion: "no-preference"`:
      at least one sample in the `start` beat has `document.getAnimations().length
      > 0`. With `reducedMotion: "reduce"`: every sample, every 50 ms from the click
      until the fork is done, has length 0; `data-fork-moment` was seen set; the
      crack polyline's `stroke-dashoffset` is 0; the fork point entry's computed
      background equals the `--fork-wash` value; a live entry's computed
      background equals the `--future-wash` value.
- [ ] **Only new steps animate.** With motion on, after the third live step
      arrives, the first two live entries have no `data-fresh` attribute and no
      running animation.
- [ ] **No reflow through the fork moment.** In page code, sample with
      `requestAnimationFrame` through both beats (from the click until 1 s after
      the fork is done). Record the box of the banner slot, each region host, the
      control row and the Stop button on every frame. Assert every frame equals
      the first. Run with motion on and with reduced motion.
- [ ] **Both themes.** Run the full loop with `colorScheme: "dark"` and again with
      `"light"`. Both pass.
- [ ] **No policy violations.** Add an init script that listens for
      `securitypolicyviolation` and fail on any during the loop, in both themes.
- [ ] **Compare tells the story.** After a fork, open compare. Assert: the rows of
      branch A all have `data-role="replayed"`; branch B has `data-role="fork
      point"` on one row and `"live"` on the rows after it; the crack decoration
      exists in both columns and its top edge is at the same y (within 1 px); the
      first difference row has the 2 px outline and the `--diff-wash` background on
      both sides, and its "first difference" text is still present.
- [ ] **Sound is off.** The sound button has text "Sound: off". After a full loop
      with it untouched, a stub of `AudioContext` installed by an init script has
      been constructed zero times. After turning it on and running forward, it was
      constructed once and at least one source was started. Turning it off again
      shows "Sound: off".
- [ ] **Existing checks.** `lab.spec.ts`, `cap.spec.ts` and `demo.spec.ts` are not
      edited and still pass at the end of every later task.

### 3h: Banned names scan (R-15)

File: `tests/repo/banned-names.test.ts`. The design's "The banned names scan"
section says how it works. The test holds no banned name, and nothing else in the
repo gets a copy of the list.

- [ ] At test time, read `.kiro/steering/safety-and-trademarks.md`. Find the line
      "Never use, name, quote or imitate" and read the bullet list under it, up to
      the first blank line.
- [ ] Parse terms: each quoted phrase is a term; the rest of each bullet is split
      on commas; drop a leading "or " and "the "; drop parenthetical text; skip an
      item that starts with "any ".
- [ ] Fail if the line is not found or fewer than 10 terms are parsed.
- [ ] Scan every text file under `src/`, `docs/` and `kiro-prompts/`, plus
      `README.md`, for each term, in the contents and in the file path. Whole
      words. A one-word term matches case-sensitively; a longer term matches
      without regard to case. Skip `.kiro/steering/`, `node_modules/`, `dist/` and
      binary files.
- [ ] A failure message names the file, the line and the term.
- [ ] Positive control: take the first parsed term, build a string around it, and
      prove the scanner flags it and passes a clean string. No name is written in
      the test file to do this.
- [ ] Run it at baseline. It guards what should already be true. If it finds
      something, report the file and line to the owner and do not fix it silently.

Verified:

---

## Task 4: Tokens and measured contrast (R-08, R-14)

The figures are already measured (2026-11-07) and are in `design.md` and in the
`PAIRS` list from Task 3a. This task makes the tokens match them.

- [ ] Add the four wash tokens, the decoration tokens, the timing tokens and the
      two type tokens to `src/ui/theme/tokens.css`, in the dark block and in the
      light media block, using the values in `design.md` exactly. Keep the file
      parseable by the contrast test (no `}` inside a block, 6-digit hex for
      measured tokens).
- [ ] Run `npm test -- tests/ui/contrast.test.ts`. Every pair clears its threshold
      and every computed ratio equals its figure to two decimals. Do not change
      any spec 03 token.
- [ ] If a figure does not match, a token value is wrong. Fix the token, not the
      figure. Change a figure only if the owner agrees to measure again, and then
      update `design.md` and the `PAIRS` list in the same commit.
- [ ] The light `--past-wash` must not go darker than `#f5f9ff`. `--past` on
      `--past-wash` in the light theme is the tightest pair at 4.62 against a
      minimum of 4.5, and it is the first to fail if the wash moves darker.
- [ ] Confirm `tests/ui/contrast.test.ts` is fully green and spec 03's figures are
      unchanged.

Verified:

---

## Task 5: The switch and the stylesheet skeleton (R-01, R-10, R-16)

- [ ] Add `data-costume="on"` to `<html>` in `src/ui/index.html`.
- [ ] Create `src/ui/costume.ts` with `initCostume()`: sets `data-costume="off"`
      when the URL has `?costume=off`. Call it first in `src/ui/main.ts`, before
      `buildShell()`.
- [ ] Create `src/ui/theme/costume.css`, imported in `main.ts` after `theme.css`.
      Start it with the page backdrop, the glass edge on region hosts and the
      closing reduced-motion block. Everything inside `@media (forced-colors:
      none)` and behind `[data-costume="on"]`.
- [ ] Move the `fork-draw` keyframes and its use out of `theme.css` and into
      `costume.css`, keyed on `[data-fresh="true"]`. Remove the old narrow
      reduced-motion rule from `theme.css`.
- [ ] Hide `[data-decor]` and the sound control with `display: none` when
      `data-costume="off"`.
- [ ] Task 3b's lint tests go green. `tests/e2e/lab.spec.ts` still passes.

Verified:

---

## Task 6: Motifs, the crack and freshness (R-04, R-07, R-12)

- [ ] Create `src/ui/draw/motifs.ts`: the four motifs as pure descriptors and a
      `toSvgElement` that builds them with `createElementNS`. Every root carries
      the three attributes in the design.
- [ ] Create `src/ui/draw/crack.ts` with `wideCrackPoints`, and a small builder
      that returns the crack as a decorative element (a `polyline` with
      `pathLength="1"`, wrapped with `aria-hidden` and `data-decor`).
- [ ] Create `src/ui/fresh.ts` with `createFreshTracker`.
- [ ] Tasks 3c and 3d go green. `tests/ui/treeSvg.test.ts` still passes.

Verified:

---

## Task 7: Dress the timeline, running log and tree (R-03, R-04, R-05, R-07, R-09)

- [ ] `costume.css`: the cold, warm and fork point dressing for `.timeline-option`
      and `.running-entry`, keyed on `data-role`, using the wash tokens, the edge,
      the frost streaks and the warm bloom. Role-coloured text only on `--bg`,
      `--surface` or its own wash; `--ink` elsewhere. No border width or padding
      changes.
- [ ] `timeline.ts`: add the crack decoration as an absolute child of the option
      whose step has `edited: true`. Positioned in the 8 px gap, `pointer-events:
      none`.
- [ ] `running.ts`: ask the freshness tracker which live ids are new and set
      `data-fresh="true"` on those entries only; reset the tracker when given zero
      live steps and not finished. Add the crack at the foot of the prefix box and
      the gear in the control row (absolute, only while live, one tooth per fresh
      step, angle set with `style.setProperty`).
- [ ] `treeSvg.ts`: add `pathLength="1"` and `aria-hidden="true"` to the crack
      polyline, a shine circle (aria-hidden) on each node, and the glow on live
      lines in CSS. `treeitem` roles and names do not change.
- [ ] Fog and haze on the timeline and tree hosts. Light theme variants come from
      the tokens, with no per-theme duplicate rules unless a token cannot do it.
- [ ] Run the Task 3g reflow, decoration-hidden and only-new-steps tests, and the
      three existing end-to-end files. All green.

Verified:

---

## Task 8: Dress compare (R-06)

- [ ] `compare.ts`: add `data-branch="parent"` and `"new"` to the two columns and
      `data-role` (from `stepRoleWords`) to every row. Choose the crack index as the
      design says (first edited step in the new column, else the first difference,
      else none) and add the crack as an absolute child of that row in both
      columns.
- [ ] Add the hourglass to the branch A header and the bolt to the branch B
      header. The header text is unchanged.
- [ ] `costume.css`: the cold column, the cold-to-warm column, the loud first
      difference (fill, 2 px outline, 4 px inset notch), and the readout face for
      the footer.
- [ ] Task 3g "Compare tells the story" and "Plain words" go green, in both themes.
      The existing compare assertions in `lab.spec.ts` still pass.

Verified:

---

## Task 9: The fork moment (R-10)

- [ ] `costume.ts`: add `playMoment(beat)` that sets `data-fork-moment` on `#app`
      to `start` or `settle` and clears it after 900 ms, cancelling any earlier
      timer. It sets the attribute whatever the motion preference is.
- [ ] `main.ts`: call `playMoment("start")` at the top of `runForward()`, and
      `playMoment("settle")` in the `onDone` handler before the saved branch loads.
      Nothing else changes in the control flow.
- [ ] `costume.css`: the `start` and `settle` rules and keyframes from the design.
      Only `opacity`, `transform`, `box-shadow`, `stroke-dashoffset` and `filter`
      animate.
- [ ] The Task 3g "Reduced motion", "No reflow through the fork moment" and "Only
      new steps animate" tests go green. Confirm by hand that with reduced motion
      set, the page shows the final state at once.

Verified:

---

## Task 10: The header (R-01, R-02, R-12)

- [ ] `main.ts` `buildShell()`: add the clock motif beside the title, in the header.
      The `h1` text and the tagline are unchanged. The header becomes a flex row
      with a right slot for the sound control (empty until Task 11).
- [ ] Apply the display face to the titles and the readout face to the numbers, as
      in the design.
- [ ] Plain view still passes the Task 3g "Plain view" test.

Verified:

---

## Task 11: Sound (R-11). The last build task, and the first to cut if the weekly gate slips

Decision (owner, 2026-11-07): sound is the last build task and the first to cut.
It is stretch item 4 in `product.md`.

- [ ] Create `src/ui/sound.ts` with `createSound(makeContext)`, the crack and the
      kindle as described, with a master gain peak of 0.15.
- [ ] Add the header button: "Sound: off" by default, fixed width of 19ch, a plain
      button, announces "Sound on" and "Sound off". Create the real context only on
      the first toggle on. Call `playForkMoment()` from `runForward()` right after
      `playMoment("start")`, only when costume is on.
- [ ] Task 3e and the Task 3g "Sound is off" test go green.
- [ ] Add the row to `docs/assets.md`: file `src/ui/sound.ts`, "fork moment
      sound, made at run time with the Web Audio API, no audio file", source
      "Original, written for this repo", license "MIT, with the repo".
- [ ] If this task is cut: delete R-11, the Task 3e and Task 3g sound tests, and
      the sound lines in `design.md`, in one commit, and note the cut in the
      Verified line.

Verified:

---

## Task 12: Docs (R-15)

- [ ] `README.md`: add a short note on plain view (`?costume=off`) and the sound
      control. Say only what has been built. Write the whole file out; do not edit
      in place.
- [ ] `docs/assets.md`: confirm the sound row (or the cut note) is present and no
      image over 100 KB exists.
- [ ] `docs/kiro-usage.md`: add dated rows for the spec 05 work, including what
      did not work. Write the whole file out.

Verified:

---

## Task 13: Review pass (R-15, R-16, R-17)

- [ ] `tests/repo/banned-names.test.ts` passes. Record in the Verified line how
      many terms it parsed. This replaces the hand check of every file against
      `safety-and-trademarks.md` for names. Look-alikes and imitation are not
      names, so the screenshot review below still covers those by eye.
- [ ] `tests/ui/writing.test.ts` passes: no em dashes.
- [ ] Search the spec's files for "robust", "seamless", "leverage" and for
      invented synonyms of the product words. Fix any.
- [ ] Confirm no test file from earlier specs was edited, except
      `tests/ui/contrast.test.ts` (extended).
- [ ] Review the screenshot used for the gate for anything on screen that should
      not be there: a key, a notification, another project (R-18, and the
      footage rule in `safety-and-trademarks.md`). Also look at it for anything
      that imitates a banned design.

Verified:

---

## Task 14: The unlabelled compare check (R-18, the gate)

- [ ] Produce the screenshot as described in `design.md`: full loop on the fake
      model, compare view, all text made invisible. Do not commit it.
- [ ] Show it to at least five adults who agree to take part and have never seen
      Chrono-Lab. Ask: "Which future is the new one?" and "Where did it split?"
      Do not explain the product first.
- [ ] Record the date, the number of people, how many got both right, and what
      confused anyone. Pass at four of five.
- [ ] Repeat in the light theme with at least three people.
- [ ] If it fails, fix the dressing that confused them (not the labels), re-run
      Tasks 3g and 4, and repeat with different people.

Verified:

---

## Task 15: Close out

- [ ] `npm run typecheck`, `npm test`, `npm run build:ui` and `npm run test:e2e`
      all pass. Record the totals and the final gzipped size of `dist/ui` against
      the Task 1 baseline.
- [ ] Every box above is ticked, each with a filled `Verified:` line. Where a
      task's wording no longer matches what was built, say so in its line rather
      than ticking silently.
- [ ] Confirm `design.md` still lists no open questions, or list any new ones in
      the hand-off.

Verified:
