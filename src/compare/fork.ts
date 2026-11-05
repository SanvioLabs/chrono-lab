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
  EndReason,
} from "../trace/types.js";
import { TRACE_VERSION } from "../trace/types.js";
import type { ModelAdapter, ToolRegistry } from "../recorder/types.js";
import type { CapConfig, SpendLedger, PriceOverrides } from "../server/caps.js";
import {
  checkCaps,
  estimateCallCostUsd,
  computeActualCostUsd,
  CapExceededError,
  createSpendLedger,
} from "../server/caps.js";
import { replayTrace } from "../replay/replay.js";
import { Recorder, DEFAULT_MAX_STEPS } from "../recorder/recorder.js";
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
  // An optional per-call price override table (from server config). When set,
  // a model priced zero in MODEL_PRICES (the fake model) can be given a real
  // price for this server instance only, so a cap trips through the real path.
  // Undefined in production, so pricing and the caps are unchanged.
  priceOverrides?: PriceOverrides;
  // Defaults to a generated UUID when absent.
  branchId?: string;
  // The step bound for the live phase. A model that never stops would loop
  // forever and, with a zero-cost model, the spend caps never stop it. The
  // live phase ends cleanly at this many live steps and the branch records
  // endReason "max_steps". Defaults to DEFAULT_MAX_STEPS.
  maxSteps?: number;
  // Called for each live step as it is produced, before the fork returns. The
  // server writes one SSE event per call. Replayed prefix steps are not passed
  // to onStep; only live steps are, including the immediate model-call edit
  // step. Each step is passed with its final branch id, so an id the server
  // streams is never rewritten in the saved branch.
  onStep?: (step: Step) => void;
  // Aborted by the server to stop a running fork. On abort, forkTrace stops
  // after the current step and saves the partial branch, the same way a cap
  // hit does. A stop is a clean, saved result (ForkSuccess) whose branch is
  // simply shorter; it is not a cap hit.
  signal?: AbortSignal;
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
// Returns ForkSuccess on completion (including a clean stop or a step-bound
// end, whose branch is simply shorter) or ForkCapHit when a spend cap is
// reached.
export async function forkTrace(options: ForkOptions): Promise<ForkResult> {
  const {
    parentTrace,
    forkEdit,
    modelAdapter,
    toolRegistry,
    traceDir,
    capConfig,
    priceOverrides,
  } = options;
  const branchId = options.branchId ?? randomUUID();
  const branchRunId = randomUUID();
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
  const signal = options.signal;
  const forwardStep = options.onStep;

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
      const estimated = estimateCallCostUsd(
        input.model,
        maxTokens,
        priceOverrides
      );

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
      // for stub/test models, which is correct since their price is zero). The
      // Recorder that runs inside the live phase records the same tokens and
      // cost onto the step itself.
      const actualCost = output.tokens
        ? computeActualCostUsd(
            input.model,
            output.tokens.input,
            output.tokens.output,
            priceOverrides
          )
        : computeActualCostUsd(input.model, 0, 0, priceOverrides);
      ledger.add(actualCost);

      return output;
    };
  };

  // Live steps, each already stamped with its final branch id so no later
  // restamp is needed. A running index keeps the ids contiguous
  // (<branchRunId>-0, -1, -2, ...). The index is shared across the edited step
  // and the continueFrom steps.
  const liveSteps: Step[] = [];
  let liveIndex = 0;

  // Stamp a live step with the next branch id, record it, and forward it to
  // options.onStep. Returns the stamped step. The server sees exactly the id
  // and payload the saved branch holds.
  const emitLiveStep = (step: Step): Step => {
    const stamped: Step = {
      ...step,
      id: `${branchRunId}-${liveIndex++}`,
      runId: branchRunId,
    };
    liveSteps.push(stamped);
    forwardStep?.(stamped);
    return stamped;
  };

  let capHit: CapExceededError | null = null;
  // Why the live phase ended. "stop" until a cap, a stop signal, or the step
  // bound changes it.
  let endReason: EndReason = "stop";

  if (forkEdit.edit.kind === "tool_result") {
    // --- tool_result edit path ---
    const originalStep = forkPointStep as ToolResultStep;

    const editedToolResultStep: ToolResultStep = {
      ...originalStep,
      // id/runId set by emitLiveStep (index 0). The tool_result edit step is
      // not a live model turn (live: false), but it is the fork-point step and
      // is streamed first.
      branch: branchId,
      forkPointId: originalStep.id,
      output: { result: forkEdit.edit.value, isError: false },
      live: false,
      edited: true,
    };
    emitLiveStep(editedToolResultStep);

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

    // The edited tool_result counts as the first live step, so the recorder
    // gets room for maxSteps - 1 more. Each recorder step is stamped and
    // forwarded by emitLiveStep as it arrives.
    const recorder = new Recorder({
      modelAdapter: makeCapAwareAdapter(modelAdapter),
      toolRegistry,
      traceDir,
      branch: branchId,
      forkPointId: forkEdit.forkPointStepId,
      modelName: liveModelName,
      maxSteps: Math.max(0, maxSteps - 1),
      signal,
      onStep: (step) => emitLiveStep(step),
    });

    let continueResult: Trace | undefined;
    try {
      continueResult = await recorder.continueFrom(prefixMessages, 1);
    } catch (err) {
      if (err instanceof CapSentinel) {
        capHit = err.capError;
        endReason = "cap";
        // Fall through: liveSteps already holds every step emitted before the
        // cap was hit.
      } else {
        throw err;
      }
    }
    if (continueResult) {
      endReason = continueResult.endReason ?? "stop";
    }
  } else {
    // --- model_call edit path ---
    const originalStep = forkPointStep as ModelCallStep;
    const edit = forkEdit.edit as ModelCallEdit;
    const editedInput = applyModelCallEdit(originalStep, edit);

    // Check cap before the immediate live call.
    const maxTokens =
      (editedInput.settings?.maxTokens as number | undefined) ?? 1024;
    const estimated = estimateCallCostUsd(
      editedInput.model,
      maxTokens,
      priceOverrides
    );

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
          "cap"
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

    // Fix 2: charge actual cost from token counts, not the estimate. Record
    // the tokens the model reported (zero only when it reports none) and the
    // matching cost, so the edited fork-point step carries its own tokens and
    // cost rather than the original step's (spec 01 R-01).
    const liveTokens = liveModelOutput.tokens
      ? {
          input: liveModelOutput.tokens.input,
          output: liveModelOutput.tokens.output,
        }
      : { input: 0, output: 0 };
    const actualCost = computeActualCostUsd(
      editedInput.model,
      liveTokens.input,
      liveTokens.output,
      priceOverrides
    );
    ledger.add(actualCost);

    // Fix 4: the edited step carries the live output, not the original output,
    // and the tokens and cost from that live call.
    const editedModelStep: ModelCallStep = {
      ...originalStep,
      // id/runId set by emitLiveStep (index 0).
      branch: branchId,
      forkPointId: originalStep.id,
      input: editedInput,
      output: liveModelOutput,
      model: editedInput.model,
      settings: editedInput.settings,
      tokens: liveTokens,
      cost: actualCost,
      live: true,
      edited: true,
    };

    // Emit the immediate model-call edit step first (C-03): the server streams
    // it before any other live step.
    emitLiveStep(editedModelStep);

    // If the stop signal was aborted as this first step was forwarded, stop
    // here: save the partial branch (just this one live step) and make no
    // further live call. A stop is a clean, saved result.
    if (signal?.aborted) {
      endReason = "aborted";
    } else if (
      liveModelOutput.finishReason === "tool_calls" &&
      liveModelOutput.toolCalls &&
      liveModelOutput.toolCalls.length > 0
    ) {
      // The live output has tool calls: use continueFrom to drive the
      // remaining tool dispatch and any subsequent model calls. We pass the
      // messages BEFORE the live call. The recorder calls the model first, but
      // we give it a "prefill adapter" that returns the already-computed live
      // output on its first invocation. The recorder then dispatches tool
      // calls and continues the loop as normal.
      const preCallMessages = buildMessagesBeforeModelCall(
        prefixSteps,
        editedInput.messages
      );

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

      // continueFrom's first step is the prefilled model_call (a duplicate of
      // the edited step already emitted), so it is dropped; every later step is
      // emitted (stamped and forwarded).
      let seenFirst = false;

      const recorder = new Recorder({
        modelAdapter: prefillAdapter,
        toolRegistry,
        traceDir,
        branch: branchId,
        forkPointId: forkEdit.forkPointStepId,
        modelName: editedInput.model,
        // The edited model_call is step 1 of the live phase; give the recorder
        // room for maxSteps - 1 more so the whole live phase stays within
        // maxSteps.
        maxSteps: Math.max(0, maxSteps - 1),
        signal,
        onStep: (step) => {
          if (!seenFirst) {
            // Drop the prefilled duplicate of the edited step.
            seenFirst = true;
            return;
          }
          emitLiveStep(step);
        },
      });

      let continueResult: Trace | undefined;
      try {
        continueResult = await recorder.continueFrom(preCallMessages, 1);
      } catch (err) {
        if (err instanceof CapSentinel) {
          capHit = err.capError;
          endReason = "cap";
          // Fall through: liveSteps holds steps emitted so far.
        } else {
          throw err;
        }
      }
      if (continueResult) {
        endReason = continueResult.endReason ?? "stop";
      }
    }
    // finishReason === "stop": no further steps needed.
  }

  // 3. Assemble and save the full branch trace. The live steps already carry
  // their final branch ids (emitLiveStep stamped them), so no restamp is
  // needed and the ids the server streamed match the saved branch exactly.
  const branchTrace = assembleTrace(
    branchRunId,
    parentTrace,
    forkEdit.forkPointStepId,
    prefixSteps,
    liveSteps,
    endReason
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

// Assemble a complete branch Trace from its constituent parts. liveSteps holds
// the edited fork-point step followed by every live step, each already stamped
// with its final branch id.
function assembleTrace(
  branchRunId: string,
  parentTrace: Trace,
  forkPointStepId: string,
  prefixSteps: Step[],
  liveSteps: Step[],
  endReason: EndReason
): Trace {
  return {
    version: TRACE_VERSION,
    runId: branchRunId,
    createdAt: new Date().toISOString(),
    steps: [...prefixSteps, ...liveSteps],
    parentRunId: parentTrace.runId,
    forkPointStepId,
    endReason,
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
