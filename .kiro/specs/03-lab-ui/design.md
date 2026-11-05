# Spec 03: The Lab UI: Design

**Date:** 2026-11-04

---

## Overview

Two new areas, three small library additions:

```
src/server/   extended: the HTTP server (caps.ts already exists)
src/agent/    new: the deterministic fake model and its sandboxed tools
src/ui/       new: the lab front end (plain TypeScript + Vite, SVG drawings)
demo/         new: synthetic traces and one prerecorded future
tests/e2e/    new: the Playwright browser test
```

The library additions are `onStep` and `signal` on `forkTrace` and the record
path (C-03), the fake model (C-01), and the demo fixtures (C-02). The engine
from specs 01 and 02 otherwise stays as it is. The flow is always the same:

```
UI  --HTTP/JSON-->  server  --calls-->  Recorder / forkTrace / compareBranches
UI  <--SSE stream--  server  <--onStep-- live steps as they arrive
```

---

## Run it

Build the UI once, start the server, open the URL it prints:

```
npm run build:ui        # writes the UI bundle to dist/ui
npm run serve           # starts the server on http://127.0.0.1:3000
```

`serve` reads two environment variables, both optional:

- `PORT` (default `3000`): the port to bind. An integer in 1..65535; anything
  else exits with a plain message.
- `MODEL_MODE` (default `fake`): `fake` runs the deterministic fake model;
  `demo` serves the committed `demo/` fixtures. Any other value exits with a
  plain message.

The server binds `127.0.0.1` only, writes traces under `.traces`, and stops
cleanly on Ctrl-C. If `dist/ui` is missing it prints a message asking you to run
`npm run build:ui` first, rather than serving a blank page.

For UI development, run the server and the vite dev server together:

```
npm run serve           # the API on :3000
npm run dev             # the vite dev UI, proxying /api to :3000
```

`npm run dev` proxies `/api` (JSON and the SSE stream) to the serve port, so the
dev UI reaches the running server. When `serve` runs on a non-default port, set
the same `PORT` for `npm run dev` so the proxy target matches.

---

## Front-end stack: the call

**Plain TypeScript with Vite, no UI framework; the timeline and branch tree are
hand-drawn SVG.** The whole UI is five screens over one trace shape and a handful
of state transitions, so a framework's reconciler earns nothing here, and the
SVG drawings are imperative anyway. Vite gives a fast dev server, a typed build,
and a bundle the Node server serves as static files.

### New dependencies, exact versions

| Package | Version | Why |
|---|---|---|
| `vite` | `5.4.21` | Dev server and production build for the UI bundle. The latest 5.4 release; it carries dev-server file-access fixes that `5.4.10` predates |
| `@playwright/test` | `1.48.2` | The one end-to-end browser test (R-22) |

No runtime framework dependency is added. The UI ships as the TypeScript already
in the repo plus these two dev tools. `@playwright/test` is a dev dependency;
its browser binaries are installed once outside the build (see the e2e section).

---

## The library additions (C-03): `onStep` and `signal` on `forkTrace`

`forkTrace` today builds its own `collectedLiveSteps` array, passes a collector
to the `Recorder`, and returns the finished branch. It catches only its internal
`CapSentinel`. The server needs to stream steps as they arrive and to stop a
running fork, so `ForkOptions` gains two optional fields:

```typescript
export interface ForkOptions {
  // ...existing fields...
  // Called for each live step as it is produced, before the fork returns.
  // The server writes one SSE event per call. Replayed prefix steps are not
  // passed to onStep; only live steps are.
  onStep?: (step: Step) => void;
  // Aborted by the server to stop a running fork. On abort, forkTrace stops
  // after the current step and saves the partial branch, the same way a cap
  // hit does.
  signal?: AbortSignal;
}
```

### How `onStep` is wired

`forkTrace` keeps its internal collector for assembling the branch, and also
calls `options.onStep` for each live step in the same place it pushes to the
collector. The recorder's own `onStep` (which `forkTrace` already supplies to
collect steps) is the single source: `forkTrace`'s recorder callback both pushes
to the collector and forwards to `options.onStep` when present. The immediate
model-call edit path (which runs one live call directly, before any recorder
loop) also forwards that first edited live step to `options.onStep`.

### How `signal` stops a run and saves a partial branch

A new `StopRequested` sentinel mirrors the existing `CapSentinel`:

```typescript
class StopRequested extends Error {}
```

The recorder's `onStep` callback inside `forkTrace` checks `signal?.aborted`
after forwarding each step; when the signal is aborted it throws `StopRequested`.
The `try/catch` around `recorder.continueFrom` already catches `CapSentinel` and
falls through to save the partial branch; it is widened to catch `StopRequested`
the same way:

```typescript
try {
  await recorder.continueFrom(/* ... */);
} catch (err) {
  if (err instanceof CapSentinel) {
    capHit = err.capError;            // fall through, save partial
  } else if (err instanceof StopRequested) {
    stopped = true;                   // fall through, save partial
  } else {
    throw err;
  }
}
```

On a stop, `forkTrace` assembles and saves the branch from the prefix plus the
live steps collected so far (exactly the cap-hit path) and returns a
`ForkSuccess` whose `branch` is the partial branch. The server reads the saved
`runId` from it. A stop is a clean, saved result, not a cap hit, so it does not
use the `ForkCapHit` shape; the branch simply has fewer live steps.

### The record path

The record path (`Recorder` driven by the server for `/api/record`) already
accepts `onStep`. It gains the same `signal` handling so a record in flight can
be stopped and its partial run saved, matching R-08's wording for a running
fork. The server passes the per-stream abort signal into both record and fork.

### Tests for C-03 (written first)

- `onStep` on `forkTrace`: a fork with an `onStep` callback calls it once per
  live step, in order, and the collected steps equal the branch's live steps.
- `signal` on `forkTrace`: aborting the signal after the first live step saves a
  partial branch holding the prefix plus exactly the steps completed before the
  abort, and makes no further live call. A test proves no step already passed to
  `onStep` is dropped or rewritten in the saved branch.

### The step bound (`maxSteps`): ending a runaway run (C-03)

A library change found while writing the Task 2 stop test. Nothing bounded an
agent run: a model that keeps asking for a tool makes `Recorder.run` and
`continueFrom` loop forever, and with the zero-cost fake model the spend caps
never stop it. On the public site that is a runaway. The Task 2 stop test even
exhausted a test worker's memory before the bound existed.

`RecorderOptions` gains `maxSteps?: number`, defaulting to `DEFAULT_MAX_STEPS`
(50). The loop counts the steps it has produced and, before the next model call
or tool step, ends cleanly when the count reaches the bound. The run then
records `endReason: "max_steps"` instead of looping. `Trace` gains an optional
`endReason` field:

```typescript
export type EndReason = "stop" | "max_steps" | "aborted" | "cap";

export interface Trace {
  // ...existing fields...
  // Why the run ended. Absent when not recorded (older traces, replays).
  endReason?: EndReason;
}
```

`endReason` is optional and additive: older traces and replays omit it, and the
replay step-for-step equality is unaffected, since it compares steps, not the
trace envelope.

`forkTrace` passes the bound into the live phase. The edited fork-point step
counts as the first live step, so the recorder that drives the rest is given
`maxSteps - 1`, keeping the whole live phase within the bound. A step-bound end
is a clean, saved result (`ForkSuccess`) whose branch is simply shorter, the
same shape as a stop; the branch records `endReason: "max_steps"`. The record
path inherits the bound directly from `Recorder`.

#### How the bound relates to the stop signal

The stop signal (the rest of C-03) and the step bound are two ways the same loop
ends early and saves a partial run. The signal is a user or server asking to
stop now (`endReason: "aborted"`); the bound is the loop refusing to run forever
(`endReason: "max_steps"`). The `Recorder` checks `signal?.aborted` and the step
count at the same points in the loop, so a record in flight stops for either
reason, and `forkTrace` saves the partial branch either way.

Note the implementation detail: the signal is honoured inside the `Recorder`
loop itself (and inside `forkTrace` right after the immediate model-call edit
step), not by throwing a `StopRequested` sentinel out of a callback. The effect
matches the `StopRequested` description above: on an aborted signal the loop
stops after the current step and the partial branch is saved, a clean
`ForkSuccess` whose branch is simply shorter.

#### Tests for the step bound (written alongside the stop test)

In `tests/recorder/max-steps.test.ts`:

- A model that never stops ends a record run at the bound, with
  `endReason: "max_steps"` and a step count no greater than `maxSteps`.
- The default bound applies when none is given.
- A runaway fork live phase ends at the bound instead of looping, returning a
  clean `ForkSuccess` whose branch records `endReason: "max_steps"`.

`tests/compare/fork-stop.test.ts` is written so that, without the stop
behaviour, it fails on an assertion rather than by exhausting memory: its live
adapter still returns tool-call turns, but the test aborts the signal from the
first `onStep` call, and the step bound backstops the run so the fork cannot
loop forever even if the abort is not honoured.

---

## The server (`src/server/`)

### Why a plain Node `http` server

The server has one job: serve static files and five JSON endpoints, with one
streaming endpoint for live steps. Node's built-in `http` module and the
`fetch`/`Response` primitives cover this without a web framework, which keeps the
dependency list at the two above. Server-Sent Events (SSE) carry the `onStep`
stream: one long-lived `GET` the browser reads with `EventSource`, one event per
step.

### Files

```
src/server/
  caps.ts        (exists) prices, checkCaps, recordSpend, SpendLedger
  main.ts        the entry: reads PORT and MODEL_MODE, serves dist/ui, listens on 127.0.0.1, stops on SIGINT/SIGTERM
  server.ts      createServer: routing, static files, start/stop, CSP
  sessions.ts    SessionStore: mint on first write, cap count, expire; one session ledger each
  ledger.ts      the one global SpendLedger for the overall cap
  routes.ts      the five JSON handlers plus the SSE stream
  config.ts      ServerConfig: port, caps, rate limits, trace dir, demo dir, session cap
  rateLimit.ts   per-session, per-IP and global token-bucket limiter
  static.ts      safe path resolution inside dist/ui
```

`main.ts` is the top-level entry `npm run serve` runs. `createServer` (in
`server.ts`) only builds a `ServerHandle`; it never listens on its own, so the
entry reads the environment, calls `createServer`, starts it, prints
`Chrono-Lab running at http://127.0.0.1:<port>`, and keeps the process alive
until a signal stops it. Its env parsing lives in a pure, exported `parseEnv`
so a unit test checks the defaults, the demo mode, an invalid mode and an
invalid port without starting a server. If `dist/ui` is missing when it starts,
it prints a plain message pointing at `npm run build:ui` and exits rather than
serving a blank page.

### The two ledgers (R-07)

The overall cap is a property of the whole server, not of one session, so it
needs one ledger the whole server shares. The session cap is per session. Both
are `SpendLedger` values from `createSpendLedger()`, but they are composed, not
nested:

- `ledger.ts` creates exactly one **global ledger** at server start. Its
  `overallSpendUsd` total is the only overall total that matters.
- Each session holds its own **session ledger** for its `sessionSpendUsd` total.

Before each live call, the check reads the session total from the session ledger
and the overall total from the global ledger, and passes both to `checkCaps`
with the session and overall caps. After each live call, the actual cost is
added to both the session ledger and the global ledger. Because the overall
total lives in one shared place, opening many sessions (a new cookie each time)
cannot spend past the overall cap: every session's live call adds to the same
global total and is checked against it.

`forkTrace` already takes one `spendLedger` and checks both totals on it. To keep
`forkTrace` unchanged here, the server passes a **composed ledger view** into
`forkTrace`: a `SpendLedger` whose `get()` returns `{ sessionSpendUsd }` from the
session ledger and `{ overallSpendUsd }` from the global ledger, and whose
`add(cost)` adds to both underlying ledgers. The composition lives in the server
(`ledger.ts` exports `composeLedger(session, global)`); `caps.ts` is unchanged
beyond the one zero-cost `"fake"` price entry.

```typescript
// src/server/ledger.ts
export function composeLedger(
  session: SpendLedger,
  global: SpendLedger
): SpendLedger {
  return {
    get: () => ({
      sessionSpendUsd: session.get().sessionSpendUsd,
      overallSpendUsd: global.get().overallSpendUsd,
    }),
    add: (costUsd: number) => {
      session.add(costUsd);
      global.add(costUsd);
    },
  };
}
```

A test proves two different sessions, each under the session cap, together hit
the overall cap: the second session's fork returns `ForkCapHit` with
`reason: "overall"` once their combined spend reaches the overall limit.

### Session model (`sessions.ts`)

No accounts, and no session on every request. A static-file request or a
read-only API call carries no session and makes none (R-01). The server mints a
session only on the first writing call (record or fork) from a caller with no
valid session cookie (R-07a). On minting, the server sets an opaque session id
(a UUID) in an `HttpOnly` cookie and creates a session record:

```typescript
interface Session {
  id: string;
  traceDir: string;        // <config.traceRoot>/<id>, created on first write
  ledger: SpendLedger;     // the session ledger, from createSpendLedger()
  createdAt: number;       // epoch ms
  lastSeenAt: number;      // epoch ms, bumped on each request
}

interface SessionStore {
  // Returns the caller's session, or undefined for a read-only / static call.
  get(req): Session | undefined;
  // Mints a session for a writing call. Throws SessionCapFull when the live
  // session count is at config.maxLiveSessions.
  create(req): Session;
  sweepExpired(nowMs: number): void;   // deletes expired sessions and their dirs
  liveCount(): number;
}
```

A session expires `config.sessionTtlMs` after `lastSeenAt`. A timer calls
`sweepExpired`, which removes each expired session's trace directory and drops
the record. `sweepExpired` deletes only directories that resolve inside
`config.traceRoot`: it joins `traceRoot` with the session id, resolves the path,
checks the resolved path is still inside `traceRoot`, and only then calls
`fs.rm(dir, { recursive })`. It never removes a path outside `traceRoot`. The
sweep also frees a slot against `maxLiveSessions`.

When `create` is called and `liveCount()` is already at `config.maxLiveSessions`,
it throws `SessionCapFull`; the route turns that into a 503 with a plain reason
(R-07a).

### Config (`config.ts`)

```typescript
interface ServerConfig {
  port: number;
  traceRoot: string;        // parent dir for per-session trace dirs
  demoDir: string;          // where demo/ fixtures live
  staticRoot: string;       // dist/ui; static files resolve inside this only
  caps: CapConfig;          // sessionLimitUsd, overallLimitUsd (from caps.ts)
  sessionTtlMs: number;
  maxLiveSessions: number;  // the session cap (R-07a)
  rateLimit: {
    recordPerSessionPerMin: number;
    forkPerSessionPerMin: number;
    perIpPerMin: number;    // the per-IP limit (R-09)
    globalPerMin: number;
  };
  modelMode: "fake" | "demo";  // "fake" until spec 04; "demo" forces fallback
}
```

The model API key is read from the environment only if a real model is ever
wired in; in this spec `modelMode` is `"fake"` and no key is read. The key never
appears in a response, a log, or a trace (traces are scrubbed by `saveTrace`).

### Static files and CSP (`static.ts`, `server.ts`, R-01a)

`static.ts` resolves a requested URL path to a file by joining it onto
`config.staticRoot`, resolving the absolute path, and checking the result is
still inside `staticRoot`. Any path that escapes (`..` segments, an absolute
path, a symlink target outside the root) is rejected with a 404 before the file
is opened. Only files under `dist/ui` are ever served.

Every HTML response carries a `Content-Security-Policy` header that allows
scripts and styles from `'self'` only and forbids inline and third-party
scripts:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'self'
```

The UI ships no inline scripts, so `'self'`-only holds without relaxing it.

### Endpoints (`routes.ts`)

All request and response bodies are JSON unless noted. All string inputs are
treated as data (R-10): used only as trace content, escaped by the UI on display.

| Method | Path | Body | Returns |
|---|---|---|---|
| `POST` | `/api/record` | `{ task: string }` | `{ runId: string }` |
| `GET` | `/api/traces` | none | `TraceSummary[]` |
| `GET` | `/api/traces/:runId` | none | `Trace` or 404 |
| `POST` | `/api/fork` | `ForkRequest` | `ForkResponse` |
| `POST` | `/api/compare` | `{ aRunId, bRunId }` | `CompareResult` |
| `POST` | `/api/stop` | `{ forkId: string }` | `{ runId: string }` |
| `GET` | `/api/stream/:streamId` | SSE | a `step` event per step, then `done` or `cap` or `error` |

`POST /api/record` and `POST /api/fork` mint a session if the caller has none
(R-07a); the read-only `GET` endpoints and the static files do not. A read-only
call with no session gets an empty list (traces) or a 404 (one trace), never a
new session.

```typescript
interface TraceSummary {
  runId: string;
  parentRunId?: string;
  forkPointStepId?: string;
  createdAt: string;
  stepCount: number;
  finalOutput: string | null;   // last model_call output content, or null
}

interface ForkRequest {
  parentRunId: string;
  forkPointStepId: string;
  edit: StepEdit;               // exactly one, from src/compare/types.ts
}

type ForkResponse =
  | { status: "ok"; runId: string }
  | { status: "cap_hit"; reason: "session" | "overall"; limitUsd: number; runId: string };
```

### Streaming live steps (SSE), bound to one session (R-10a)

Both record and fork accept an optional `streamId` the UI generates. The UI
opens `GET /api/stream/:streamId` first, then posts the record or fork request
carrying the same `streamId`. When the stream is opened, the server records the
owning session id against the `streamId`. A read of `/api/stream/:streamId` from
a different session, or from a caller with no session, gets a 404: a stream
belongs only to the session that opened it. The server attaches an `onStep`
callback that writes one SSE `step` event per step to the open stream, in order.
When the run finishes the server writes a terminal event:

- `done` with the saved `runId` on success (including a clean stop, whose branch
  is simply shorter),
- `cap` with the reason, limit and the partial branch `runId` on a cap hit,
- `error` with a plain message on failure.

`onStep` is the hook `Recorder` exposes and C-03 adds to `forkTrace`, so the
server streams through it without a second mechanism. If the UI's stream drops,
the run still completes and saves; the UI reloads the finished trace by `runId`.

### Stop (R-08)

The server holds a per-`forkId` `AbortController`. `/api/stop` looks up the
controller for the `forkId`, confirms the controller belongs to the caller's
session (a stop from another session gets a 404), and aborts it. `forkTrace`
sees the aborted `signal` (C-03), stops after the current step, and saves the
partial branch. `/api/stop` returns the partial branch's `runId` once the save
completes. The already-streamed steps are never rewritten.

### Rate limits (`rateLimit.ts`, R-09)

A token-bucket limiter with four kinds of bucket, all in memory: a per-session
record bucket, a per-session fork bucket, a per-IP bucket, and one global
bucket. The per-IP bucket is checked on every writing call, with or without a
session, so dropping the session cookie does not escape the limit: the call
still counts against its source IP. Over-limit requests get a 429 with a plain
reason. The limiter runs from the first deploy, not behind a flag.

### What replay guarantees carry into the server

- The prefix replay inside `forkTrace` runs under `withNetworkGuard`; the live
  phase runs outside it. The server does not re-wrap either.
- `saveTrace` scrubs every trace before it hits disk, so no key reaches a file.
- Step ids stay in `<runId>-<index>` form; the server never mints step ids.

---

## The fake model and sandboxed tools (`src/agent/`, C-01)

```
src/agent/
  fake-model.ts   makeFakeModel(): { modelAdapter, toolRegistry }
```

`makeFakeModel` returns a deterministic `ModelAdapter` and a sandboxed
`ToolRegistry`, matching the interfaces in `src/recorder/types.ts`. It reuses the
response shapes proven in `tests/fixtures/stand-in-agent.ts`, but lives under
`src/` so the server imports it. The adapter returns a fixed output for a given
call position, so a run records the same four steps every time and a fork runs
forward to a stable result. No network, no API key.

```typescript
// src/agent/fake-model.ts
export interface FakeModel {
  modelAdapter: ModelAdapter;   // from src/recorder/types.ts
  toolRegistry: ToolRegistry;   // from src/recorder/types.ts
  reset(): void;
}

// Deterministic: same call sequence gives the same outputs. The echo tool
// returns its text argument unchanged. Sandboxed: no file system, no network,
// no clock.
export function makeFakeModel(): FakeModel;
```

The model name stamped on steps is `"fake"`, added to `MODEL_PRICES` in
`caps.ts` with zero cost (like the existing `"stub"` and `"fork-model"` entries)
so the fake model never trips a cap on its own. This is the one change to
`caps.ts`: one zero-cost table entry, no logic change.

Spec 04 replaces `makeFakeModel` with the real demo agent, keeping the same
`ModelAdapter` and `ToolRegistry` interfaces, so the server does not change when
it lands.

---

## Demo content (`demo/`, C-02)

```
demo/
  root-run.json        a recorded root run (version 1.1.0, from the fake model)
  prerecorded-future.json  one forked future of root-run.json
  README.md            says these are synthetic, written by us
```

Both files are valid `1.1.0` traces produced by running the fake model once and
saving, then committed. `prerecorded-future.json` carries `parentRunId` and
`forkPointStepId` pointing at `root-run.json`. Neither file contains a string
any scrub pattern would match. These seed the UI's empty state (a run to open
before anyone records one) and the demo-mode fallback (R-17).

### Demo-mode fork returns the future for the chosen fork point (R-14, R-17)

When `modelMode` is `"demo"`, a fork does not run live; it returns a prerecorded
future from `demo/`. The server indexes the prerecorded futures by their
`forkPointStepId` (and parent `runId`). A demo fork is served only for a fork
point that has a matching prerecorded future, and returns that future, so the
returned future always belongs to the step the user chose. The server reports,
alongside the trace list, which fork-point step ids have a prerecorded future so
the UI can offer only those (and disable the rest with a plain reason). A fork
request in demo mode for a step with no prerecorded future is refused with a
plain message rather than returning an unrelated future. The server flags demo
mode in the response so the UI shows the banner. The full prerecorded-future
library is spec 04; this spec ships one future, so one fork point is enabled in
the demo fallback and the others are shown disabled.

---

## The front end (`src/ui/`)

### Files

```
src/ui/
  index.html         the single page; reserves every screen's space
  main.ts            boot: fetch session, wire screens, route state
  api.ts             typed client for the seven endpoints + SSE
  state.ts           one app state object and the transitions between states
  screens/
    timeline.ts      R-12: steps in order, select to open input/output
    branchTree.ts    R-13: SVG branch tree, replayed vs live vs fork point
    edit.ts          R-14: editable fields for the selected step, run action
    running.ts       R-15: live steps appended as they stream, stop control
    compare.ts       R-16: two branches aligned, first diff, costs
  components/
    banner.ts        R-17: demo-mode banner, reserved space always present
    stepCard.ts      one step's summary + expandable full input/output
    states.ts        R-18: empty / loading / error / cap-reached blocks
  draw/
    timelineSvg.ts   the timeline drawing
    treeSvg.ts       the branch tree drawing (lines split at fork points)
  theme/
    tokens.css       the palette, type and spacing tokens (R-21)
    theme.css        applies tokens; motion at the fork moment
  a11y.ts            focus management, roles, live-region announcements
```

### App state (`state.ts`)

One state object drives every screen. Each screen reads the slice it needs and
renders the matching state block from `states.ts`.

```typescript
type Screen = "timeline" | "tree" | "edit" | "running" | "compare";

type Loadable<T> =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; value: T }
  | { status: "cap_reached"; reason: "session" | "overall"; limitUsd: number; value: T };

interface AppState {
  sessionId: string | null;          // null until the first writing call mints one
  screen: Screen;
  traces: Loadable<TraceSummary[]>;
  current: Loadable<Trace>;          // the loaded run/branch
  selectedStepId: string | null;
  edit: StepEdit | null;             // the one pending edit, or null
  running: Loadable<Step[]>;         // live steps as they stream in
  compare: Loadable<CompareResult>;
  demoMode: { active: boolean; reason: string; forkableStepIds: string[] };
}
```

`sessionId` starts `null`: the UI has no session until a record or fork mints
one (R-07a). `demoMode.forkableStepIds` holds the fork points the server says
have a prerecorded future, so the edit screen enables only those in demo mode.

The `cap_reached` variant of `Loadable` is how R-18's cap-reached state reaches
every screen without a separate flag: it carries the partial value plus the
reason, so the screen shows what completed and names the cap.

### The layout rule (R-11)

Every state block (`empty`, `loading`, `error`, `cap_reached`, `ready`) for a
given region renders into the same fixed-size container. `states.ts` exports one
`stateBox(region, state, readyRenderer)` that always fills the region's reserved
height. Loading is a skeleton the size of the ready content. The demo-mode
banner (R-17) has a reserved slot at the top that is empty, not absent, when
demo mode is off. Result: no state change moves anything. The no-reflow rule is
verified in the real browser by the Playwright test (R-22), which measures
element boxes across state changes; a Vitest unit test has no layout engine and
cannot measure boxes, so the layout check lives in the e2e test, not under
`tests/ui/`.

### Timeline (`screens/timeline.ts`, R-12)

A vertical list of `stepCard`s in trace order. Each card shows the kind in plain
words, the summary (per R-12's per-kind rule), tokens (or "no tokens" for a tool
step), and duration. Selecting a card expands its full `input` and `output`,
JSON-formatted and escaped. The list is a keyboard-navigable listbox (R-19): up
and down move selection, Enter opens, Escape closes.

### Branch tree (`screens/branchTree.ts` + `draw/treeSvg.ts`, R-13)

The tree is built from the `TraceSummary[]` (each summary's `parentRunId` and
`forkPointStepId` give the edges). Each branch is a column of step nodes; a
branch's line splits off its parent's line at the fork-point node. Drawing:

- A replayed step (`live: false`, `edited: false`) is drawn as a cold-blue node
  on a thin line.
- A live step (`live: true`) is drawn as a warm-amber node on a brighter line.
- The fork-point step (`edited: true`) is drawn as a filled diamond at the split,
  distinct from both.

The difference is never colour-only: each node has a shape and a text label in
its accessible name ("replayed", "live", "fork point"), so a screen reader and a
colour-blind user both get it (R-20, R-21). Selecting a branch loads its
timeline.

### Edit (`screens/edit.ts`, R-14)

For the selected step the screen shows only the fields spec 02 R-01 allows:

- `model_call`: three single edits, one active at a time:
  - **the prompt** (`input.messages`). The screen lists the messages in order,
    each with its role, and lets the user pick one to edit; the default
    selection is the last `user` message. Only the picked message's content is
    editable, in a textarea; the other messages are shown read-only for context.
    On run, the edited content replaces that one message's content and the UI
    sends the whole new `input.messages` array as the `messages` edit. The user
    never edits the array as raw text.
  - **the model** (`model`): a text field.
  - **the settings** (`settings`): a settings editor.
  Choosing one of the three clears the others so only one field changes.
- `tool_result`: one editor for `output.result`.

No edit control is shown for a `tool_call` step or a structural field. In demo
mode the step is editable only when its id is in `demoMode.forkableStepIds`;
otherwise the run action is disabled with a plain note that this step has no
prerecorded future. One button, labelled "Run forward from here", posts the fork
(R-05) and moves to the running screen. The button states its effect in words,
not an icon alone (R-21).

### Running (`screens/running.ts`, R-15)

Opens the SSE stream, posts the fork, and appends each `step` event to
`running.value` in order, under the replayed prefix. A live-region announcement
names each step as it arrives (R-20). One "Stop" button posts `/api/stop`
(R-08). On the terminal event: `done` loads the finished branch and offers
compare; `cap` switches the region to `cap_reached` and shows the demo banner
(R-17); `error` shows the error block. The reserved space holds the full
expected height so streaming steps do not push the Stop button around (R-11);
the e2e test measures the Stop button's box as steps arrive.

### Compare (`screens/compare.ts`, R-16)

Two columns, one per branch, aligned so the fork-point row lines up. The row at
`firstDiff.index` is highlighted on both sides and labelled "first difference"
in text. A footer per column shows final output, total tokens, total cost and
total duration from `compareBranches`. When `firstDiff` is `null`, the screen
says "these branches do not differ" in the reserved highlight area rather than
leaving it blank.

### API client (`api.ts`)

One typed function per endpoint plus `openStream(streamId, handlers)` wrapping
`EventSource`. All responses are typed against the server's shapes. A non-2xx
response (including 429, 404 and 503) resolves to a typed error the calling
screen turns into its `error` or `cap_reached` state; the client never throws a
raw network error at a screen.

---

## The visual system (`theme/`, Costume Contest)

The look is a mad scientist's time lab at night. It dresses a plain, readable
tool; every control still says what it does (R-21).

### Palette tokens

Defined as CSS custom properties in `tokens.css`, with a dark set (default) and
a light set (for readability and print). The past is cold blue; the new future
is warm amber. Names say the role, not the colour.

Two light-theme tokens from the first draft failed their target and are changed
here. `--future` was `#c8740a` (3.26:1 on `--bg`, 3.52:1 on `--surface`, below
4.5:1 for text) and is darkened. `--line` was too faint in both themes (1.35 to
1.52:1, below the 3:1 a meaning-carrying line needs) and is strengthened in
both. The ratios in the table are computed values; the R-23 unit test computes
every pair from `tokens.css` and enforces them.

| Token | Dark | Light | Role | Measured contrast |
|---|---|---|---|---|
| `--bg` | `#0b1020` | `#f4f6fb` | Lab background, night vs day | background reference |
| `--surface` | `#141b2e` | `#ffffff` | Cards, panels | background reference |
| `--ink` | `#e8ecf5` | `#161a24` | Primary text | dark 16.00:1 on `--bg`, 14.48:1 on `--surface`; light 16.09:1 on `--bg`, 17.39:1 on `--surface` |
| `--ink-dim` | `#9aa6c0` | `#55607a` | Secondary text | dark 7.74:1 on `--bg`, 7.01:1 on `--surface`; light 5.81:1 on `--bg`, 6.29:1 on `--surface` |
| `--past` | `#4ea3ff` | `#1f6fd6` | Replayed steps, the recorded timeline | dark 7.22:1 on `--bg`, 6.53:1 on `--surface`; light 4.51:1 on `--bg`, 4.88:1 on `--surface` |
| `--future` | `#ffb24c` | `#9a5600` | Live steps, the new branch | dark 10.57:1 on `--bg`, 9.56:1 on `--surface`; light 5.24:1 on `--bg`, 5.67:1 on `--surface` |
| `--fork` | `#c792ff` | `#7a37c4` | The fork-point marker | dark 8.10:1 on `--bg`, 7.33:1 on `--surface`; light 6.12:1 on `--bg`, 6.62:1 on `--surface` |
| `--diff` | `#ff6b7a` | `#c21f33` | First-difference highlight in compare | dark 6.88:1 on `--bg`, 6.23:1 on `--surface`; light 5.49:1 on `--bg`, 5.94:1 on `--surface` |
| `--line` | `#636f9c` | `#78849e` | Tree and timeline connector lines (meaning-carrying) | dark 3.86:1 on `--bg`, 3.49:1 on `--surface`; light 3.47:1 on `--bg`, 3.75:1 on `--surface` |
| `--focus` | `#8be9ff` | `#0b6e8a` | Keyboard focus ring (always visible) | dark 13.70:1 on `--bg`, 12.40:1 on `--surface`; light 5.38:1 on `--bg`, 5.81:1 on `--surface` |
| `--danger` | `#ff6b7a` | `#c21f33` | Error states, cap-reached | dark 6.88:1 on `--bg`, 6.23:1 on `--surface`; light 5.49:1 on `--bg`, 5.94:1 on `--surface` |

Text pairs meet 4.5:1. `--line` and `--focus` carry meaning (the tree lines and
the focus ring), so they are held to the 3:1 graphical-object threshold, which
their values clear in both themes against both backgrounds. The contrast figures
are a build-time target the R-23 unit test checks; confirming them against
assistive technology is manual review, outside this spec's automated tests.

### Type

One typeface for UI text (system UI stack for speed and legibility) and one
monospace (system mono) for step input/output and JSON. Scale: `--step-0` body
`16px`, `--step--1` `13px` for metadata (tokens, time), `--step-1` `20px` and
`--step-2` `26px` for headings. Line length in the step detail is capped so JSON
stays readable.

### The timeline drawing (`draw/timelineSvg.ts`)

A single vertical spine in `--line`. Each step is a node on the spine, coloured
by role (`--past` for replayed, `--future` for live, `--fork` diamond for the
fork point). Node shape doubles as the role signal: circle for a model call,
square for a tool call, rounded square for a tool result. The spine never moves
when a node expands; the detail opens to the side.

### The branch tree drawing (`draw/treeSvg.ts`)

Branches drawn as lines that split from the parent at the fork point, styled
like cracks in glass: the split is a short jagged segment, not a smooth curve, in
`--fork`. The parent line stays cold `--past`; the new branch line warms to
`--future` from the fork point on. Lines are 2px; the jag is three segments so it
reads as a crack without looking noisy. The whole tree is one SVG with a
`role="tree"` wrapper and each node a `role="treeitem"` for R-20.

### Motion at the fork moment

One short, purposeful animation, and only there (the rest of the UI does not
move, honouring R-11's no-reflow rule). When a fork starts, the new branch line
draws itself from the fork point outward over ~450ms with a brief glow in
`--future`, and a single soft flash in `--fork` marks the split. Motion respects
`prefers-reduced-motion`: when set, the branch appears without the draw-on and
without the flash. No sound (sound is a stretch item in `product.md`).

---

## The end-to-end test (`tests/e2e/`, R-22)

```
tests/e2e/
  lab.spec.ts            the one full-loop test
  playwright.config.ts   starts the server with modelMode "fake", one project
```

The test starts the server configured with the fake model, then drives a real
browser through:

1. Record a run with a task string; assert the timeline shows the recorded steps
   (kinds, summaries, tokens, time).
2. Select a step and rewind to it; assert the edit screen shows the editable
   fields for that step's kind and nothing more, and that editing the prompt
   edits one chosen message's content (the last user message by default), not
   the whole array.
3. Edit the one allowed field; assert only that field changed.
4. Run forward; assert live steps arrive on the running screen and the Stop
   control is present, then the branch completes.
5. Compare the new branch with its parent; assert the first difference is
   highlighted and both costs are shown.

The test also enforces the no-reflow rule (R-11): at each state change (empty to
loading to ready, and when live steps arrive, and when a cap is reached) it reads
the bounding boxes of the banner slot, the Stop button and each state region
before and after, and fails on any movement. Playwright measures real layout, so
this check belongs here, not in a Vitest unit test.

The test uses the fake model, so it is deterministic and needs no network and no
API key. It also runs one keyboard-only pass of the loop (Tab/Enter/Escape, no
pointer) to exercise R-19, and checks the accessible names on the step nodes and
the compare highlight for R-20.

**Browser install is a one-time setup step done outside the build.** The test
assumes `npx playwright install` has already been run on the machine. No build
task installs browsers. `playwright.config.ts` names the browser project but does
not download it.

---

## The palette contrast test (`tests/ui/contrast.test.ts`, R-23)

A unit test parses the custom-property values out of `tokens.css` for both the
dark and the light blocks, computes the WCAG contrast ratio for every token the
UI relies on against both backgrounds (every token against `--bg` and against
`--surface`), and asserts each text token's pairs are at least 4.5:1 and the
`--line` and `--focus` pairs are at least 3:1. The test owns the measured figures
in the palette table, so a later token edit that breaks contrast fails the build.
The test reads `tokens.css` directly, so it needs no browser and no layout engine.

---

## package.json changes

Add dev dependencies and scripts; no runtime dependency, no framework.

```jsonc
"devDependencies": {
  // existing: @types/node, fast-check, tsx, typescript, vitest
  "@playwright/test": "1.48.2",
  "vite": "5.4.21"
}
"scripts": {
  // existing: build, test, typecheck
  "dev": "vite",                       // UI dev server, proxies /api to the serve port
  "build:ui": "vite build",            // UI production bundle
  "serve": "tsx src/server/main.ts",   // run the server (serves built UI from dist/ui)
  "test:e2e": "playwright test"        // the one browser test (browsers pre-installed)
}
```

`serve` runs `src/server/main.ts`, the entry that reads `PORT` (default `3000`)
and `MODEL_MODE` (`fake` default, `demo` allowed), serves `dist/ui`, binds
`127.0.0.1`, and stops cleanly on a signal. See "Run it" above. `dev`'s vite
config adds a `server.proxy` for `/api` to the serve port so the dev UI reaches
the running server.

---

## Files to create

```
src/server/main.ts
src/server/server.ts
src/server/sessions.ts
src/server/ledger.ts
src/server/routes.ts
src/server/config.ts
src/server/rateLimit.ts
src/server/static.ts
src/agent/fake-model.ts
src/ui/index.html
src/ui/main.ts
src/ui/api.ts
src/ui/state.ts
src/ui/screens/timeline.ts
src/ui/screens/branchTree.ts
src/ui/screens/edit.ts
src/ui/screens/running.ts
src/ui/screens/compare.ts
src/ui/components/banner.ts
src/ui/components/stepCard.ts
src/ui/components/states.ts
src/ui/draw/timelineSvg.ts
src/ui/draw/treeSvg.ts
src/ui/theme/tokens.css
src/ui/theme/theme.css
src/ui/a11y.ts
demo/root-run.json
demo/prerecorded-future.json
demo/README.md
tests/e2e/lab.spec.ts
tests/e2e/playwright.config.ts
tests/server/main.test.ts
tests/server/routes.test.ts
tests/server/sessions.test.ts
tests/server/ledger.test.ts
tests/server/static.test.ts
tests/compare/fork-onstep.test.ts
tests/compare/fork-stop.test.ts
tests/ui/state.test.ts
tests/ui/contrast.test.ts
```

## Files to modify

```
src/compare/fork.ts   add onStep and signal to ForkOptions; forward live steps to onStep; catch StopRequested and save a partial branch (C-03)
src/recorder/recorder.ts  honour an abort signal on the record path (C-03)
src/server/caps.ts    add one zero-cost "fake" entry to MODEL_PRICES
package.json          add vite 5.4.21 and @playwright/test; add dev/build:ui/serve/test:e2e scripts
vite.config.ts        new: UI root src/ui, build out to dist/ui, server.proxy /api to the serve port  (listed here as it is config, not app code)
```

---

## Invariants carried forward from specs 01 and 02

- The live phase runs outside `withNetworkGuard`; the prefix replay runs inside
  it. The server does not change this.
- One session ledger per session and one global ledger for the server, composed
  so both caps are checked before each live call and both are charged after; a
  cap hit saves the partial branch.
- `saveTrace` scrubs before writing. No key reaches a file, a log, or a response.
- Step ids stay `<runId>-<index>`. The server never mints step ids.
- `compareBranches` aligns by position from index 0 and is symmetric; the
  compare screen relies on both.
- `onStep` is the streaming hook; C-03 adds it to `forkTrace` alongside `signal`
  so the server streams and stops through one surface.
