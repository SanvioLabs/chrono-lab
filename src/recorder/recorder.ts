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
  ModelCallOutput,
  TokenCounts,
  EndReason,
} from "../trace/types.js";
import { TRACE_VERSION } from "../trace/types.js";
import { saveTrace } from "../trace/save.js";
import { computeActualCostUsd } from "../server/caps.js";

// The step bound that ends a run that never stops on its own. A model that
// keeps asking for tools would otherwise loop forever; with a zero-cost model
// the spend caps never stop it either. The run ends cleanly at this many steps
// and marks why (endReason "max_steps").
export const DEFAULT_MAX_STEPS = 50;

export interface RecorderOptions {
  modelAdapter: ModelAdapter;
  toolRegistry: ToolRegistry;
  traceDir: string;
  // Defaults to "main" when absent.
  branch?: string;
  // Defaults to null when absent.
  forkPointId?: string;
  // Model name stamped on each model_call step. Defaults to "stub".
  modelName?: string;
  // The maximum number of steps the run may produce. When the loop reaches it
  // the run ends cleanly (endReason "max_steps") rather than looping forever.
  // Defaults to DEFAULT_MAX_STEPS.
  maxSteps?: number;
  // Called after each step is recorded. The caller can collect steps here
  // even if the loop later throws, so partial progress is never lost.
  onStep?: (step: Step) => void;
  // Aborted by the server (or a fork's stop) to stop a record in flight. On
  // abort the loop stops after the current step and the partial run is saved
  // (endReason "aborted"), matching the running fork's stop behaviour.
  signal?: AbortSignal;
}

// What a loop produced: the steps, and why it stopped. forkTrace reads the
// reason so a stop or a step-bound end carries through to the saved branch.
export interface RunLoopResult {
  steps: Step[];
  endReason: EndReason;
}

// Reads the token counts a model output reports. When the adapter reports
// none, the step carries zero tokens (and therefore zero cost). Spec 01's
// R-01 requires the recorded tokens, so a step reflects what the adapter
// actually returned rather than always zero.
function tokensFromOutput(output: ModelCallOutput): TokenCounts {
  if (output.tokens) {
    return { input: output.tokens.input, output: output.tokens.output };
  }
  return { input: 0, output: 0 };
}

// The minimal agent loop used in this spec:
//   1. Send the system prompt + task to the model.
//   2. If the model responds with tool_calls, dispatch the tool and loop.
//   3. If the model responds with stop, end the run.
//   4. If the step bound is reached, or the signal is aborted, end the run
//      cleanly and mark why.
export class Recorder {
  private readonly modelAdapter: ModelAdapter;
  private readonly toolRegistry: ToolRegistry;
  private readonly traceDir: string;
  private readonly branch: string;
  private readonly forkPointId: string | null;
  private readonly modelName: string;
  private readonly maxSteps: number;
  private readonly onStep: ((step: Step) => void) | undefined;
  private readonly signal: AbortSignal | undefined;

  constructor(options: RecorderOptions) {
    this.modelAdapter = options.modelAdapter;
    this.toolRegistry = options.toolRegistry;
    this.traceDir = options.traceDir;
    this.branch = options.branch ?? "main";
    this.forkPointId = options.forkPointId ?? null;
    this.modelName = options.modelName ?? "stub";
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.onStep = options.onStep;
    this.signal = options.signal;
  }

  // Record a full agent run for the given task string.
  // Returns the saved Trace. Propagates any error from the model or tools.
  async run(task: string): Promise<Trace> {
    const runId = randomUUID();

    const messages: ModelCallInput["messages"] = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: task },
    ];

    const { steps, endReason } = await this.runLoop(runId, messages, 0, false);

    const trace: Trace = {
      version: TRACE_VERSION,
      runId,
      createdAt: new Date().toISOString(),
      steps,
      endReason,
    };

    const filePath = path.join(this.traceDir, `${runId}.json`);
    await saveTrace(trace, filePath);

    return trace;
  }

  // Start the agent loop with the supplied message list, beginning step ids at
  // firstStepIndex. Used by forkTrace to continue from the fork point onward.
  // Steps written by continueFrom carry live: true and edited: false.
  // When runId is supplied the steps are stamped with it directly, so the
  // caller needs no later restamping and the ids it sees via onStep match the
  // ids in the saved branch. Returns a Trace containing only the steps this
  // call produced; its endReason records why the live phase ended.
  async continueFrom(
    messages: ModelCallInput["messages"],
    firstStepIndex: number,
    runId: string = randomUUID()
  ): Promise<Trace> {
    const { steps, endReason } = await this.runLoop(
      runId,
      [...messages],
      firstStepIndex,
      true
    );

    // Return the trace without saving: forkTrace assembles and saves the full
    // branch trace.
    return {
      version: TRACE_VERSION,
      runId,
      createdAt: new Date().toISOString(),
      steps,
      endReason,
    };
  }

  // Shared loop body used by both run and continueFrom.
  // live: false for run steps, true for continueFrom steps.
  // The step bound (maxSteps) counts steps produced in this call; when the next
  // step would exceed it the loop ends with endReason "max_steps". When the
  // signal is aborted the loop ends after the current step with endReason
  // "aborted". Otherwise it ends with "stop" when the model stops.
  private async runLoop(
    runId: string,
    messages: ModelCallInput["messages"],
    startIndex: number,
    live: boolean
  ): Promise<RunLoopResult> {
    const steps: Step[] = [];
    let stepIndex = startIndex;
    let parentId: string | null = null;

    const nextId = (): string => `${runId}-${stepIndex++}`;

    const pushStep = (step: Step): void => {
      steps.push(step);
      this.onStep?.(step);
    };

    // Room for one more step before the bound is reached.
    const underBound = (): boolean => steps.length < this.maxSteps;

    let endReason: EndReason = "stop";
    let continueLoop = true;

    while (continueLoop) {
      // Stop cleanly before the model call if the signal was aborted.
      if (this.signal?.aborted) {
        endReason = "aborted";
        break;
      }
      // Stop cleanly before the model call if the step bound is reached.
      if (!underBound()) {
        endReason = "max_steps";
        break;
      }

      // Model call
      const modelInput: ModelCallInput = {
        messages: [...messages],
        model: this.modelName,
        settings: {},
      };

      const modelStepId = nextId();
      const modelStart = performance.now();
      const modelOutput = await this.modelAdapter(modelInput);
      const modelDuration = performance.now() - modelStart;

      // Record the tokens the adapter reported (zero only when it reports
      // none), and the matching cost from the price table for this model.
      // Spec 01 R-01 requires the recorded tokens and cost, so a step reflects
      // what the model returned rather than always zero.
      const tokens = tokensFromOutput(modelOutput);
      const cost = computeActualCostUsd(
        modelInput.model,
        tokens.input,
        tokens.output
      );

      const modelStep: ModelCallStep = {
        id: modelStepId,
        runId,
        parentId,
        kind: "model_call",
        branch: this.branch,
        forkPointId: this.forkPointId,
        durationMs: modelDuration,
        model: modelInput.model,
        settings: modelInput.settings,
        tokens,
        cost,
        input: modelInput,
        output: modelOutput,
        live,
        edited: false,
      };

      pushStep(modelStep);
      parentId = modelStepId;

      // Append the assistant reply to the running message list.
      messages.push(modelOutput.message);

      // Stop cleanly after the model step if the signal was aborted.
      if (this.signal?.aborted) {
        endReason = "aborted";
        break;
      }

      if (
        modelOutput.finishReason === "tool_calls" &&
        modelOutput.toolCalls &&
        modelOutput.toolCalls.length > 0
      ) {
        // Dispatch each tool call in the response.
        for (const toolCallSpec of modelOutput.toolCalls) {
          // Stop cleanly before the tool dispatch if the bound is reached, so
          // a runaway loop cannot push past maxSteps.
          if (!underBound()) {
            endReason = "max_steps";
            continueLoop = false;
            break;
          }

          const toolCallStepId = nextId();
          const toolCallStart = performance.now();

          const toolCallStep: ToolCallStep = {
            id: toolCallStepId,
            runId,
            parentId,
            kind: "tool_call",
            branch: this.branch,
            forkPointId: this.forkPointId,
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
            live,
            edited: false,
          };

          const toolImpl = this.toolRegistry[toolCallSpec.name];
          if (!toolImpl) {
            throw new Error(`Unknown tool: ${toolCallSpec.name}`);
          }

          const toolResult = await toolImpl(toolCallSpec.arguments);
          const toolDuration = performance.now() - toolCallStart;

          // Patch in the measured duration.
          toolCallStep.durationMs = toolDuration;
          pushStep(toolCallStep);
          parentId = toolCallStepId;

          // Stop cleanly before the tool result if the bound is reached.
          if (!underBound()) {
            endReason = "max_steps";
            continueLoop = false;
            break;
          }

          // Tool result step
          const toolResultStepId = nextId();
          const toolResultStep: ToolResultStep = {
            id: toolResultStepId,
            runId,
            parentId,
            kind: "tool_result",
            branch: this.branch,
            forkPointId: this.forkPointId,
            durationMs: 0,
            model: null,
            settings: null,
            tokens: null,
            cost: null,
            input: { toolCallId: toolCallSpec.id },
            output: { result: toolResult, isError: false },
            live,
            edited: false,
          };

          pushStep(toolResultStep);
          parentId = toolResultStepId;

          // Add the tool result to the message list for the next model call.
          messages.push({
            role: "tool",
            content: String(toolResult),
            toolCallId: toolCallSpec.id,
          });

          // Stop cleanly after the tool result if the signal was aborted.
          if (this.signal?.aborted) {
            endReason = "aborted";
            continueLoop = false;
            break;
          }
        }
      } else {
        // No tool calls: the run is done.
        endReason = "stop";
        continueLoop = false;
      }
    }

    return { steps, endReason };
  }
}
