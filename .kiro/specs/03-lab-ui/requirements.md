# Spec 03: The Lab UI: Requirements

**Date:** 2026-11-04
**Scope:** a web UI for Chrono-Lab and the smallest server behind it. The UI
shows a run as a timeline, draws its branches as a tree, forks at a step, runs
the future forward live, and compares two branches. The server serves the UI
and exposes record, list, fork and compare over JSON, with the spend caps from
spec 02 wired to one global ledger for the overall cap and one per-session
ledger for the session cap.

**Builds on:** specs 01 and 02, both built and merged. The `Trace` and `Step`
types, `Recorder` (with `continueFrom` and `onStep`), `replayTrace`,
`forkTrace`, `compareBranches`, and the cap logic in `src/server/caps.ts` are
all in use here. This spec adds two options to `forkTrace` and the record
path (`onStep` and an abort `signal`, see C-03) and composes the session and
global ledgers (R-07); both changes are specified fully in `design.md`.

---

## Background

A user has recorded a run. They want to open it, look at a step, rewind to it,
change one thing, run the future forward, and see the two futures side by side.
The library already does the work. This spec gives it a face.

The product is entered in the Costume Contest category, so the look is scored.
The theme is a time lab at night: dark, glowing readouts, branches drawn like
cracks in glass. The theme dresses a real tool. Every label still says plainly
what it does, and the tool works with the costume taken off.

Spec 04 builds the demo agent and demo mode. Until then the UI runs end to end
on synthetic traces we write plus a deterministic fake model, so this spec's
gate passes with no real model and no API key.

The gate for this spec is:

> Someone who has never seen Chrono-Lab completes a full rewind and compare
> without help.

---

## Glossary

Words from `product.md`, used exactly in code, UI and docs:

| Word | Means |
|---|---|
| Run | One execution of an agent on one task |
| Step | One unit on the timeline: a model call, a tool call, or a tool result |
| Timeline | The ordered steps of one run |
| Branch | A timeline that shares a prefix with its parent and differs from the fork point on |
| Fork point | The step that was edited to create a branch |
| Future | Everything a branch produced after its fork point |
| Replay | Re-producing recorded steps from the recording, with no live calls |

Two more words this spec uses for states, not for the trace:

| Word | Means |
|---|---|
| Demo mode | The app is serving a prerecorded future instead of a live one, and says so |
| Cap reached | A spend cap stopped a live run; the branch is partial |

---

## The server

### R-01: The server serves the UI and nothing it does not need

**EARS:** When the server starts, it shall serve the built UI (HTML, JS, CSS)
on a single HTTP port and expose exactly the JSON endpoints listed in R-02
through R-06. The server shall not expose any endpoint that writes outside the
session trace directory, and shall not read the model API key into any response.

There are no accounts. A session is identified by an opaque id. The server does
not mint a session on every request: a static-file request or a read-only API
request carries no session and creates none. The server mints a session only on
the first API call that writes (R-02 record or R-05 fork), as set out in R-07a.
All of a session's traces live under one directory that is deleted when the
session expires.

### R-01a: Safe static-file serving and a content security policy

**EARS:** When the server serves a static file, it shall resolve the requested
path inside the built UI directory (`dist/ui`) only, and shall reject with a 404
any request whose resolved path escapes that directory (for example via `..` or
an absolute path), without reading the file. The server shall set a
`Content-Security-Policy` header on every HTML response that allows scripts and
styles from the same origin only, and forbids inline and third-party scripts.

### R-02: Record

**EARS:** When the UI posts a record request with a task string, the server
shall mint the session if the caller has none (R-07a), run the agent with the
active model adapter through `Recorder`, stream each step to the UI as it is
recorded (via `onStep`), save the finished trace, and return the saved trace's
`runId`. Until spec 04 ships the demo agent, the active model adapter is the
deterministic fake model (see R-15), so record never makes a network call.

### R-03: List

**EARS:** When the UI requests the list of traces for its session, the server
shall return, for every trace in the session directory: its `runId`, its
`parentRunId` (absent on a root run), its `forkPointStepId` (absent on a root
run), its `createdAt`, its step count, and the content of its final `model_call`
output (or `null` if none). The list is enough to draw the branch tree without
loading every full trace. A caller with no session gets an empty list, not a new
session.

### R-04: Load one trace

**EARS:** When the UI requests one trace by `runId` for its session, the server
shall return the full `Trace` as saved, or a 404 error naming the `runId` if no
such trace exists in the session.

### R-05: Fork

**EARS:** When the UI posts a fork request naming a parent `runId`, a
fork-point step id, and exactly one edit (per spec 02 R-01), the server shall
mint the session if the caller has none (R-07a), call `forkTrace` with the
session ledger and the global ledger composed as R-07 sets out, stream each live
step to the UI as it arrives (via `onStep`), and on completion return the
`ForkResult`: either `ForkSuccess` with the new branch's `runId`, or `ForkCapHit`
with the reason, the limit, and the partial branch's `runId`. The replay of the
prefix makes zero live calls; the live phase runs outside the network guard.

### R-06: Compare

**EARS:** When the UI posts a compare request naming two `runId`s in its
session, the server shall load both traces and return the `CompareResult` from
`compareBranches`: the first difference (index and both step ids, or `null`),
and for each branch its final output, total tokens, total cost and total
duration.

### R-07: Two ledgers compose: session cap per session, overall cap global

**EARS:** The server shall hold exactly one session `SpendLedger` per session
(for the session cap) and exactly one global `SpendLedger` for the whole server
(for the overall cap). Before each live model call, `forkTrace` shall check the
session total against the session cap and the global total against the overall
cap, and shall let the call proceed only when both pass. After each live call,
`forkTrace` shall add the actual cost to both the session ledger and the global
ledger. The overall cap therefore counts spend across every session; opening
many sessions does not raise the overall limit. When either cap would be
exceeded, the server shall return `ForkCapHit` with the partial branch saved,
naming which cap was reached, and shall never let a live call push either total
past its cap.

### R-07a: Sessions are minted sparingly and capped in number

**EARS:** The server shall create a session only on the first writing API call
(record or fork) from a caller that presents no valid session, and shall cap the
number of live sessions at `config.maxLiveSessions`. When the session cap is
full and a new session would be needed, the server shall return a 503 error with
a plain reason that says the lab is at capacity and to try again later, and
shall not create the session. A session freed by expiry (R-01) makes room for a
new one.

### R-08: Stop a running fork

**EARS:** While a fork is running live and streaming steps, when the UI sends a
stop request for that fork, the server shall stop the live run cleanly after the
current step, save the partial branch (the replayed prefix plus any live steps
completed so far), and return the partial branch's `runId`. The server stops the
run by aborting the `signal` it passed into `forkTrace` (C-03); the abort saves
the partial branch the same way a cap hit does. No step already streamed to the
UI shall be lost or rewritten.

### R-09: Rate limits from the first deploy

**EARS:** The server shall apply a per-session rate limit, a per-IP rate limit,
and a global rate limit to the record and fork endpoints from the first deploy.
The per-IP limit sits beside the global one so a caller cannot get around the
per-session limit by dropping the session cookie, because an unsessioned writing
call is still counted against its IP. When a limit is exceeded, the server shall
return a 429 error with a plain reason, and the UI shall show it as an error
state (R-14), not a crash.

### R-10: Visitor input is text, never code

**EARS:** When the server receives any string from the UI (a task, an edited
prompt, an edited tool result), it shall treat it as data. The string shall be
escaped on display in the UI (R-13) and shall never be evaluated, executed, or
written anywhere outside the session trace as recorded content.

### R-10a: A stream belongs to the session that opened it

**EARS:** When the UI opens a step stream, the server shall bind that stream's
`streamId` to the session that opened it, and shall refuse (404) any request to
read that stream from a different session or from no session. One session cannot
read another session's live steps.

---

## The screens

Every screen obeys one layout rule.

### R-11: Reserved space for every state

**EARS:** When any element can show more than one state (content, empty,
loading, error, cap reached), the UI shall reserve the element's full space up
front so that changing state does not move any other element on the screen.
Loading uses a placeholder of the same size as the loaded content; an error or
empty state fills the same box. Nothing reflows when a state changes. The
end-to-end test (R-22) measures this in a real browser.

### R-12: The timeline

**EARS:** When a run is loaded, the UI shall show its steps in order. Each step
shall show its `kind` in plain words (model call, tool call, tool result), a
short summary of its content, its token count (for a model call; shown as none
for a tool step), and its duration. When the user selects a step, the UI shall
open that step's full `input` and full `output` as recorded.

The summary for each kind:
- model call: the first line of the assistant output, or the model name and
  "requested a tool" when the step is a tool call request.
- tool call: the tool name and its arguments.
- tool result: the first line of the returned result.

### R-13: The branch tree

**EARS:** When a run has one or more branches, the UI shall draw every branch
of the run as lines that split off from their parent at the fork point. A
replayed step (`live: false`) and a live step (`live: true`) shall be drawn
differently so the two are told apart without reading a label, and the
difference shall also be stated in text for a screen reader. Selecting a branch
in the tree loads its timeline (R-12).

The fork-point step (`edited: true`) shall be marked distinctly from both
replayed and live steps.

### R-14: Edit at a fork point

**EARS:** When the user selects a step as the fork point, the UI shall show the
fields that step allows to be edited (spec 02 R-01):
- a `model_call` step: its prompt, its `model`, or its `settings`, one at a
  time. The prompt is `input.messages`, an array of role-and-content entries;
  the UI shall not present the whole array as one text box. It shall let the
  user pick one message to edit (defaulting to the last user message), edit that
  message's content, and leave the other messages unchanged. The edited content
  replaces that message's content, producing the new `input.messages` array the
  fork uses. The other messages are shown read-only for context.
- a `tool_result` step: its `output.result`.

The UI shall not offer an edit for a `tool_call` step or for any structural
field, and shall let the user change only one field before running forward. The
UI shall show one clear action, labelled in plain words, that runs the future
forward from the edited step.

In demo mode (R-17), the UI shall offer only the fork points that have a
prerecorded future. A fork point with no prerecorded future shall be shown
disabled, with a plain reason that this step has no prerecorded future in demo
mode. A fork the UI runs in demo mode shall return the prerecorded future that
belongs to the chosen fork point, never a future for a different step.

### R-15: Running

**EARS:** While a fork runs forward, the UI shall show each live step as it
arrives, in order, appended to the replayed prefix. The UI shall show that the
run is live and shall show one clear control to stop it (R-08). When the run
finishes, the UI shall show the complete new branch and offer to compare it with
its parent.

Until spec 04, the live phase uses the deterministic fake model: a model adapter
that returns a fixed, recorded sequence of outputs for a given input, so a fork
runs forward to a stable result with no network call and no API key. The fake
model is the active model for both record and fork in this spec.

### R-16: Compare

**EARS:** When the user compares two branches, the UI shall show them side by
side, aligned at the fork point, with the first step where they differ
highlighted on both sides. For each branch the UI shall show its final output,
its total tokens, its total cost and its total duration, taken from
`compareBranches`. When the two branches do not differ (`firstDiff` is `null`),
the UI shall say so plainly rather than highlighting nothing.

### R-17: Demo mode banner

**EARS:** Whenever the app serves a prerecorded future instead of a live one,
the UI shall show a banner that says the app is in demo mode and why (the spend
cap was reached, or no model is configured). The banner shall be present on
every screen while demo mode is active and shall not cover or hide any control.
When the app is not in demo mode, the banner's reserved space stays empty and
nothing shifts (R-11).

In this spec, demo mode is reached one of two ways: a spend cap is hit (a real
`ForkCapHit`), or the app is started with no model configured and falls back to
replaying a prerecorded future from `demo/`. In the no-model fallback, the UI
offers only the fork points that have a prerecorded future and returns the
future belonging to the chosen fork point (R-14). The full prerecorded-future
library belongs to spec 04; this spec ships enough synthetic demo content for
the banner and the fallback to work.

### R-18: Empty, loading, error and cap-reached states for every screen

**EARS:** Every screen (timeline, branch tree, edit, running, compare) shall
have a defined empty state, loading state, error state and cap-reached state,
each filling the reserved space (R-11):
- Empty: no run loaded yet, or no branches yet. Says what to do next in plain
  words.
- Loading: a placeholder the size of the loaded content while a request is in
  flight.
- Error: a plain message naming what failed and what the user can do, never a
  raw stack trace and never a secret.
- Cap reached: the branch is partial because a spend cap stopped it; says which
  cap and that the shown steps are what completed before the stop.

---

## Accessibility

### R-19: Keyboard only

**EARS:** The UI shall be fully operable with a keyboard alone. Every control
(select a step, select a branch, edit a field, run forward, stop, compare) shall
be reachable and usable by keyboard, in a logical order, with a visible focus
indicator at all times. No action shall require a pointer.

### R-20: Screen reader

**EARS:** The UI shall read correctly with a screen reader. Every control shall
have a name that says what it does. The timeline and the branch tree shall
expose their structure and the current selection to assistive technology. The
difference between a replayed step and a live step, and the location of the
first difference in a compare, shall be conveyed in text, not by colour or shape
alone.

### R-21: The theme never hides a control

**EARS:** The theme shall not make any control's purpose unclear. Every label
shall state plainly what the control does. Colour, glow and motion shall be
decoration over a plain, readable interface, never the only way to tell one
thing from another. Every text foreground/background pair shall meet WCAG AA
contrast (4.5:1), and every graphical object that carries meaning (the
branch-tree lines) shall meet 3:1 against its background; a unit test over the
palette tokens checks both (R-23).

---

## The end-to-end test

### R-22: One browser test drives the full loop

**EARS:** There shall be one end-to-end test, run in a real browser with
Playwright, that drives the full loop: record a run, rewind to a step, edit that
step, run the future forward, and compare the new branch with its parent. The
test shall run against the deterministic fake model so it is stable and needs no
network and no API key. The test shall assert that each screen reaches the right
state: the timeline shows the recorded steps, the edit screen shows the editable
fields, the running screen shows live steps arriving, and the compare screen
shows the first difference and both costs.

The test shall also check the no-reflow rule (R-11) in the real browser: it
measures the on-screen boxes of the banner slot, the Stop button and each state
region before and after each state change, and fails on any movement. The
layout check lives here because Playwright has a real layout engine; a Vitest
unit test cannot measure element boxes.

Installing the Playwright browsers is a one-time setup step done outside the
build, not a task the build runs. The test assumes the browser is already
installed.

### R-23: The palette contrast test

**EARS:** There shall be a unit test that reads the palette tokens from
`tokens.css` and computes the contrast ratio of every token pair the UI relies
on, for both the dark and the light theme. The test shall fail if any text pair
is below 4.5:1 or any meaning-carrying graphical pair (the branch-tree line
against its background) is below 3:1. The contrast figures stated in `design.md`
are the measured values this test enforces.

---

## Changes the library needs

Three small additions. None removes or renames anything specs 01 and 02 export.
All are specified fully in `design.md`.

### C-01: A deterministic fake model adapter in `src/agent/`

The UI and the e2e test need a model adapter that returns a fixed sequence of
outputs for a run and for a fork, with no network call, so the gate passes
before spec 04 exists. The stand-in adapters in `tests/fixtures/stand-in-agent.ts`
prove the shape but live under `tests/`; the server needs one it can import from
`src/`. Add a `src/agent/fake-model.ts` that exports a deterministic
`ModelAdapter` and a small sandboxed `ToolRegistry` (an `echo` tool), reusing the
same response shapes. Spec 04 replaces this with the real demo agent and keeps
the same `ModelAdapter`/`ToolRegistry` interfaces.

### C-02: Synthetic trace fixtures and one prerecorded future in `demo/`

The UI must open a run before anyone forks one, and the demo-mode fallback must
have a prerecorded future to replay. Add synthetic traces under `demo/`: at
least one recorded root run and one prerecorded forked future of it, both
written by hand (or by running the fake model once and saving), both valid
version `1.1.0` traces, both free of any string a scrub pattern would match.
These are synthetic content we wrote; no real person's data.

### C-03: `onStep` and an abort `signal` on the fork and record paths

Stop (R-08) and streaming (R-05, R-15) need two options on `forkTrace` (and on
the record path), not just the `onStep` the recorder already has:

- `onStep`: a callback `forkTrace` calls for each live step as it is produced,
  so the server can stream steps over SSE without waiting for the fork to
  finish. Today `forkTrace` passes its own collector to the `Recorder` and
  returns only the finished branch; it exposes no `onStep` of its own.
- `signal`: an `AbortSignal` the server aborts to stop a running fork. When the
  signal aborts, `forkTrace` shall stop after the current step and save the
  partial branch (the replayed prefix plus the live steps completed so far), the
  same way a cap hit saves a partial branch. Today `forkTrace` catches only its
  cap sentinel; a stop raised from a callback would escape as an error instead
  of saving a partial branch.

Both options are added to `ForkOptions` and to the record path, and are
specified in `design.md`. Each has its own test (see tasks).

---

## Out of scope

- The real demo agent and the full prerecorded-future library (spec 04).
- Recording agents that run real tools with real side effects.
- Accounts and long-term storage. Sessions expire.
- Uploading a visitor's own traces to the public site.
- The stretch items in `product.md` (framework import, multi-sample branches,
  MCP proxy, sound beyond the fork moment).

---

## Gate

The spec is done when someone who has never seen Chrono-Lab completes a full
rewind and compare without help, and the Playwright end-to-end test (R-22)
passes against the deterministic fake model with no network and no API key.
