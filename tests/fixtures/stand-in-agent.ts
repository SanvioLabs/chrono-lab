// tests/fixtures/stand-in-agent.ts
// Minimal stand-in agent fixture for recorder and replay tests.
// Produces exactly 4 steps: model_call, tool_call, tool_result, model_call.
// No string value here matches any scrub pattern.

import type { ModelCallInput, ModelCallOutput } from "../../src/trace/types.js";
import type { ModelAdapter, ToolRegistry } from "../../src/recorder/types.js";

// Pre-defined responses for the two model turns.
const RESPONSES: ModelCallOutput[] = [
  // Turn 1: requests the echo tool.
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
  // Turn 2: final answer after seeing the tool result.
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

// Returns a fresh pair of adapters. Each call to modelAdapter advances an
// internal cursor, so the second call returns the second response.
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
