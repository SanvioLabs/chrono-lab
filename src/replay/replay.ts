// src/replay/replay.ts
// Replay a recorded trace without making any live calls.

// Default imports give back the mutable CommonJS module object that Node
// exposes. Namespace imports (`import * as http`) produce a sealed ES module
// namespace object; assigning to its properties throws a TypeError.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import type {
  Trace,
  Step,
  ModelCallStep,
  ToolCallStep,
  ToolResultStep,
  ModelCallInput,
} from "../trace/types.js";
import { TRACE_VERSION } from "../trace/types.js";
import type { ModelAdapter, ToolRegistry } from "../recorder/types.js";
import { ReplayError, NetworkAccessDuringReplayError } from "./errors.js";

export interface ReplayOptions {
  // Default: true. When true, stubs verify that live inputs match the recording.
  strict?: boolean;
  // Default: null (replay to the end). When set, stop after producing that step id.
  stopAtStepId?: string | null;
}

// Iterate through recorded steps by kind.
class StepIterator {
  private index = 0;

  constructor(private readonly steps: readonly Step[]) {}

  // Return the next step of the given kind, or throw ReplayError if none remains.
  next<K extends Step["kind"]>(
    kind: K,
    contextId: string
  ): Extract<Step, { kind: K }> {
    while (this.index < this.steps.length) {
      const step = this.steps[this.index];
      if (step === undefined) break;
      if (step.kind === kind) {
        this.index++;
        return step as Extract<Step, { kind: K }>;
      }
      // Skip non-matching steps (tool_call and tool_result come in pairs
      // interleaved with model_calls; the recorder drives the order).
      this.index++;
    }
    throw new ReplayError(
      contextId,
      `No remaining recorded step of kind "${kind}".`
    );
  }

  // Peek at the next step without consuming it.
  peek(): Step | undefined {
    return this.steps[this.index];
  }
}

// Snapshot of the original network surfaces captured at module load time,
// before any guard or test can replace them.
// Exported so tests can compare by identity after the guard finishes.
export interface NetworkOriginals {
  httpRequest: typeof http.request;
  httpGet: typeof http.get;
  httpsRequest: typeof https.request;
  httpsGet: typeof https.get;
  fetch: typeof globalThis.fetch;
  netConnect: typeof net.connect;
  netCreateConnection: typeof net.createConnection;
  tlsConnect: typeof tls.connect;
  dnsLookup: typeof dns.lookup;
  dnsResolve: typeof dns.resolve;
}

// Captured once when the module is first imported. withNetworkGuard always
// restores to these values, so identity comparisons in tests are reliable.
export const MODULE_ORIGINALS: NetworkOriginals = {
  httpRequest: http.request,
  httpGet: http.get,
  httpsRequest: https.request,
  httpsGet: https.get,
  fetch: globalThis.fetch,
  netConnect: net.connect,
  netCreateConnection: net.createConnection,
  tlsConnect: tls.connect,
  dnsLookup: dns.lookup,
  dnsResolve: dns.resolve,
};

// Patch all network surfaces to throw NetworkAccessDuringReplayError,
// call fn(), then restore every original in a finally block.
// Exported so tests can exercise the guard directly without going through
// replayTrace.
export async function withNetworkGuard<T>(fn: () => Promise<T>): Promise<T> {
  const block = (surface: string) => (): never => {
    throw new NetworkAccessDuringReplayError(surface);
  };

  // Apply patches to the mutable default-import objects.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (http as any).request = block("http.request");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (http as any).get = block("http.get");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (https as any).request = block("https.request");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (https as any).get = block("https.get");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).fetch = block("globalThis.fetch");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (net as any).connect = block("net.connect");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (net as any).createConnection = block("net.createConnection");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (tls as any).connect = block("tls.connect");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dns as any).lookup = block("dns.lookup");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (dns as any).resolve = block("dns.resolve");

  try {
    return await fn();
  } finally {
    // Restore from module-load-time originals so identity comparisons pass.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (http as any).request = MODULE_ORIGINALS.httpRequest;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (http as any).get = MODULE_ORIGINALS.httpGet;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (https as any).request = MODULE_ORIGINALS.httpsRequest;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (https as any).get = MODULE_ORIGINALS.httpsGet;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = MODULE_ORIGINALS.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (net as any).connect = MODULE_ORIGINALS.netConnect;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (net as any).createConnection = MODULE_ORIGINALS.netCreateConnection;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tls as any).connect = MODULE_ORIGINALS.tlsConnect;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dns as any).lookup = MODULE_ORIGINALS.dnsLookup;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dns as any).resolve = MODULE_ORIGINALS.dnsResolve;
  }
}

// Replay a recorded trace.
// Stub adapters return recorded outputs. Network access throws immediately.
// The returned Trace carries the original runId and step ids.
export async function replayTrace(
  trace: Trace,
  options: ReplayOptions = {}
): Promise<Trace> {
  return withNetworkGuard(() => runReplay(trace, options));
}

// Inner replay logic. Runs inside withNetworkGuard.
async function runReplay(trace: Trace, options: ReplayOptions): Promise<Trace> {
  const strict = options.strict !== false;
  const stopAtStepId = options.stopAtStepId ?? null;

  const iterator = new StepIterator(trace.steps);
  const outputSteps: Step[] = [];

  // Seed the message list from the first model_call step's recorded input.
  // This ensures strict-mode comparisons match: the recorded input contains
  // the original user message (task string), not a hardcoded placeholder.
  const firstModelStep = trace.steps.find(
    (s): s is ModelCallStep => s.kind === "model_call"
  );
  if (!firstModelStep) {
    // Empty trace: nothing to replay.
    return {
      version: TRACE_VERSION,
      runId: trace.runId,
      createdAt: trace.createdAt,
      steps: [],
    };
  }

  // Build stub model adapter.
  const modelAdapter: ModelAdapter = async (
    liveInput: ModelCallInput
  ): Promise<ModelCallStep["output"]> => {
    const recorded = iterator.next("model_call", "unknown");

    if (strict) {
      const liveJson = JSON.stringify(liveInput);
      const recordedJson = JSON.stringify(recorded.input);
      if (liveJson !== recordedJson) {
        throw new ReplayError(
          recorded.id,
          `model_call input mismatch.\nRecorded: ${recordedJson}\nLive: ${liveJson}`
        );
      }
    }

    // Copy the full recorded step into the output list.
    outputSteps.push({ ...recorded });

    return recorded.output;
  };

  // Build stub tool registry.
  // All tool names are handled by a single proxy that looks up the recorded step.
  const toolRegistryHandler: ProxyHandler<ToolRegistry> = {
    get(_target, prop: string): (args: Record<string, unknown>) => Promise<unknown> {
      return async (liveArgs: Record<string, unknown>): Promise<unknown> => {
        const recorded = iterator.next("tool_call", "unknown");

        if (strict) {
          if (recorded.input.name !== prop) {
            throw new ReplayError(
              recorded.id,
              `tool name mismatch: recorded "${recorded.input.name}" vs live "${prop}"`
            );
          }
          const liveArgsJson = JSON.stringify(liveArgs);
          const recordedArgsJson = JSON.stringify(recorded.input.arguments);
          if (liveArgsJson !== recordedArgsJson) {
            throw new ReplayError(
              recorded.id,
              `tool_call arguments mismatch for "${prop}".\nRecorded: ${recordedArgsJson}\nLive: ${liveArgsJson}`
            );
          }
        }

        // Copy the tool_call step.
        outputSteps.push({ ...recorded });

        // Now get the paired tool_result step.
        const resultRecorded = iterator.next("tool_result", recorded.id);
        outputSteps.push({ ...resultRecorded });

        return resultRecorded.output.result;
      };
    },
  };

  const toolRegistry: ToolRegistry = new Proxy({} as ToolRegistry, toolRegistryHandler);

  // Use the first recorded model_call's input messages as the starting point.
  // This reproduces the exact message list the recorder had at its first call.
  const messages: ModelCallInput["messages"] = [
    ...firstModelStep.input.messages,
  ];

  let continueLoop = true;

  while (continueLoop) {
    // Check stopAtStepId: if the next recorded step is past the stop point, halt.
    if (stopAtStepId !== null) {
      const nextRecorded = iterator.peek();
      if (nextRecorded === undefined) break;
      if (outputSteps.some((s) => s.id === stopAtStepId)) {
        break;
      }
    }

    const modelOutput = await modelAdapter({
      messages: [...messages],
      model: "stub",
      settings: {},
    });

    messages.push(modelOutput.message);

    // Check stop after model call.
    if (stopAtStepId !== null) {
      const lastPushed = outputSteps[outputSteps.length - 1];
      if (lastPushed && lastPushed.id === stopAtStepId) break;
    }

    if (
      modelOutput.finishReason === "tool_calls" &&
      modelOutput.toolCalls &&
      modelOutput.toolCalls.length > 0
    ) {
      for (const toolCallSpec of modelOutput.toolCalls) {
        const toolFn = toolRegistry[toolCallSpec.name];
        if (!toolFn) {
          throw new ReplayError(
            "unknown",
            `No stub for tool "${toolCallSpec.name}"`
          );
        }
        const result = await toolFn(toolCallSpec.arguments);

        messages.push({
          role: "tool",
          content: String(result),
          toolCallId: toolCallSpec.id,
        });

        // Check stop after tool result.
        if (stopAtStepId !== null) {
          const lastPushed = outputSteps[outputSteps.length - 1];
          if (lastPushed && lastPushed.id === stopAtStepId) break;
        }
      }
    } else {
      continueLoop = false;
    }
  }

  return {
    version: TRACE_VERSION,
    runId: trace.runId,
    createdAt: trace.createdAt,
    steps: outputSteps,
  };
}
