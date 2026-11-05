// src/ui/controller.ts
// The callbacks the screens use to drive the app. main.ts implements these; the
// screens stay pure render functions that call back on a user action. Keeping
// the interface here avoids a circular import between main.ts and the screens.

import type { StepEdit } from "../compare/types.js";

export interface UiCallbacks {
  // Record a run with the given task string.
  record(task: string): void;
  // Select a step in the loaded trace (opens the edit region for it).
  selectStep(stepId: string): void;
  // Close the open step detail / edit region.
  closeDetail(): void;
  // Stage the one pending edit for the selected step.
  setEdit(edit: StepEdit | null): void;
  // Run forward from the selected fork point with the staged edit.
  runForward(): void;
  // Stop the running fork.
  stop(): void;
  // Compare the loaded branch with its parent.
  compareWithParent(): void;
  // Load a run or branch by id (selecting a branch in the tree).
  openRun(runId: string): void;
}
