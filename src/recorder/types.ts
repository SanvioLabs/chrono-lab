// src/recorder/types.ts
// Injectable interfaces for the recorder.

import type { ModelCallInput, ModelCallOutput } from "../trace/types.js";

// Adapts a model call. Injected into Recorder so replay can replace it.
export type ModelAdapter = (
  input: ModelCallInput
) => Promise<ModelCallOutput>;

// Maps a tool name to its implementation.
// The tool receives its arguments as a plain object and returns any value.
export type ToolRegistry = Record<
  string,
  (args: Record<string, unknown>) => Promise<unknown>
>;
