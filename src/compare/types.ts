// src/compare/types.ts
// Edit and result types for the fork operation.

import type { Message, ModelSettings } from "../trace/types.js";
import type { Trace } from "../trace/types.js";

// Describes the one change a user makes at the fork point.
// Only the fields listed in the spec are representable; attempting to build an
// edit for a tool_call step or a structural field is a TypeScript compile error.
export type StepEdit =
  | { kind: "model_call"; field: "messages"; value: Message[] }
  | { kind: "model_call"; field: "model"; value: string }
  | { kind: "model_call"; field: "settings"; value: ModelSettings }
  | { kind: "tool_result"; field: "result"; value: unknown };

export type ForkEdit = {
  forkPointStepId: string;
  edit: StepEdit;
};

export type ForkSuccess = {
  status: "ok";
  branch: Trace;
};

export type ForkCapHit = {
  status: "cap_hit";
  reason: "session" | "overall";
  limitUsd: number;
  partialBranch: Trace;
};

export type ForkResult = ForkSuccess | ForkCapHit;
