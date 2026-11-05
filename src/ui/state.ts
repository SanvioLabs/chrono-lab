// src/ui/state.ts
// One app state object and the transitions between states (Task 9).
//
// Every screen reads the slice it needs from one AppState and renders the
// matching Loadable block. The Loadable union covers empty, loading, error,
// ready and cap_reached; the cap_reached variant carries the partial value plus
// the cap reason, so R-18's cap-reached state reaches every screen without a
// separate flag. sessionId starts null: the UI has no session until a record or
// fork mints one (R-07a). demoMode.forkableStepIds holds the fork points the
// server says have a prerecorded future, so the edit screen enables only those
// in demo mode.

import type { Trace, Step } from "../trace/types.js";
import type { StepEdit } from "../compare/types.js";
import type { CompareResult } from "../compare/compare.js";
import type { TraceSummary } from "../server/routes.js";

export type Screen = "timeline" | "tree" | "edit" | "running" | "compare";

export type Loadable<T> =
  | { status: "empty" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; value: T }
  | {
      status: "cap_reached";
      reason: "session" | "overall";
      limitUsd: number;
      value: T;
    };

export interface DemoMode {
  active: boolean;
  reason: string;
  // The fork points the server says have a prerecorded future.
  forkableStepIds: string[];
}

export interface AppState {
  // null until the first writing call mints one (R-07a).
  sessionId: string | null;
  screen: Screen;
  traces: Loadable<TraceSummary[]>;
  // The loaded run or branch.
  current: Loadable<Trace>;
  selectedStepId: string | null;
  // The one pending edit, or null.
  edit: StepEdit | null;
  // Live steps as they stream in.
  running: Loadable<Step[]>;
  compare: Loadable<CompareResult>;
  demoMode: DemoMode;
}

// The starting state before anything loads: no session, the timeline screen,
// every region empty, demo mode off.
export function initialState(): AppState {
  return {
    sessionId: null,
    screen: "timeline",
    traces: { status: "empty" },
    current: { status: "empty" },
    selectedStepId: null,
    edit: null,
    running: { status: "empty" },
    compare: { status: "empty" },
    demoMode: { active: false, reason: "", forkableStepIds: [] },
  };
}

// Moves a Loadable region to loading (the record and compare flows start here).
// The prior state is ignored: loading is the same block whatever preceded it,
// which is what keeps the region's box a fixed size across the transition.
export function toLoading<T>(_current: Loadable<T>): Loadable<T> {
  return { status: "loading" };
}

// Moves a Loadable region to ready with its value (record -> ready;
// fork -> ready; compare -> ready).
export function toReady<T>(value: T): Loadable<T> {
  return { status: "ready", value };
}

// Moves a Loadable region to error with a plain message.
export function toError<T>(message: string): Loadable<T> {
  return { status: "error", message };
}

// Moves a Loadable region to cap_reached, carrying the partial value and the
// cap reason (fork -> cap_reached). The partial value is what completed before
// the cap, so the screen shows it and names the cap.
export function toCapReached<T>(
  value: T,
  reason: "session" | "overall",
  limitUsd: number
): Loadable<T> {
  return { status: "cap_reached", reason, limitUsd, value };
}

// The running region starts a fork at loading, then appends each live step as
// it streams in. appendRunningStep adds one step to a running Loadable, moving
// it to ready (with the growing step list) on the first step. Steps accumulate
// in arrival order; nothing already streamed is rewritten.
export function appendRunningStep(
  running: Loadable<Step[]>,
  step: Step
): Loadable<Step[]> {
  const prior =
    running.status === "ready" || running.status === "cap_reached"
      ? running.value
      : [];
  return { status: "ready", value: [...prior, step] };
}
