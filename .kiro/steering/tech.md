---
inclusion: always
---

# Tech

A starting recommendation. The first spec settles it, and this file gets
updated to match what the spec decides.

## Stack

- **TypeScript** throughout, strict mode
- **One small server** that runs the demo agent and serves the UI. Node LTS
- **Plain web front end.** A light framework is fine if the spec makes the case.
  The timeline and branch tree are SVG
- **Storage:** JSON trace files or SQLite. No hosted database. Sessions expire
- **One AI model** for the demo agent, behind a spend cap. The model is a setting,
  so swapping it is one of the edits a user can make at a fork point
- **Tests:** a unit runner plus `fast-check` for property-based tests

## The trace is the contract

Everything reads and writes one trace format, so it is designed first and
changed carefully. Each step carries at least:

- a stable id, the run id, and the parent step id
- the kind: model call, tool call, or tool result
- the full input and full output as recorded
- model and settings for a model call
- tokens, cost and duration
- the branch it belongs to, and the fork point if it starts a branch

A trace file carries a version number. Loading an older version either migrates
it or refuses it clearly.

## Rules for replay

- Replay never makes a live call. A test proves it by failing on any network
  access during replay
- Replaying an unchanged prefix gives back exactly the recorded steps
- Forking copies nothing it doesn't have to and changes nothing in the parent
- Live steps after a fork are marked live, and the UI shows the difference

## Rules for the demo agent's tools

- Every tool is fake and sandboxed: an in-memory file system, a canned web
  lookup, a calculator. Nothing touches the real machine or the real network
- A tool result can be edited at a fork point like any other step

## Money

- A cap per session and an overall cap, both checked before each live call
- When a cap is hit, the app falls back to demo mode and says so. It never stalls
- Rate limits on the public URL from the first deploy

## Secrets

The model API key comes from the environment and is never written to a file,
a trace, a log or the UI. Traces are scrubbed of anything that looks like a key
before they are saved.
