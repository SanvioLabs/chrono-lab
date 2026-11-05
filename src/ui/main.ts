// src/ui/main.ts
// Boot: fetch state, wire the screens, route state (Task 10).
//
// One AppState drives every screen. main.ts owns the state, implements the
// UiCallbacks the screens call, talks to the server through api.ts, and
// re-renders on every change. Every region (banner, timeline, tree, edit,
// running, compare) is laid out from the start, each a fixed-size host that
// carries its data-region, so no state change moves anything (R-11). All trace
// content reaches the DOM through textContent (a11y.ts helpers and the step
// card), never innerHTML, so a crafted string is shown, not run (R-10).
//
// On boot the app reads GET /api/mode. In demo mode it turns the banner on with
// its reason, records which fork points have a prerecorded future, and opens
// the prerecorded root run, so the banner shows from first load and the edit
// screen offers only those fork points (R-14, R-17).

import "./theme/tokens.css";
import "./theme/theme.css";

import type { Trace, Step } from "../trace/types.js";
import type { StepEdit } from "../compare/types.js";
import type { CompareResult } from "../compare/compare.js";

import {
  initialState,
  toLoading,
  toReady,
  toError,
  toCapReached,
  appendRunningStep,
  type AppState,
} from "./state.js";
import { renderBanner } from "./components/banner.js";
import { renderTimeline } from "./screens/timeline.js";
import { renderBranchTree } from "./screens/branchTree.js";
import { renderEdit } from "./screens/edit.js";
import { renderRunning } from "./screens/running.js";
import { renderCompare } from "./screens/compare.js";
import { el, announce, stepAccessibleName } from "./a11y.js";
import { replayedPrefix } from "./prefix.js";
import { resolveEditStep, splitBranch } from "./editTarget.js";
import type { UiCallbacks } from "./controller.js";
import * as api from "./api.js";

// --- the app shell ---

const app = document.getElementById("app");
if (!app) throw new Error("missing #app root");

const state: AppState = initialState();

// The traces we have loaded in full, by runId, so the branch tree can draw
// sibling branches it already has, and compare can read both branches.
const tracesById = new Map<string, Trace>();

// The runId of the currently loaded trace, and of its parent (for compare).
let currentRunId: string | null = null;
let parentRunIdForCompare: string | null = null;

// The active stream and fork ids while a fork runs (R-08, R-10a).
let activeForkId: string | null = null;
let activeStream: api.StreamHandle | null = null;

// The step id the edit region last rendered for, so focus moves into the editor
// only when the selected step changed, not on an incidental re-render (R-19,
// Bug 1). An incidental re-render (a streamed live step, a trace-list refresh)
// leaves the user's focus where they put it.
let lastEditStepId: string | null = null;

// The kept partial branch when a spend cap stops a fork (R-18). It is read from
// the saved branch, split into the replayed prefix and the live steps, so the
// running region shows exactly what was saved rather than relying on the live
// steps the stream happened to deliver. Cleared when a new record or fork
// starts.
let capPartialBranch: { prefix: Step[]; live: Step[] } | null = null;

// The finished branch split into its replayed prefix and live steps, read from
// the saved branch the same way the cap path reads its partial branch. The
// running region draws its prefix from this once the fork is done: loadTrace
// clears state.selectedStepId when the new branch loads, so the prefix cannot
// be re-derived from the selection, and a full re-render (from refreshTraceList)
// would otherwise drop the prefix to []. Reading the prefix from the saved
// branch keeps the replayed steps above the live log after the run finishes.
// Cleared when a new record or fork starts.
let donePartialBranch: { prefix: Step[]; live: Step[] } | null = null;

// The callbacks the screens call. Each mutates state and re-renders.
const callbacks: UiCallbacks = {
  record,
  selectStep,
  closeDetail,
  setEdit,
  runForward,
  stop,
  compareWithParent,
  openRun,
};

// --- actions ---

async function record(task: string): Promise<void> {
  state.current = toLoading(state.current);
  state.running = { status: "empty" };
  state.compare = { status: "empty" };
  state.selectedStepId = null;
  state.edit = null;
  capPartialBranch = null;
  donePartialBranch = null;
  render();

  const streamId = api.newId();
  // Open the stream first so the server can bind it to the minted session. The
  // timeline loads from the saved trace on done, so record does not need to
  // append streamed steps.
  const handle = api.openStream(streamId, {
    onStep: () => {},
    onDone: () => {},
    onCap: () => {},
    onError: () => {},
  });

  // Wait for the stream to open so the server has registered it before the
  // record POST mints the session and claims it.
  await handle.ready;
  const res = await api.record(task, streamId);
  handle.close();

  if (!res.ok) {
    state.current = toError(res.message);
    render();
    return;
  }
  await loadTrace(res.runId, { asCurrent: true });
  await refreshTraceList();
}

function selectStep(stepId: string): void {
  state.selectedStepId = stepId;
  render();
}

function closeDetail(): void {
  state.selectedStepId = null;
  state.edit = null;
  render();
}

function setEdit(edit: StepEdit | null): void {
  // No full re-render: the edit screen manages its own controls, and a
  // re-render would steal focus from the textarea the user is typing in.
  state.edit = edit;
}

async function runForward(): Promise<void> {
  if (
    currentRunId === null ||
    state.selectedStepId === null ||
    state.edit === null
  ) {
    return;
  }

  const parentRunId = currentRunId;
  const forkPointStepId = state.selectedStepId;
  const edit = state.edit;

  // The replayed prefix is every step strictly before the fork point. The
  // fork-point step itself is re-run live, so it belongs to the live steps,
  // not the prefix (see src/compare/fork.ts, which slices the fork-point step
  // off the replayed prefix and emits it as the first live step).
  const prefix = currentPrefix(forkPointStepId);

  state.running = { status: "ready", value: [] };
  capPartialBranch = null;
  donePartialBranch = null;
  render();

  const streamId = api.newId();
  const forkId = api.newId();
  activeForkId = forkId;

  const handle = api.openStream(streamId, {
    onStep: (step: Step) => {
      state.running = appendRunningStep(state.running, step);
      announce(`Live step: ${stepAccessibleName(step)}`);
      renderRunningRegion(prefix, false);
    },
    onDone: async (runId: string) => {
      activeForkId = null;
      activeStream = null;
      parentRunIdForCompare = parentRunId;
      // Load the saved branch, then read its replayed prefix and live steps
      // from the branch itself (the same approach as the cap path): loadTrace
      // clears state.selectedStepId, so runningPrefix can no longer derive the
      // prefix from the selection, and the next full render would drop it to
      // []. donePartialBranch holds the split read from the saved branch, so
      // the replayed prefix stays above the live log once the fork is done.
      await loadTrace(runId, { asCurrent: true, forkedFrom: parentRunId });
      const branch = tracesById.get(runId);
      donePartialBranch = branch ? splitBranch(branch) : { prefix, live: [] };
      renderRunningRegion(donePartialBranch.prefix, true);
      await refreshTraceList();
    },
    onCap: async (reason, limitUsd, runId) => {
      activeForkId = null;
      activeStream = null;
      parentRunIdForCompare = parentRunId;
      // Load the saved partial branch first, then read its kept steps from the
      // branch itself (R-18): the prefix is every step before the first live
      // step, the live steps are the rest. This shows exactly what was saved,
      // not whatever the stream delivered before the cap landed.
      await loadTrace(runId, { asCurrent: true, forkedFrom: parentRunId });
      const branch = tracesById.get(runId);
      const live = branch ? splitBranch(branch).live : capStreamSteps();
      capPartialBranch = branch
        ? splitBranch(branch)
        : { prefix, live };
      state.running = toCapReached(live, reason, limitUsd);
      // A cap fell back to demo mode: show the banner with its reason (R-17).
      state.demoMode = {
        active: true,
        reason: `The ${reason} spend cap of $${limitUsd} was reached. Showing what completed.`,
        forkableStepIds: state.demoMode.forkableStepIds,
      };
      render();
      await refreshTraceList();
    },
    onError: (message) => {
      activeForkId = null;
      activeStream = null;
      state.running = toError(message);
      render();
    },
  });
  activeStream = handle;

  // Open the stream before posting the fork so live steps route to it (R-10a).
  await handle.ready;

  const res = await api.fork({
    parentRunId,
    forkPointStepId,
    edit,
    streamId,
    forkId,
  });

  if (!res.ok) {
    handle.close();
    activeStream = null;
    activeForkId = null;
    state.running = toError(res.message);
    render();
    return;
  }

  // On a cap_hit the JSON response carries it too; the stream's onCap already
  // handled the UI, but guard in case the stream dropped. Load the saved branch
  // and show its kept partial branch the same way the stream path does.
  if (res.status === "cap_hit") {
    parentRunIdForCompare = parentRunId;
    await loadTrace(res.runId, { asCurrent: true, forkedFrom: parentRunId });
    const branch = tracesById.get(res.runId);
    const live = branch ? splitBranch(branch).live : capStreamSteps();
    capPartialBranch = branch ? splitBranch(branch) : { prefix, live };
    state.running = toCapReached(live, res.reason, res.limitUsd);
    state.demoMode = {
      active: true,
      reason: `The ${res.reason} spend cap of $${res.limitUsd} was reached. Showing what completed.`,
      forkableStepIds: state.demoMode.forkableStepIds,
    };
    render();
  }
  // demoMode flagged in the response (R-17): show the banner.
  if (res.status === "ok" && res.demoMode) {
    state.demoMode = {
      active: true,
      reason: "Live runs are unavailable, showing a prerecorded future.",
      forkableStepIds: state.demoMode.forkableStepIds,
    };
    render();
  }
}

async function stop(): Promise<void> {
  if (activeForkId === null) return;
  await api.stop(activeForkId);
  // The server aborts the fork; its stream fires `done` with the partial
  // branch, which loads it and offers compare.
}

async function compareWithParent(): Promise<void> {
  if (currentRunId === null || parentRunIdForCompare === null) return;
  state.compare = toLoading(state.compare);
  state.screen = "compare";
  render();

  const res = await api.compare(parentRunIdForCompare, currentRunId);
  if (!res.ok) {
    state.compare = toError(res.message);
    render();
    return;
  }
  const result: CompareResult = {
    firstDiff: res.firstDiff,
    a: res.a,
    b: res.b,
  };
  state.compare = toReady(result);
  render();
}

async function openRun(runId: string): Promise<void> {
  await loadTrace(runId, { asCurrent: true });
}

// --- loading ---

async function loadTrace(
  runId: string,
  opts: { asCurrent?: boolean; forkedFrom?: string } = {}
): Promise<void> {
  const res = await api.getTrace(runId);
  if (!res.ok) {
    state.current = toError(res.message);
    render();
    return;
  }
  const trace = res.trace;
  tracesById.set(runId, trace);
  if (opts.asCurrent) {
    currentRunId = runId;
    state.current = toReady(trace);
    state.selectedStepId = null;
    if (opts.forkedFrom) {
      parentRunIdForCompare = opts.forkedFrom;
    } else if (trace.parentRunId !== undefined) {
      parentRunIdForCompare = trace.parentRunId;
    }
    // Load the parent too, so the tree and compare have its steps.
    if (parentRunIdForCompare && !tracesById.has(parentRunIdForCompare)) {
      const p = await api.getTrace(parentRunIdForCompare);
      if (p.ok) tracesById.set(parentRunIdForCompare, p.trace);
    }
  }
  render();
}

async function refreshTraceList(): Promise<void> {
  const res = await api.listTraces();
  if (res.ok) {
    state.traces = toReady(res.traces);
  }
  render();
}

// Reads GET /api/mode once on boot. In demo mode it turns the banner on with a
// plain reason and records the fork points that have a prerecorded future, so
// the banner shows from first load and the edit screen offers only those fork
// points (R-14, R-17). It returns whether the app is in demo mode so boot can
// open the prerecorded root run next. In fake mode it leaves demo mode off, so
// the banner slot stays reserved but empty.
async function loadMode(): Promise<boolean> {
  const res = await api.getMode();
  if (!res.ok) return false;
  if (res.modelMode === "demo") {
    state.demoMode = {
      active: true,
      reason:
        "Live runs are unavailable, showing prerecorded runs and futures.",
      forkableStepIds: res.forkableStepIds,
    };
    render();
    return true;
  }
  return false;
}

// In demo mode there is no record step, so the app opens the prerecorded root
// run (the one with no parentRunId) on boot. That draws its timeline and tree,
// so the user can select a step: a fork point with a prerecorded future offers
// "Run forward from here", and one without shows the disabled note (R-14,
// R-17). Reads the already-loaded trace list, so it runs after refreshTraceList.
async function openRootDemoRun(): Promise<void> {
  if (state.traces.status !== "ready") return;
  const root = state.traces.value.find((s) => s.parentRunId === undefined);
  if (root) {
    await loadTrace(root.runId, { asCurrent: true });
  }
}

// The replayed prefix from the currently loaded trace: every step strictly
// before the fork point. The pure logic lives in prefix.ts (and is unit
// tested there); this just reads the current trace's steps and delegates, so
// the prefix is the same while the fork runs and when it is done.
function currentPrefix(forkPointStepId: string): Step[] {
  const cur =
    state.current.status === "ready" ? state.current.value : undefined;
  if (!cur) return [];
  return replayedPrefix(cur.steps, forkPointStepId);
}

// The live steps the stream delivered, used only as a fallback when the saved
// branch could not be loaded for the cap partial branch.
function capStreamSteps(): Step[] {
  return state.running.status === "ready" || state.running.status === "cap_reached"
    ? state.running.value
    : [];
}

// --- rendering ---

// Fixed region hosts, created once so their boxes are stable. Each carries its
// data-region, so the e2e test finds exactly one element per region and can
// measure its box across state changes (R-11).
let bannerHost: HTMLElement;
let timelineHost: HTMLElement;
let treeHost: HTMLElement;
let editHost: HTMLElement;
let runningHost: HTMLElement;
let compareHost: HTMLElement;

function regionHost(region: string, extraClass: string): HTMLElement {
  const host = el("div", `region-host ${extraClass}`);
  host.dataset["region"] = region;
  return host;
}

function buildShell(): void {
  app!.replaceChildren();

  const header = el("header", "app-header");
  header.appendChild(el("h1", "app-title", "Chrono-Lab"));
  header.appendChild(
    el(
      "p",
      "app-tagline",
      "A time machine for AI agents: rewind a run, change one step, compare the futures."
    )
  );
  app!.appendChild(header);

  // The banner slot (reserved, R-17). role="status" so a screen reader hears it
  // when demo mode turns on; present but empty otherwise.
  bannerHost = regionHost("banner", "region-host--banner");
  bannerHost.setAttribute("role", "status");
  bannerHost.setAttribute("aria-live", "polite");
  app!.appendChild(bannerHost);

  // The record control.
  const recordRow = el("div", "record-row");
  const taskBox = document.createElement("input");
  taskBox.type = "text";
  taskBox.className = "task-input";
  taskBox.id = "task-input";
  taskBox.setAttribute("aria-label", "task for the run");
  taskBox.placeholder = "What should the agent do?";
  const recordBtn = document.createElement("button");
  recordBtn.type = "button";
  recordBtn.className = "btn btn--record";
  recordBtn.textContent = "Record run";
  recordBtn.addEventListener("click", () => {
    void record(taskBox.value);
  });
  recordRow.appendChild(taskBox);
  recordRow.appendChild(recordBtn);
  app!.appendChild(recordRow);

  // The region hosts, each reserving its box from the start (R-11).
  const grid = el("div", "region-grid");
  timelineHost = regionHost("timeline", "region-host--timeline");
  treeHost = regionHost("tree", "region-host--tree");
  editHost = regionHost("edit", "region-host--edit");
  runningHost = regionHost("running", "region-host--running");
  compareHost = regionHost("compare", "region-host--compare");
  grid.appendChild(timelineHost);
  grid.appendChild(treeHost);
  grid.appendChild(editHost);
  grid.appendChild(runningHost);
  grid.appendChild(compareHost);
  app!.appendChild(grid);
}

function render(): void {
  // Banner (the inner content; the host keeps the reserved box).
  bannerHost.replaceChildren(renderBanner(state.demoMode));

  // Timeline region.
  renderTimelineRegion();

  // Tree region.
  if (state.current.status === "ready" && state.traces.status === "ready") {
    treeHost.replaceChildren(
      renderBranchTree(
        state.current.value,
        state.traces.value,
        tracesById,
        callbacks
      )
    );
  } else {
    treeHost.replaceChildren(
      stateBlock("tree", "Record a run to see its branch tree.")
    );
  }

  // Edit region.
  renderEditRegion();

  // Running region.
  const prefix = runningPrefix();
  const finished =
    state.running.status === "ready" &&
    activeForkId === null &&
    state.running.value.length > 0;
  renderRunningRegion(prefix, finished);

  // Compare region.
  renderCompareRegion();
}

// The replayed prefix the running region draws above the live log. The prefix
// is read from the saved branch once a run has one, so it survives the full
// re-render that follows loading the finished branch (which clears the
// selection). In order of precedence:
//   - cap_reached: the prefix of the saved partial branch (R-18).
//   - a finished fork: the prefix of the saved finished branch (donePartial-
//     Branch), so the replayed steps stay above the live log after the run
//     ends, not dropped to [] when the selection is cleared.
//   - otherwise: the prefix of the selected fork point in the current trace,
//     used while the fork is still streaming (the selection is still set).
function runningPrefix(): Step[] {
  if (state.running.status === "cap_reached" && capPartialBranch) {
    return capPartialBranch.prefix;
  }
  if (donePartialBranch) {
    return donePartialBranch.prefix;
  }
  return state.selectedStepId !== null
    ? currentPrefix(state.selectedStepId)
    : [];
}

function renderTimelineRegion(): void {
  switch (state.current.status) {
    case "ready":
      timelineHost.replaceChildren(
        renderTimeline(state.current.value, state.selectedStepId, callbacks)
      );
      break;
    case "loading":
      timelineHost.replaceChildren(skeleton("timeline"));
      break;
    case "error":
      timelineHost.replaceChildren(errorBlock(state.current.message));
      break;
    default:
      timelineHost.replaceChildren(
        stateBlock("timeline", "Record a run to see its timeline.")
      );
  }
}

function renderEditRegion(): void {
  const trace =
    state.current.status === "ready" ? state.current.value : undefined;
  const step = resolveEditStep(trace, state.selectedStepId);
  if (step) {
    // Move focus into the editor only when the selected step changed, so
    // opening a step lands the keyboard there (R-19) while an incidental
    // re-render leaves focus where the user put it (Bug 1).
    const focusOnMount = step.id !== lastEditStepId;
    lastEditStepId = step.id;
    editHost.replaceChildren(
      renderEdit(step, state.demoMode, callbacks, focusOnMount)
    );
    return;
  }
  lastEditStepId = null;
  editHost.replaceChildren(
    stateBlock("edit", "Select a step to change one field.")
  );
}

function renderRunningRegion(prefix: Step[], finished: boolean): void {
  switch (state.running.status) {
    case "empty":
      runningHost.replaceChildren(
        stateBlock("running", "Run forward from a step to see live steps.")
      );
      break;
    case "error":
      runningHost.replaceChildren(errorBlock(state.running.message));
      break;
    case "cap_reached":
      // The run stopped at a cap: keep the partial branch and name the cap in
      // the running region itself (R-18). finished=true so the control row
      // offers compare, since the partial branch is kept and comparable. The
      // prefix and live steps come from the saved branch (see runningPrefix and
      // onCap), so the kept branch is shown exactly as saved.
      runningHost.replaceChildren(
        renderRunning(prefix, state.running.value, true, callbacks, {
          reason: state.running.reason,
          limitUsd: state.running.limitUsd,
        })
      );
      break;
    case "ready":
      runningHost.replaceChildren(
        renderRunning(prefix, state.running.value, finished, callbacks)
      );
      break;
    default:
      runningHost.replaceChildren(
        stateBlock("running", "Run forward from a step to see live steps.")
      );
  }
}

function renderCompareRegion(): void {
  if (state.compare.status === "ready") {
    const a = parentRunIdForCompare
      ? tracesById.get(parentRunIdForCompare)
      : undefined;
    const b = currentRunId ? tracesById.get(currentRunId) : undefined;
    if (a && b) {
      compareHost.replaceChildren(renderCompare(a, b, state.compare.value));
      return;
    }
  }
  if (state.compare.status === "loading") {
    compareHost.replaceChildren(skeleton("compare"));
    return;
  }
  if (state.compare.status === "error") {
    compareHost.replaceChildren(errorBlock(state.compare.message));
    return;
  }
  compareHost.replaceChildren(
    stateBlock("compare", "Run forward, then compare the two futures.")
  );
}

// --- small state blocks (kept here so a region's inner content never sets a
// second data-region; only the host carries it) ---

function stateBlock(region: string, text: string): HTMLElement {
  const box = el("div", `state-box state-box--${region}`);
  box.dataset["state"] = "empty";
  box.appendChild(el("p", "state-text", text));
  return box;
}

function skeleton(region: string): HTMLElement {
  const box = el("div", `state-box state-box--${region}`);
  box.dataset["state"] = "loading";
  const sk = el("div", "skeleton");
  sk.setAttribute("aria-busy", "true");
  sk.setAttribute("aria-label", "Loading…");
  box.appendChild(sk);
  return box;
}

function errorBlock(message: string): HTMLElement {
  const box = el("div", "state-box state-box--error");
  box.dataset["state"] = "error";
  const p = el("p", "state-error-text", message);
  p.setAttribute("role", "alert");
  box.appendChild(p);
  return box;
}

// --- boot ---

buildShell();
render();
// Read the mode, load the trace list, and in demo mode open the prerecorded
// root run so its timeline and tree are on screen from first load.
void (async () => {
  const demo = await loadMode();
  await refreshTraceList();
  if (demo) await openRootDemoRun();
})();
