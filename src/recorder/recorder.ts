// src/recorder/recorder.ts
// Wraps a minimal agent loop and records every step to a trace file.

import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import type { ModelAdapter, ToolRegistry } from "./types.js";
import type {
  Trace,
  Step,
  ModelCallStep,
  ToolCallStep,
  ToolResultStep,
  ModelCallInput,
} from "../trace/types.js";
import { TRACE_VERSION } from "../trace/types.js";
import { saveTrace } from "../trace/save.js";

interface RecorderOptions {
  modelAdapter: ModelAdapter;
  toolRegistry: ToolRegistry;
  traceDir: string;
}

// The minimal agent loop used in this spec:
//   1. Send the system prompt + task to the model.
//   2. If the model responds with tool_calls, dispatch the tool and loop.
//   3. If the model responds with stop, end the run.
export class Recorder {
  private readonly modelAdapter: ModelAdapter;
  private readonly toolRegistry: ToolRegistry;
  private readonly traceDir: string;

  constructor(options: RecorderOptions) {
    this.modelAdapter = options.modelAdapter;
    this.toolRegistry = options.toolRegistry;
    this.traceDir = options.traceDir;
  }

  // Record a full agent run for the given task string.
  // Returns the saved Trace. Propagates any error from the model or tools.
  async run(task: string): Promise<Trace> {
    const runId = randomUUID();
    const steps: Step[] = [];
    let stepIndex = 0;
    let parentId: string | null = null;

    const nextId = (): string => `${runId}-${stepIndex++}`;

    // Build the initial message list.
    const messages: ModelCallInput["messages"] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: task },
    ];

    let continueLoop = true;

    while (continueLoop) {
      // Model call
      const modelInput: ModelCallInput = {
        messages: [...messages],
        model: "stub",
        settings: {},
      };

      const modelStepId = nextId();
      const modelStart = performance.now();
      const modelOutput = await this.modelAdapter(modelInput);
      const modelDuration = performance.now() - modelStart;

      const modelStep: ModelCallStep = {
        id: modelStepId,
        runId,
        parentId,
        kind: "model_call",
        branch: "main",
        forkPointId: null,
        durationMs: modelDuration,
        model: modelInput.model,
        settings: modelInput.settings,
        tokens: { input: 0, output: 0 },
        cost: 0,
        input: modelInput,
        output: modelOutput,
      };

      steps.push(modelStep);
      parentId = modelStepId;

      // Append the assistant reply to the running message list.
      messages.push(modelOutput.message);

      if (
        modelOutput.finishReason === "tool_calls" &&
        modelOutput.toolCalls &&
        modelOutput.toolCalls.length > 0
      ) {
        // Dispatch each tool call in the response.
        for (const toolCallSpec of modelOutput.toolCalls) {
          const toolCallStepId = nextId();
          const toolCallStart = performance.now();

          const toolCallStep: ToolCallStep = {
            id: toolCallStepId,
            runId,
            parentId,
            kind: "tool_call",
            branch: "main",
            forkPointId: null,
            durationMs: 0, // filled in after the call
            model: null,
            settings: null,
            tokens: null,
            cost: null,
            input: {
              toolCallId: toolCallSpec.id,
              name: toolCallSpec.name,
              arguments: toolCallSpec.arguments,
            },
            output: null,
          };

          const toolImpl = this.toolRegistry[toolCallSpec.name];
          if (!toolImpl) {
            throw new Error(
              `Unknown tool: ${toolCallSpec.name}`
            );
          }

          const toolResult = await toolImpl(toolCallSpec.arguments);
          const toolDuration = performance.now() - toolCallStart;

          // Patch in the measured duration.
          toolCallStep.durationMs = toolDuration;
          steps.push(toolCallStep);
          parentId = toolCallStepId;

          // Tool result step
          const toolResultStepId = nextId();
          const toolResultStep: ToolResultStep = {
            id: toolResultStepId,
            runId,
            parentId,
            kind: "tool_result",
            branch: "main",
            forkPointId: null,
            durationMs: 0,
            model: null,
            settings: null,
            tokens: null,
            cost: null,
            input: { toolCallId: toolCallSpec.id },
            output: { result: toolResult, isError: false },
          };

          steps.push(toolResultStep);
          parentId = toolResultStepId;

          // Add the tool result to the message list for the next model call.
          messages.push({
            role: "tool",
            content: String(toolResult),
            toolCallId: toolCallSpec.id,
          });
        }
      } else {
        // No tool calls: the run is done.
        continueLoop = false;
      }
    }

    const trace: Trace = {
      version: TRACE_VERSION,
      runId,
      createdAt: new Date().toISOString(),
      steps,
    };

    const filePath = path.join(this.traceDir, `${runId}.json`);
    await saveTrace(trace, filePath);

    return trace;
  }
}
