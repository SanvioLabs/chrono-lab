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
      await loadTrace(runId, { asCurrent: true, forkedFrom: parentRunId });
      renderRunningRegion(prefix, true);
      await refreshTraceList();
    },
    onCap: (reason, limitUsd, runId) => {
      activeForkId = null;
      activeStream = null;
      const steps =
        state.running.status === "ready" ? state.running.value : [];
      state.running = toCapReached(steps, reason, limitUsd);
      // A cap fell back to demo mode: show the banner with its reason (R-17).
      state.demoMode = {
        active: true,
        reason: `The ${reason} spend cap of $${limitUsd} was reached. Showing what completed.`,
        forkableStepIds: state.demoMode.forkableStepIds,
      };
      parentRunIdForCompare = parentRunId;
      void loadTrace(runId, { asCurrent: true, forkedFrom: parentRunId });
      render();
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
  // handled the UI, but guard in case the stream dropped.
  if (res.status === "cap_hit") {
    const steps = state.running.status === "ready" ? state.running.value : [];
    state.running = toCapReached(steps, res.reason, res.limitUsd);
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
  const prefix =
    state.selectedStepId !== null ? currentPrefix(state.selectedStepId) : [];
  const finished =
    state.running.status === "ready" &&
    activeForkId === null &&
    state.running.value.length > 0;
  renderRunningRegion(prefix, finished);

  // Compare region.
  renderCompareRegion();
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
  if (state.current.status === "ready" && state.selectedStepId !== null) {
    const step = state.current.value.steps.find(
      (s) => s.id === state.selectedStepId
    );
    if (step) {
      editHost.replaceChildren(renderEdit(step, state.demoMode, callbacks));
      return;
    }
  }
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
      runningHost.replaceChildren(
        renderRunning(prefix, state.running.value, true, callbacks)
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
void refreshTraceList();
