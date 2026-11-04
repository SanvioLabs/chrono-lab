# Spec 01: Trace and Replay: Design

**Date:** 2026-11-03

---

## Overview

Three modules, one shared contract:

```
src/trace/      the schema, save, load, migrate, scrub
src/recorder/   wraps an agent loop and writes steps
src/replay/     reads a trace and drives the agent loop without live calls
```

The trace is the contract. Everything else reads and writes it.

---

## Trace schema (TypeScript types)

```typescript
// src/trace/types.ts

export const TRACE_VERSION = "1.0.0";

// Step kinds
export type StepKind = "model_call" | "tool_call" | "tool_result";

// Inference settings passed to a model call.
export interface ModelSettings {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  [key: string]: unknown; // forward-compat: preserve unknown settings
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
  toolCallId?: string; // present on role:"tool"
}

// Per-kind input/output payloads

export interface ModelCallInput {
  messages: Message[];
  model: string;
  settings: ModelSettings;
}

export interface ModelCallOutput {
  message: Message;            // the assistant turn
  finishReason: string;        // "stop" | "tool_calls" | "length" | etc.
  toolCalls?: ToolCallSpec[];  // present when finishReason === "tool_calls"
}

export interface ToolCallSpec {
  id: string;        // opaque id the model assigned
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
  toolCallId: string; // references the originating tool_call step
}

export interface ToolResultOutput {
  result: unknown;    // the value returned by the tool
  isError: boolean;
}

// Step: discriminated union where kind determines which input/output shapes are valid.
export type Step =
  | ModelCallStep
  | ToolCallStep
  | ToolResultStep;

interface BaseStep {
  id: string;
  runId: string;
  parentId: string | null;
  durationMs: number;
  branch: string;         // "main" for the initial run; branch id after a fork
  forkPointId: string | null;
}

export interface ModelCallStep extends BaseStep {
  kind: "model_call";
  input: ModelCallInput;
  output: ModelCallOutput;
  model: string;
  settings: ModelSettings;
  tokens: TokenCounts;
  cost: number;           // estimated USD
}

export interface ToolCallStep extends BaseStep {
  kind: "tool_call";
  input: ToolCallInput;
  output: ToolCallOutput; // always null
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
  version: string;      // semver string; currently TRACE_VERSION
  runId: string;
  createdAt: string;    // ISO-8601
  steps: Step[];
}
```

### Why a discriminated union?

Each `kind` has a different set of meaningful fields (`model`, `settings`,
`tokens`, `cost` are only present on `model_call`). The union lets TypeScript
enforce this at compile time, and a `switch (step.kind)` exhausts all cases
without casts.

---

## src/trace: save, load, migrate, scrub

### Save

1. Scrub all string fields (see below).
2. Serialize to JSON with two-space indentation.
3. Write atomically: write to `<path>.tmp`, then `rename` to `<path>`.

Serialisation is deterministic: given the same in-memory `Trace` object,
`JSON.stringify` with a fixed replacer order produces the same bytes every
time, so the saved file is byte-for-byte stable across repeated saves of the
same object.

### Load

1. Read the file and `JSON.parse`.
2. Check `trace.version`. If it is not in `KNOWN_VERSIONS`, throw:
   ```
   TraceVersionError: unknown trace version "X.Y.Z"; cannot load this file.
   ```
3. If the version is older than the current but still known, run the migration
   chain (no migrations exist yet for v1.0.0; this is the stub for future use).
4. Return the `Trace` object.

Loading a saved trace produces a `Trace` that deep-equals the object that was
serialised (after scrubbing). Formally: `load(save(t))` deep-equals
`scrub(t)`.

### API key scrubbing

Before saving, `scrubTrace` walks every string value in the object tree and
applies `scrubString`. The patterns matched are:

| Key family | Pattern |
|---|---|
| OpenAI / Anthropic / generic bearer | `sk-[A-Za-z0-9_\-]{20,}` |
| Anthropic | `sk-ant-[A-Za-z0-9_\-]{20,}` |
| AWS-style access key | `AKIA[0-9A-Z]{16}` |

The generic 32-character hex pattern is intentionally excluded. Step `id` and
`runId` values are hex-like strings; matching them would corrupt the trace and
break replay. The three patterns above are specific enough to target real key
formats without false-positives on structural fields.

Any substring matching one of the three patterns is replaced with
`"[REDACTED]"`. Scrubbing is idempotent: applying it twice produces the same
result as applying it once.

The round-trip property: `load(save(t))` deep-equals `scrub(t)`.
Test fixtures must not contain strings that any scrub pattern matches unless
the test is specifically about scrubbing.

---

## src/recorder: wrapping an agent loop

The recorder sits between the caller and the agent loop. It is a thin wrapper
that intercepts every model call and every tool dispatch:

```
Caller
  └─► Recorder.run(task)
        ├─ generates runId (UUID), initialises Trace
        ├─ calls AgentLoop.step() in a loop
        │    ├─ before model call: start timer
        │    ├─ after  model call: write ModelCallStep
        │    ├─ before tool call: write ToolCallStep
        │    └─ after  tool call: write ToolResultStep
        └─ on completion: saves Trace to disk
```

The recorder receives two injectable dependencies:

- `modelAdapter`: a function `(input: ModelCallInput) => Promise<ModelCallOutput>`
- `toolRegistry`: a map from tool name to `(args) => Promise<unknown>`

This indirection is what makes replay possible: both can be replaced without
touching the recorder.

Step ids use the format `<runId>-<index>` where index is the zero-based
position of the step in the run. The `runId` is a UUID generated once per run.

---

## src/replay: how live calls are avoided

Replay never touches the real `modelAdapter` or the real `toolRegistry`.

### Step id and durationMs handling

Replay reuses the recorded step ids and the recorded `durationMs` directly.
The replay stub adapters do not measure wall-clock time and do not generate new
ids. Both values come from the recorded `Step` objects, so the replayed trace
is structurally identical to the original.

Concretely, the replay infrastructure does not call the recorder's id-generation
or timing code. Instead it builds each output step by copying the recorded step
and returning its `output` field from the stub adapter.

### Replay boundary parameter

`replayTrace` accepts an optional `stopAtStepId: string | null` parameter.
When `stopAtStepId` is `null` (the default for this spec), replay runs to the
end of the trace. When it is set, replay stops after producing the step with
that id and returns a partial trace. This parameter is designed now so that
spec 02 can pass a fork-point step id without changing the replay API.

### Strict-mode input checking

By default, `replayTrace` runs in strict mode. The stub adapters verify that
the live agent sends the same inputs as the recording:

- The model stub checks that the `input` passed to it deep-equals the `input`
  of the corresponding recorded `model_call` step.
- The tool stub checks that the tool `name` and `arguments` passed to it
  deep-equal those of the corresponding recorded `tool_call` step.

If either check fails, the stub throws `ReplayError` with a message naming the
first mismatching step id and describing the difference. Strict mode can be
disabled by passing `{ strict: false }` to `replayTrace`, but strict mode is
the default and is used in all tests in this spec.

### How replay works

1. Load the trace from disk (or accept it in-memory for tests).
2. Build a `StepIterator` over the recorded steps.
3. Construct stub adapters:

```
replay.modelAdapter(input)
  strict: assert input deep-equals recorded model_call step input,
    throwing ReplayError naming the step id on mismatch
  returns recorded step.output (including the recorded durationMs)
  throws ReplayError if no recorded model_call step remains

replay.toolRegistry[name](args)
  strict: assert name and args deep-equal the recorded tool_call step,
    throwing ReplayError naming the step id on mismatch
  returns recorded tool_result step.output.result
  throws ReplayError if the tool name does not match or no step remains
```

4. The replay infrastructure constructs output steps by copying each recorded
   step directly, preserving `id`, `runId`, `durationMs`, and all other fields.
5. The returned `Trace` carries the original `runId` and original step ids.

### Network guard

For the duration of the replay, the following are patched to throw
`NetworkAccessDuringReplayError` on any call:

- `http.request` and `http.get`
- `https.request` and `https.get`
- `globalThis.fetch` (Node 18+ built-in, used by most model SDKs)
- `net.connect` and `net.createConnection`
- `tls.connect`
- `dns.lookup` and `dns.resolve`

All originals are restored in a `finally` block after the agent loop ends,
whether replay succeeds or throws.

### Why patch the socket layer in addition to fetch and http/https?

Patching `http.request` and `https.request` alone does not catch
`globalThis.fetch` in Node 18+. That is backed by `undici` and bypasses the
`http`/`https` module entirely. Model SDKs (OpenAI, Anthropic) use `fetch` by
default. Patching `net.connect` and `tls.connect` catches any remaining code
that opens a raw socket, and patching `dns.lookup` stops hostname resolution
before a connection is even attempted. Together these layers make the
zero-network property verifiable regardless of which networking path a
dependency takes.

---

## Minimal stand-in agent

For this spec only, the agent is:

```
1. Send a system prompt + user task to the model.
2. The model responds with a tool call: echo(text).
3. The tool returns the text unchanged.
4. The model sees the result and returns a final answer.
```

Two model call steps, one tool call step, one tool result step: four steps
total. This is enough to exercise the recorder and replay end-to-end without
implementing the full demo agent.

---

## File layout produced by this spec

```
src/
  trace/
    types.ts          schema (types above)
    save.ts           saveTrace, loadTrace, scrubTrace
    version.ts        TRACE_VERSION, KNOWN_VERSIONS, migration stubs
  recorder/
    recorder.ts       Recorder class
    types.ts          ModelAdapter, ToolRegistry interfaces
  replay/
    replay.ts         replayTrace, stub adapters, network patch
    errors.ts         ReplayError, NetworkAccessDuringReplayError,
                      TraceVersionError
tests/
  trace/
    trace.property.test.ts   fast-check: save/load round-trip
  replay/
    replay.property.test.ts  fast-check: replay equals recording, zero
                             network calls (tests all patched surfaces)
  fixtures/
    stand-in-agent.ts        the minimal 4-step agent for tests
```

---

## Constraints carried forward

- The recorder must accept `modelAdapter` and `toolRegistry` as constructor
  parameters (not imports) so spec 02 can swap them freely.
- `Trace.version` is checked on every load, not just in tests.
- `KNOWN_VERSIONS` is the single authority on what can be loaded. Adding a
  version means adding it to this list and writing a migration (or confirming
  no migration is needed).
- The scrub runs on the in-memory object before serialisation, not on the JSON
  string, so structured data (nested objects) is covered.
- `replayTrace` exposes `stopAtStepId: string | null` from day one. Spec 02
  passes a fork-point step id to replay the prefix of a trace without changing
  the API.
