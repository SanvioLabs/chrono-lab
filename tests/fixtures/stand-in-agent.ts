// tests/fixtures/stand-in-agent.ts
// Minimal stand-in agent fixture for recorder and replay tests.
// Produces exactly 4 steps: model_call, tool_call, tool_result, model_call.
// No string value here matches any scrub pattern.

import type { ModelCallInput, ModelCallOutput } from "../../src/trace/types.js";
import type { ModelAdapter, ToolRegistry } from "../../src/recorder/types.js";

// Pre-defined responses for the two record run model turns.
const RESPONSES: ModelCallOutput[] = [
  // Turn 0: requests the echo tool.
  {
    message: { role: "assistant", content: "" },
    finishReason: "tool_calls",
    toolCalls: [
      {
        id: "call-echo-001",
        name: "echo",
        arguments: { text: "hello" },
      },
    ],
  },
  // Turn 1: final answer after seeing the tool result.
  {
    message: { role: "assistant", content: "Final answer: hello" },
    finishReason: "stop",
  },
  // Turn 2: used by fork live phase (edited model_call). Requests the echo
  // tool again so the fork branch has the same structure as the parent.
  {
    message: { role: "assistant", content: "" },
    finishReason: "tool_calls",
    toolCalls: [
      {
        id: "call-echo-002",
        name: "echo",
        arguments: { text: "hello" },
      },
    ],
  },
  // Turn 3: final answer for the fork branch after the tool result.
  {
    message: { role: "assistant", content: "Final answer: hello" },
    finishReason: "stop",
  },
];

export interface StandInAdapters {
  modelAdapter: ModelAdapter;
  toolRegistry: ToolRegistry;
  reset: () => void;
}

// Returns adapters whose model adapter immediately returns a stop response
// with a fixed final answer. Useful for the live phase after a tool_result
// edit, where the conversation history already ends with a tool result and
// the next model turn should produce a final answer.
export function makeStopOnlyAdapters(): StandInAdapters {
  const STOP_RESPONSE: ModelCallOutput = {
    message: { role: "assistant", content: "Final answer: edited result" },
    finishReason: "stop",
  };

  const modelAdapter: ModelAdapter = async (
    _input: ModelCallInput
  ): Promise<ModelCallOutput> => {
    return STOP_RESPONSE;
  };

  const toolRegistry: ToolRegistry = {
    echo: async (args: Record<string, unknown>): Promise<unknown> => {
      return args["text"];
    },
  };

  return { modelAdapter, toolRegistry, reset: () => {} };
}

// Returns a fresh pair of adapters. Each call to modelAdapter advances an
// internal cursor, so the second call returns the second response.
// Responses 0 and 1 cover a full record run (tool_calls then stop).
// Responses 2 and 3 cover a subsequent fork live phase (same sequence),
// so a single adapter instance can be shared across a record run and one fork.
export function makeStandInAdapters(): StandInAdapters {
  let cursor = 0;

  const modelAdapter: ModelAdapter = async (
    _input: ModelCallInput
  ): Promise<ModelCallOutput> => {
    const response = RESPONSES[cursor];
    if (response === undefined) {
      throw new Error(
        `Stand-in model adapter exhausted (cursor=${cursor}, max=${RESPONSES.length})`
      );
    }
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
