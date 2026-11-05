# Spec 02: Fork and Compare: Requirements

**Date:** 2026-11-04
**Scope:** forking a timeline at any step, running forward live from the edit,
and comparing two branches.

**Builds on:** spec 01. The `Trace` and `Step` types, `Recorder`,
`replayTrace` with `stopAtStepId`, and `withNetworkGuard` are all in use here
and are not re-specified.

---

## Background

A user has a recorded run. They want to change exactly one step and see what
happens next without touching the original. This spec adds the three operations
that make that possible: fork, live run, and compare.

The gate for this spec is:

> Change one step of a recorded run, get a second future, and see the
> comparison.

---

## Glossary

Words from `product.md` used throughout:

| Word | Means |
|---|---|
| Run | One execution of an agent on one task |
| Step | One unit on the timeline: a model call, a tool call, or a tool result |
| Timeline | The ordered steps of one run |
| Branch | A timeline that shares a prefix with its parent and differs from the fork point on |
| Fork point | The step that was edited to create a branch |
| Future | Everything a branch produced after its fork point |
| Replay | Re-producing recorded steps from the recording, with no live calls |

---

## Requirements

### R-01: Editable fields at a fork point

**EARS:** When a user selects a step as the fork point, the system shall accept
an edit to exactly one of the following fields on that step:

- For a `model_call` step: the `input.messages` array (the prompt), the
  `model` identifier, or the `settings` object.
- For a `tool_result` step: the `output.result` value.

The system shall not permit edits to `tool_call` steps, to structural fields
(`id`, `runId`, `parentId`, `branch`, `forkPointId`, `kind`, `durationMs`), or
to more than one field at a time.

### R-02: Forking creates a new branch

**EARS:** When the system forks at a step, it shall:

1. Replay all steps before the fork point from the recording, making zero model
   or tool calls. These replayed steps keep their original `id`, `runId`, and
   `durationMs` values and carry the original `branch` identifier. They carry
   `live: false`.
2. Produce the edited step at the fork point. The two edit cases differ:

   **Case A: `tool_result` edit.** The user supplies a new `output.result`
   value. Copy the fork-point step, apply the new result, assign a new `id`,
   set `branch` to the new branch id, set `forkPointId` to the original
   step's `id`, set `live: false`, and set `edited: true`. This step holds
   only a user edit; no live call is made for it. The first live step is the
   next model call the agent makes when run forward.

   **Case B: `model_call` edit** (prompt, model, or settings). The user
   supplies a new input. The old output belongs to the old input and is not
   carried forward. Run the edited model call live immediately to obtain its
   real output. The result is a single step at the fork point: copy the
   fork-point step structure, apply the new input fields, fill in the live
   output, assign a new `id`, set `branch` to the new branch id, set
   `forkPointId` to the original step's `id`, set `live: true`, and set
   `edited: true`. There is no separate placeholder step. This one step is
   both the record of the user's edit and the first live step of the future.

3. Run the agent forward from the edited step using live model and tool calls.
   Each live step gets the new branch id, `forkPointId` set to the original
   fork-point step's `id`, and `live: true`.
4. Save the branch as a new trace file. The new `Trace` carries the new
   branch's `runId`, and two new root fields: `parentRunId` (the `runId` of the
   original trace) and `forkPointStepId` (the `id` of the step that was
   edited).

### R-03: The parent branch is never changed

**EARS:** When the system forks a branch, it shall leave the parent trace file
and the parent trace object unchanged. No field on any parent step shall be
added, removed, or modified. No new file shall overwrite the parent trace file.

### R-04: Live steps are marked

**EARS:** When the system records a live step after a fork point, that step
shall carry `live: true`. Steps produced by replay shall carry `live: false`.
The field shall be present on every step; there is no default-by-absence. A
step that holds a user edit (as described in R-02) shall also carry
`edited: true`; all other steps carry `edited: false`. The two flags combine as
follows: a Case A edited step carries `live: false, edited: true`; a Case B
edited step carries `live: true, edited: true`; every other future step carries
`live: true, edited: false`; replayed prefix steps carry `live: false,
edited: false`.

### R-05: Spend caps are checked before every live call

**EARS:** Before each live model call in a forked run, the system shall check
the session spend cap and the overall spend cap. The check shall use the
session's actual spend so far plus an upper-bound estimate derived from the
call's `maxTokens` setting and the model's published per-token price. When
either cap would be exceeded, the system shall stop the forked run cleanly,
record a `ForkCapHit` result on the branch, and surface the reason to the
caller without throwing an unhandled error. The partial branch (the replayed
prefix plus any live steps completed so far) shall be saved before returning.
After each live model call completes, the call's actual cost (from the step's
`cost` field) shall be added to both the session total and the overall total so
that the next check reflects the true spend. Model prices (per input token and
per output token) come from a price table keyed by model identifier, defined in
`src/server/caps.ts`. Prices are intentionally conservative upper bounds.

### R-06: Comparing two branches

**EARS:** When the system compares two branches, it shall report:

- The index of the first step where the two timelines differ, together with the
  step id from each side at that index, or `null` if no difference exists. The
  comparison field for this is `firstDiff: { index, aStepId, bStepId } | null`.
- The final output content of each branch (the `output.message.content` of the
  last `model_call` step, or `null` if none exists).
- For each branch: the total tokens (sum of `tokens.input + tokens.output`
  across all `model_call` steps in the stats window), the total cost (sum of
  `cost` across all `model_call` steps in the stats window), and the total
  duration (sum of `durationMs` across all steps in the stats window).

The comparison aligns the two full step lists from index 0 and walks them in
parallel. At each index a step pair is compared on `kind`, `input` (deep), and
`output` (deep); the fields `id`, `branch`, `live`, `edited`, and `durationMs`
are ignored. The first index where any compared field differs is the split
point. The stats window for each side is all steps from the split point to the
end of that trace's step list. For a root run compared against one of its
branches this approach naturally finds where the branch diverges, because the
root's steps before the fork point and the branch's replayed prefix are
identical on the compared fields. If both step lists agree on every shared
index, the extra steps of the longer trace open the stats window at the index
one past the last shared step.

### R-07: Compare is symmetric

**EARS:** When the system compares branch A to branch B, the result shall be
the mirror of comparing branch B to branch A. Specifically: `firstDiff.index`
shall be the same in both directions; `firstDiff.aStepId` in one call shall
equal `firstDiff.bStepId` in the other; and the per-branch statistics for A in
one call shall equal the per-branch statistics for B in the other. No field in
the result shall depend on the order the two branches are passed to the compare
function.

---

## Changes to spec 01 code

Four additions are needed. None remove or rename anything spec 01 exports.

### C-01: `live` and `edited` fields on `BaseStep`

Add `live: boolean` and `edited: boolean` to `BaseStep` in
`src/trace/types.ts`. Every step produced by `Recorder` in a straight run sets
`live: false` and `edited: false`. Every step produced during replay sets
`live: false` and `edited: false`. Every step produced by a live call after a
fork point sets `live: true` and `edited: false`. A user-edit step sets
`live` and `edited` according to its case: Case A sets `live: false,
edited: true`; Case B sets `live: true, edited: true`.

This is a schema change. The trace version bumps from `"1.0.0"` to `"1.1.0"`.
`KNOWN_VERSIONS` gains `"1.1.0"`. `migrateTrace` gains a `"1.0.0"` arm that
copies all steps and sets `live: false` and `edited: false` on each.

### C-02: `parentRunId` and `forkPointStepId` on `Trace`

Add two optional fields to `Trace`:

- `parentRunId?: string`: the `runId` of the trace this branch was forked
  from. Absent on the root run.
- `forkPointStepId?: string`: the `id` of the step that was edited. Absent on
  the root run.

These are optional so that spec 01 traces remain valid after migration. When a
root field is absent it is omitted entirely from the serialised trace; keys
must not be written with value `undefined` (JSON would silently drop them,
making the serialised and in-memory forms inconsistent).

### C-03: `Recorder` accepts branch context and a `continueFrom` entry point

Add optional constructor fields to `RecorderOptions`:

- `branch?: string`: the branch id to stamp on every step. Defaults to
  `"main"` when absent.
- `forkPointId?: string`: the `forkPointId` to stamp on every step. Defaults
  to `null` when absent.

No change to the `run(task)` signature.

Add a second entry point to `Recorder`:

```typescript
continueFrom(
  messages: ModelCallInput["messages"],
  firstStepIndex: number
): Promise<Trace>
```

This entry point starts the agent loop with an existing message list instead of
building one from a task string. The caller supplies the message history up to
and including the output of the edited step. `firstStepIndex` is the step index
counter to start from (so generated ids do not collide with ids already
assigned to prefix steps). The loop body is identical to `run`; the only
difference is the starting message list and index.

For a `tool_result` edit the message list passed to `continueFrom` includes
the original model call that requested the tool, the original tool call
message, and the edited tool result message. The first live step is the next
model call.

For a `model_call` edit the edited step has already been run live (its output
fills in the step) before `continueFrom` is called. The message list passed to
`continueFrom` includes all messages up through the edited model call's output.
The recorder continues from the next step.

### C-04: Network guard scope

`withNetworkGuard` in `src/replay/replay.ts` covers only the replay phase
(the call to `replayTrace`). The live phase (`continueFrom` or subsequent live
calls) runs outside the guard. A test must confirm this: start the live phase,
verify that a real network call is not blocked by the guard.
