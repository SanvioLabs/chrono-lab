// src/trace/types.ts
// The trace schema. This is the contract all other modules read and write.

export const TRACE_VERSION = "1.0.0";

// Step kinds
export type StepKind = "model_call" | "tool_call" | "tool_result";

// Inference settings passed to a model call.
export interface ModelSettings {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  // forward-compat: preserve unknown settings
  [key: string]: unknown;
}

// Token counts attached to a model call.
export interface TokenCounts {
  input: number;
  output: number;
}

// A single message in the prompt or response.
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  // present on role:"tool"
  toolCallId?: string;
}

// Per-kind input/output payloads

export interface ModelCallInput {
  messages: Message[];
  model: string;
  settings: ModelSettings;
}

export interface ModelCallOutput {
  // the assistant turn
  message: Message;
  // "stop" | "tool_calls" | "length" | etc.
  finishReason: string;
  // present when finishReason === "tool_calls"
  toolCalls?: ToolCallSpec[];
}

export interface ToolCallSpec {
  // opaque id the model assigned
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallInput {
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
}

// tool_call output is null until the result arrives; the result step carries it
export type ToolCallOutput = null;

export interface ToolResultInput {
  // references the originating tool_call step
  toolCallId: string;
}

export interface ToolResultOutput {
  // the value returned by the tool
  result: unknown;
  isError: boolean;
}

// Step: discriminated union where kind determines which input/output shapes are valid.
export type Step = ModelCallStep | ToolCallStep | ToolResultStep;

interface BaseStep {
  id: string;
  runId: string;
  parentId: string | null;
  durationMs: number;
  // "main" for the initial run; branch id after a fork
  branch: string;
  forkPointId: string | null;
}

export interface ModelCallStep extends BaseStep {
  kind: "model_call";
  input: ModelCallInput;
  output: ModelCallOutput;
  model: string;
  settings: ModelSettings;
  tokens: TokenCounts;
  // estimated USD
  cost: number;
}

export interface ToolCallStep extends BaseStep {
  kind: "tool_call";
  input: ToolCallInput;
  // always null
  output: ToolCallOutput;
  model: null;
  settings: null;
  tokens: null;
  cost: null;
}

export interface ToolResultStep extends BaseStep {
  kind: "tool_result";
  input: ToolResultInput;
  output: ToolResultOutput;
  model: null;
  settings: null;
  tokens: null;
  cost: null;
}

// Trace (the file root)
export interface Trace {
  // semver string; currently TRACE_VERSION
  version: string;
  runId: string;
  // ISO-8601
  createdAt: string;
  steps: Step[];
}
