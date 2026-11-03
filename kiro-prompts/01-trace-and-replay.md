# Spec 01: trace and replay

Paste the prompt below into a new Kiro **Spec** session.

---

Write a spec for the foundation of Chrono-Lab, described in the steering files.

Scope: the trace format, a recorder that wraps a simple agent loop, and replay.

Requirements I expect to see, in EARS form:

- Recording a run writes every model call, tool call and tool result as a step
  with the fields listed in `tech.md`
- A trace saves to a versioned file and loads back unchanged
- Replaying a recorded run reproduces every step exactly and makes no live
  model or network call
- Replay stubs each tool with its recorded result
- Loading a trace with an unknown version fails with a clear message
- Anything that looks like an API key is scrubbed before a trace is saved

In the design, include the trace schema as TypeScript types and a short
explanation of how replay avoids live calls.

In the tasks, put property-based tests with `fast-check` first for:

- save then load gives back an identical trace
- replay of a recorded run equals the recording, step for step
- replay performs zero network calls (fail the test on any attempt)

Use a minimal stand-in agent for this spec: one model call and one fake tool.
The full demo agent is spec 04.

The gate for this spec: a recorded run replays to the same final answer with
zero model calls.
