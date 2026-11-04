# Spec 01: Trace and Replay: Requirements

**Date:** 2026-11-03
**Scope:** the trace format, the recorder that wraps a simple agent loop, and
replay from a recorded trace.

---

## Background

Chrono-Lab records an agent run as an ordered list of steps, then replays it
deterministically. Replay holds the past fixed so that exactly one change can
be tested. Everything else in the product depends on these three pieces working
correctly together.

This spec covers the minimum needed to reach the gate:

> A recorded run replays to the same final answer with zero model calls.

The full demo agent (spec 04), fork/branch (spec 02), and the UI (spec 03) are
out of scope here. The agent used in this spec is a minimal stand-in: one model
call followed by one fake tool call.

---

## Glossary

Words from `product.md` used here:

| Word | Means |
|---|---|
| Run | One execution of an agent on one task |
| Step | One unit on the timeline: a model call, a tool call, or a tool result |
| Timeline | The ordered steps of one run |
| Replay | Re-producing recorded steps from the recording, with no live calls |

---

## Requirements

### R-01: Recording captures every step

**EARS:** While the recorder is active, when the agent loop produces a model
call, a tool call, or a tool result, the system shall write that event as a
step in the trace with the following fields:

- `id`: a stable identifier unique within the run
- `runId`: the identifier of the run this step belongs to
- `parentId`: the `id` of the immediately preceding step, or `null` for the
  first step
- `kind`: one of `"model_call"`, `"tool_call"`, or `"tool_result"`
- `input`: the full input as recorded (prompt messages for a model call; tool
  name and arguments for a tool call; the originating tool-call id for a tool
  result)
- `output`: the full output as recorded (model response text and finish reason
  for a model call; structured result for a tool result; `null` for a tool call
  until its result arrives)
- `model`: the model identifier for a model call; `null` for tool steps
- `settings`: the inference settings (temperature, max tokens, etc.) for a
  model call; `null` for tool steps
- `tokens`: `{ input: number; output: number }` for a model call; `null` for
  tool steps
- `cost`: estimated cost in USD as a number for a model call; `null` for tool
  steps
- `durationMs`: wall-clock duration of the step in milliseconds
- `branch`: the branch identifier this step belongs to (`"main"` for the
  initial run)
- `forkPointId`: the `id` of the fork-point step if this step begins a branch;
  `null` otherwise

### R-02: Persisting a trace

**EARS:** When a run completes, the system shall save the trace to a file that
includes:

- a `version` field set to the current schema version string
- a `runId` field matching the run
- a `createdAt` ISO-8601 timestamp
- the ordered array of all steps

**EARS:** When the saved file is loaded back, the system shall produce a trace
object that deep-equals the object that was saved (no field loss, no precision
loss). Additionally, saving the same in-memory trace object twice shall
produce byte-for-byte identical files, because JSON serialisation is
deterministic given the same input.

### R-03: Replay reproduces every step exactly

**EARS:** When the system replays a recorded trace, it shall reproduce each
step in the original order with the same `id`, `runId`, `kind`, `input`,
`output`, `model`, `settings`, `tokens`, `cost`, and `durationMs` as the
recorded step. Specifically:

- Step `id` values come directly from the recorded trace, not from a new
  id-generation sequence.
- `durationMs` on each replayed step equals the `durationMs` stored in the
  recording, not a newly measured wall-clock duration.

### R-04: Replay makes no live calls

**EARS:** While the system is replaying a recorded trace, it shall make zero
network requests. Any attempt to open a network connection (HTTP, HTTPS, or raw
TCP/TLS) shall cause the replay to fail immediately with a
`NetworkAccessDuringReplayError`.

### R-05: Replay stubs tools with their recorded results

**EARS:** While the system is replaying a recorded trace, when the agent loop
invokes a tool, the system shall return the recorded tool result for that
invocation rather than executing the tool, so that the tool's real
implementation is never called.

### R-06: Version rejection

**EARS:** When the system attempts to load a trace file whose `version` field
is not recognised by the current loader, the system shall refuse to load the
file and shall surface an error message that names the unknown version and
states that the file cannot be loaded.

### R-07: API key scrubbing

**EARS:** Before a trace is written to disk, the system shall scan every
string field in every step and replace any substring that matches a known API
key pattern (see design for the pattern list) with the literal string
`"[REDACTED]"`, so that no secret credential appears in the saved file.

The patterns must not match step `id`, `runId`, or other structural identifier
fields. The save-load round-trip property holds: `load(save(t))` deep-equals
`scrub(t)`, and scrubbing an already-scrubbed trace is idempotent.

Test fixtures must not contain strings that any scrub pattern would match
unless the test is specifically about scrubbing.

---

## Gate

The spec is done when a recorded run of the stand-in agent replays to the same
final answer with zero model calls, and the property-based tests in tasks.md
all pass.
