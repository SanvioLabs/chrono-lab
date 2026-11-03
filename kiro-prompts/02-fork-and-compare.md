# Spec 02: fork and compare

Start this once spec 01's gate has passed. Paste the prompt below into a new Kiro
**Spec** session.

---

Write a spec for forking a Chrono-Lab timeline and comparing two futures. It
builds on spec 01's trace format and replay.

Requirements I expect to see, in EARS form:

- A user can pick any step and edit one of: the prompt, the model, the model
  settings, or a tool result
- Forking at that step creates a new branch. Steps before the fork point are
  replayed, the edited step is applied, and steps after it run live
- Forking never changes the parent branch in any way
- Live steps are marked as live in the trace
- Comparing two branches reports the first step where they differ, both final
  outputs, and the tokens, cost and time of each
- Each live call checks the session and overall spend caps first. When a cap is
  hit, the fork stops cleanly and the user is told why

In the tasks, put property-based tests first for:

- a fork never mutates its parent
- the compare result is symmetric: comparing A to B mirrors comparing B to A
- two branches with no edit and replay-only steps compare as identical

The gate for this spec: change one step of a recorded run, get a second future,
and see the comparison.
