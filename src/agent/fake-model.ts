// src/agent/fake-model.ts
// The deterministic fake model and its sandboxed tools (C-01).
//
// makeFakeModel returns a ModelAdapter and a ToolRegistry that match the
// interfaces in src/recorder/types.ts, reusing the response shapes proven in
// tests/fixtures/stand-in-agent.ts but importable from src/ so the server can
// use them. The adapter makes no network call, reads no file, and reads no
// clock; the same call sequence always yields the same outputs. The model name
// stamped on steps is "fake".

import type { ModelCallInput, ModelCallOutput } from "../trace/types.js";
import type { ModelAdapter, ToolRegistry } from "../recorder/types.js";

export interface FakeModel {
  // from src/recorder/types.ts
  modelAdapter: ModelAdapter;
  // from src/recorder/types.ts; sandboxed (an echo tool)
  toolRegistry: ToolRegistry;
  // Resets the deterministic call cursor so a fresh sequence starts over.
  reset(): void;
}

// The fixed response sequence. Turn 0 asks for the echo tool; turn 1 gives a
// final answer. Turns 2 and 3 repeat the same pair, so one adapter instance
// drives a record run (turns 0 and 1) and then one fork live phase (turns 2
// and 3) without running out. Every string here is plain text that no scrub
// pattern matches.
const RESPONSES: ModelCallOutput[] = [
  // Turn 0: request the echo tool.
  {
    message: { role: "assistant", content: "" },
    finishReason: "tool_calls",
    toolCalls: [{ id: "call-echo-001", name: "echo", arguments: { text: "hello" } }],
  },
  // Turn 1: final answer after seeing the tool result.
  {
    message: { role: "assistant", content: "Final answer: hello" },
    finishReason: "stop",
  },
  // Turn 2: used by a fork live phase (edited model_call). Request echo again
  // so the fork branch has the same shape as the parent.
  {
    message: { role: "assistant", content: "" },
    finishReason: "tool_calls",
    toolCalls: [{ id: "call-echo-002", name: "echo", arguments: { text: "hello" } }],
  },
  // Turn 3: final answer for the fork branch after the tool result.
  {
    message: { role: "assistant", content: "Final answer: hello" },
    finishReason: "stop",
  },
];

// Returns a fresh fake model. The adapter advances a cursor through RESPONSES,
// so the same call sequence always yields the same outputs. When the cursor
// runs past the end the adapter repeats the final stop response, so a run that
// goes further than the scripted turns still ends cleanly rather than throwing.
// The echo tool returns its text argument unchanged. Nothing here touches the
// file system, the network, or the clock.
export function makeFakeModel(): FakeModel {
  let cursor = 0;

  const modelAdapter: ModelAdapter = async (
    _input: ModelCallInput
  ): Promise<ModelCallOutput> => {
    const response = RESPONSES[cursor] ?? RESPONSES[RESPONSES.length - 1]!;
    cursor += 1;
    return response;
  };

  const toolRegistry: ToolRegistry = {
    echo: async (args: Record<string, unknown>): Promise<unknown> => {
      return args["text"];
    },
  };

  const reset = (): void => {
    cursor = 0;
  };

  return { modelAdapter, toolRegistry, reset };
}
