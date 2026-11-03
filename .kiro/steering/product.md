---
inclusion: always
---

# Product: Chrono-Lab

## The one sentence

A time machine for AI agents: rewind a run, change one step, and compare the
futures.

## Who it's for

People who build agents and can't tell why a run went wrong. A run is a chain of
model calls and tool calls, and today the only way to test "what if this step
had been different" is to run the whole thing again and hope the rest stays the
same. It doesn't, because models aren't deterministic. Chrono-Lab holds the past
fixed and changes exactly one thing.

## The core loop

1. Record a run as a timeline of steps
2. Rewind to a step. Steps before it replay from the recording, with no model
   calls
3. Edit that one step: its prompt, its model, its settings, or a tool's result
4. Run forward live from there. The result is a new branch; the parent is never
   changed
5. Compare two branches: the first step where they differ, the final outputs,
   tokens, cost and time

If a feature doesn't serve this loop, it waits.

## The words we use

| Word | Means |
|---|---|
| Run | One execution of an agent on one task |
| Step | One unit on the timeline: a model call, a tool call, or a tool result |
| Timeline | The ordered steps of one run |
| Branch | A timeline that shares a prefix with its parent and differs from the fork point on |
| Fork point | The step that was edited to create a branch |
| Future | Everything a branch produced after its fork point |
| Replay | Re-producing recorded steps from the recording, with no live calls |

Use these exact words in code, UI and docs. Don't invent synonyms.

## The lab theme

Kiroween is a Halloween hackathon. The look is a mad scientist's time lab at
night: dark, glowing readouts, branching timelines drawn like lightning or
cracks in glass, the past in cold blue and the new future in a warmer color.

The theme dresses a real tool. A developer should be able to use it with the
costume taken off. Every label still says plainly what it does.

## In scope

- A trace format and a recorder that wraps an agent loop
- Replay from the recording, with tools stubbed to their recorded results
- Fork at any step, edit it, run forward live
- Branch tree view and a side-by-side compare of two futures
- A small built-in demo agent with sandboxed, fake tools, so a judge can try it
  with nothing to set up
- A **demo mode** with prerecorded runs and prerecorded futures, so the app works
  when the AI budget is spent or the model is down
- Spend caps per session and overall

## Out of scope

- Recording agents running real tools with real side effects. Live branches only
  run the demo agent's fake tools
- Accounts or long-term storage. Sessions expire
- Uploading someone's own production traces to the public site

## Stretch, in cut order

Cut from the top when a weekly gate slips.

1. Import traces from a common agent framework's log format
2. Run several samples per branch to show the spread of outcomes, not one draw
3. An MCP proxy mode that records the tool calls of any MCP client
4. Sound and animation beyond the fork moment

**Never cut:** demo mode, spend caps, the sandbox on tools, the compare view.

## Judging

Five criteria, weighted equally: potential impact, technical implementation,
design, the idea itself, and presentation. Judges may score from the video and
text alone, so the 3-minute video has to show the full loop working.
