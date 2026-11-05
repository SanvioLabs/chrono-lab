// src/compare/fork.ts
// Fork operation: replay prefix, apply edit, run forward live.

import { randomUUID } from "node:crypto";
import * as path from "node:path";
import type {
  Trace,
  ModelCallStep,
  ToolResultStep,
  Step,
  ModelCallInput,
  ModelCallOutput,
  Message,
  ModelSettings,
} from "../trace/types.js";
import { TRACE_VERSION } from "../trace/types.js";
import type { ModelAdapter, ToolRegistry } from "../recorder/types.js";
import type { CapConfig, SpendLedger } from "../server/caps.js";
import {
  checkCaps,
  estimateCallCostUsd,
  computeActualCostUsd,
  CapExceededError,
  createSpendLedger,
} from "../server/caps.js";
import { replayTrace } from "../replay/replay.js";
import { Recorder } from "../recorder/recorder.js";
import { saveTrace } from "../trace/save.js";
import { ForkError } from "./errors.js";
import type { ForkEdit, ForkResult } from "./types.js";

export type { ForkEdit, ForkResult };

export interface ForkOptions {
  parentTrace: Trace;
  forkEdit: ForkEdit;
  modelAdapter: ModelAdapter;
  toolRegistry: ToolRegistry;
  traceDir: string;
  capConfig: CapConfig;
  // Shared ledger that carries spend across all forks in this session.
  // When absent a new ledger is created (useful in tests that run one fork).
  spendLedger?: SpendLedger;
  // Defaults to a generated UUID when absent.
  branchId?: string;
}

// Narrowed union: only the model_call variants of StepEdit.
type ModelCallEdit =
  | { kind: "model_call"; field: "messages"; value: Message[] }
  | { kind: "model_call"; field: "model"; value: string }
  | { kind: "model_call"; field: "settings"; value: ModelSettings };

// Sentinel used internally to carry cap information through the adapter call
// boundary without exposing it as a public type.
class CapSentinel extends Error {
  readonly capError: CapExceededError;
  constructor(capError: CapExceededError) {
    super(capError.message);
    this.name = "CapSentinel";
    this.capError = capError;
  }
}

// Fork a trace at the given step, apply the edit, and run forward live.
// Replay of the prefix makes no live calls. Live steps run after the prefix.
// Returns ForkSuccess on completion or ForkCapHit when a spend cap is reached.
export async function forkTrace(options: ForkOptions): Promise<ForkResult> {
  const {
    parentTrace,
    forkEdit,
    modelAdapter,
    toolRegistry,
    traceDir,
    capConfig,
  } = options;
  const branchId = options.branchId ?? randomUUID();
  const branchRunId = randomUUID();

  // Fix 1: use the shared ledger (carries spend from prior forks in this
  // session). Fall back to a fresh ledger only when none is supplied.
  const ledger: SpendLedger =
    options.spendLedger ?? createSpendLedger();

  // 1. Validate the fork-point step.
  const forkPointStep = parentTrace.steps.find(
    (s) => s.id === forkEdit.forkPointStepId
  );
  if (!forkPointStep) {
    throw new ForkError(
      forkEdit.forkPointStepId,
      `Fork-point step "${forkEdit.forkPointStepId}" not found in parent trace.`
    );
  }

  if (forkEdit.edit.kind !== forkPointStep.kind) {
    throw new ForkError(
      forkEdit.forkPointStepId,
      `Edit kind "${forkEdit.edit.kind}" is incompatible with step kind "${forkPointStep.kind}".`
    );
  }

  // 2. Replay the prefix up to and including the fork-point step.
  // replayTrace wraps its body in withNetworkGuard internally.
  const prefixTrace = await replayTrace(parentTrace, {
    stopAtStepId: forkEdit.forkPointStepId,
  });

  // Strip the fork-point step from the end of the replayed prefix.
  const prefixSteps = prefixTrace.steps.slice(0, -1);

  // Build a cap-aware model adapter wrapper.
  //
  // Before each live call: check caps using the estimate (worst-case upper
  // bound to prevent overage).
  // After each call: compute actual cost from token counts returned by the
  // model and add to the shared ledger (fix 2: charge actual, not estimate).
  // On CapExceededError: throw CapSentinel so forkTrace can catch it at the
  // right level.
  const makeCapAwareAdapter = (inner: ModelAdapter): ModelAdapter => {
    return async (input: ModelCallInput): Promise<ModelCallOutput> => {
      const maxTokens =
        (input.settings?.maxTokens as number | undefined) ?? 1024;
      const estimated = estimateCallCostUsd(input.model, maxTokens);

      try {
        checkCaps(capConfig, ledger.get(), estimated);
      } catch (err) {
        if (err instanceof CapExceededError) {
          throw new CapSentinel(err);
        }
        throw err;
      }

      const output = await inner(input);

      // Fix 2: charge actual tokens reported by the model output.
      // When the adapter does not populate tokens, fall back to zero (no cost
      // for stub/test models, which is correct since their price is zero).
      const actualCost = output.tokens
        ? computeActualCostUsd(
            input.model,
            output.tokens.input,
            output.tokens.output
          )
        : computeActualCostUsd(input.model, 0, 0);
      ledger.add(actualCost);

      return output;
    };
  };

  // Variables populated in the two edit paths below.
  let editedStep: Step;
  const liveStepsFromContinue: Step[] = [];
  let capHit: CapExceededError | null = null;

  if (forkEdit.edit.kind === "tool_result") {
    // --- tool_result edit path ---
    const originalStep = forkPointStep as ToolResultStep;

    const editedToolResultStep: ToolResultStep = {
      ...originalStep,
      id: `${branchRunId}-0`,
      runId: branchRunId,
      branch: branchId,
      forkPointId: originalStep.id,
      output: { result: forkEdit.edit.value, isError: false },
      live: false,
      edited: true,
    };
    editedStep = editedToolResultStep;

    // Reconstruct the message list up to and including the edited tool result.
    const prefixMessages = buildMessagesUpToToolResult(
      prefixSteps,
      editedToolResultStep
    );

    // Determine the model the live recorder should use. Look back at the most
    // recent model_call step in the prefix to find the active model.
    const lastModelStep = [...prefixSteps]
      .reverse()
      .find((s): s is ModelCallStep => s.kind === "model_call");
    const liveModelName = lastModelStep?.model ?? "stub";

    // Fix 3: collect live steps via onStep so partial progress is kept even
    // when the loop throws CapSentinel part way through.
    const collectedLiveSteps: Step[] = [];

    const recorder = new Recorder({
      modelAdapter: makeCapAwareAdapter(modelAdapter),
      toolRegistry,
      traceDir,
      branch: branchId,
      forkPointId: forkEdit.forkPointStepId,
      modelName: liveModelName,
      onStep: (step) => collectedLiveSteps.push(step),
    });

    try {
      await recorder.continueFrom(prefixMessages, 1);
    } catch (err) {
      if (err instanceof CapSentinel) {
        capHit = err.capError;
        // Fall through: collectedLiveSteps already holds every step that
        // completed before the cap was hit.
      } else {
        throw err;
      }
    }
    liveStepsFromContinue.push(...collectedLiveSteps);
  } else {
    // --- model_call edit path ---
    const originalStep = forkPointStep as ModelCallStep;
    const edit = forkEdit.edit as ModelCallEdit;
    const editedInput = applyModelCallEdit(originalStep, edit);

    // Check cap before the immediate live call.
    const maxTokens =
      (editedInput.settings?.maxTokens as number | undefined) ?? 1024;
    const estimated = estimateCallCostUsd(editedInput.model, maxTokens);

    try {
      checkCaps(capConfig, ledger.get(), estimated);
    } catch (err) {
      if (err instanceof CapExceededError) {
        // Cap hit before anything ran. Return a partial branch with the prefix.
        const partialBranch = assembleTrace(
          branchRunId,
          parentTrace,
          forkEdit.forkPointStepId,
          prefixSteps,
          [],
          []
        );
        const filePath = path.join(traceDir, `${branchRunId}.json`);
        await saveTrace(partialBranch, filePath);
        return {
          status: "cap_hit",
          reason: err.reason,
          limitUsd: err.limitUsd,
          partialBranch,
        };
      }
      throw err;
    }

    // Run the edited model call live immediately.
    const liveModelOutput = await modelAdapter(editedInput);

    // Fix 2: charge actual cost from token counts, not the estimate.
    const actualCost = liveModelOutput.tokens
      ? computeActualCostUsd(
          editedInput.model,
          liveModelOutput.tokens.input,
          liveModelOutput.tokens.output
        )
      : computeActualCostUsd(editedInput.model, 0, 0);
    ledger.add(actualCost);

    // Fix 4: the edited step carries the live output, not the original output.
    const editedModelStep: ModelCallStep = {
      ...originalStep,
      id: `${branchRunId}-0`,
      runId: branchRunId,
      branch: branchId,
      forkPointId: originalStep.id,
      input: editedInput,
      output: liveModelOutput,
      model: editedInput.model,
      settings: editedInput.settings,
      live: true,
      edited: true,
    };
    editedStep = editedModelStep;

    // If the live output has tool calls, use continueFrom to drive the
    // remaining tool dispatch and any subsequent model calls. We pass the
    // messages BEFORE the live call. The recorder calls the model first, but
    // we give it a "prefill adapter" that returns the already-computed live
    // output on its first invocation. The recorder then dispatches tool calls
    // and continues the loop as normal.
    if (
      liveModelOutput.finishReason === "tool_calls" &&
      liveModelOutput.toolCalls &&
      liveModelOutput.toolCalls.length > 0
    ) {
      // Messages leading up to (but not including) the live model call.
      const preCallMessages = buildMessagesBeforeModelCall(prefixSteps, editedInput.messages);

      // Prefill adapter: on the first call returns the already-computed live
      // output; on all subsequent calls delegates to capAwareAdapter.
      let firstCall = true;
      const prefillAdapter: ModelAdapter = async (
        input: ModelCallInput
      ): Promise<ModelCallOutput> => {
        if (firstCall) {
          firstCall = false;
          // Return the pre-computed output without making another live call or
          // charging caps (already charged above).
          return liveModelOutput;
        }
        return makeCapAwareAdapter(modelAdapter)(input);
      };

      // Fix 3: collect live steps via onStep so partial progress is kept.
      const collectedLiveSteps: Step[] = [];

      const recorder = new Recorder({
        modelAdapter: prefillAdapter,
        toolRegistry,
        traceDir,
        branch: branchId,
        forkPointId: forkEdit.forkPointStepId,
        modelName: editedInput.model,
        onStep: (step) => collectedLiveSteps.push(step),
      });

      try {
        await recorder.continueFrom(preCallMessages, 1);
      } catch (err) {
        if (err instanceof CapSentinel) {
          capHit = err.capError;
          // Fall through: collectedLiveSteps holds steps completed so far.
        } else {
          throw err;
        }
      }

      // The first step from continueFrom is the model_call that returned
      // liveModelOutput (via the prefill adapter). We already have this as
      // editedStep, so skip the first continueFrom step to avoid duplication.
      // All subsequent steps are the tool call, tool result, and final model
      // call; they carry live: true, edited: false.
      const stepsAfterEdited = collectedLiveSteps.slice(1);
      liveStepsFromContinue.push(...stepsAfterEdited);
    }
    // finishReason === "stop": no further steps needed.
  }

  // 4. Restamp live steps to use branchRunId so all ids share the same prefix.
  const restampedLiveSteps = restampSteps(liveStepsFromContinue, branchRunId, 1);

  // 5. Assemble and save the full branch trace.
  const branchTrace = assembleTrace(
    branchRunId,
    parentTrace,
    forkEdit.forkPointStepId,
    prefixSteps,
    [editedStep],
    restampedLiveSteps
  );

  const filePath = path.join(traceDir, `${branchRunId}.json`);
  await saveTrace(branchTrace, filePath);

  if (capHit) {
    return {
      status: "cap_hit",
      reason: capHit.reason,
      limitUsd: capHit.limitUsd,
      partialBranch: branchTrace,
    };
  }

  return { status: "ok", branch: branchTrace };
}

// Restamp steps from continueFrom so their ids use branchRunId.
function restampSteps(
  steps: Step[],
  branchRunId: string,
  startIndex: number
): Step[] {
  return steps.map((step, i) => ({
    ...step,
    id: `${branchRunId}-${startIndex + i}`,
    runId: branchRunId,
  }));
}

// Assemble a complete branch Trace from its constituent parts.
function assembleTrace(
  branchRunId: string,
  parentTrace: Trace,
  forkPointStepId: string,
  prefixSteps: Step[],
  editedSteps: Step[],
  liveSteps: Step[]
): Trace {
  return {
    version: TRACE_VERSION,
    runId: branchRunId,
    createdAt: new Date().toISOString(),
    steps: [...prefixSteps, ...editedSteps, ...liveSteps],
    parentRunId: parentTrace.runId,
    forkPointStepId,
  };
}

// Reconstruct the message list up to and including the edited tool result.
function buildMessagesUpToToolResult(
  prefixSteps: Step[],
  editedToolResultStep: ToolResultStep
): ModelCallInput["messages"] {
  const messages: ModelCallInput["messages"] = [];

  for (const step of prefixSteps) {
    if (step.kind === "model_call") {
      if (messages.length === 0) {
        // Seed with the original system + user messages from the first call.
        messages.push(...step.input.messages);
      }
      messages.push(step.output.message);
    } else if (step.kind === "tool_result") {
      messages.push({
        role: "tool",
        content: String(step.output.result),
        toolCallId: step.input.toolCallId,
      });
    }
    // tool_call steps are reflected in the model output; no message to add.
  }

  // Add the edited tool result.
  messages.push({
    role: "tool",
    content: String(editedToolResultStep.output.result),
    toolCallId: editedToolResultStep.input.toolCallId,
  });

  return messages;
}

// Build the message list from prefix steps, ending just before the model
// call at the fork point. If the fork point is the first step, returns the
// messages from editedInput directly (which already contain the system +
// user messages).
function buildMessagesBeforeModelCall(
  prefixSteps: Step[],
  editedInputMessages: ModelCallInput["messages"]
): ModelCallInput["messages"] {
  if (prefixSteps.length === 0) {
    // The fork point is the very first step. Return the messages as they
    // were passed to the edited call: they already include system + user.
    return [...editedInputMessages];
  }

  const messages: ModelCallInput["messages"] = [];

  for (const step of prefixSteps) {
    if (step.kind === "model_call") {
      if (messages.length === 0) {
        messages.push(...step.input.messages);
      }
      messages.push(step.output.message);
    } else if (step.kind === "tool_result") {
      messages.push({
        role: "tool",
        content: String(step.output.result),
        toolCallId: step.input.toolCallId,
      });
    }
  }

  return messages;
}

// Apply a model_call edit to the step's input.
function applyModelCallEdit(
  originalStep: ModelCallStep,
  edit: ModelCallEdit
): ModelCallInput {
  const base: ModelCallInput = { ...originalStep.input };
  if (edit.field === "messages") {
    return { ...base, messages: edit.value };
  }
  if (edit.field === "model") {
    return { ...base, model: edit.value };
  }
  // field === "settings"
  return { ...base, settings: edit.value };
}
