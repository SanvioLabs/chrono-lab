# Spec 04: the demo agent and demo mode

Paste the prompt below into a new Kiro **Spec** session.

---

Write a spec for the agent judges will run in Chrono-Lab, and for demo mode.

The demo agent:

- Does one small, visibly multi-step task where one changed step plausibly
  changes the ending. Propose three candidate tasks in the design and recommend
  one. A good one makes the "what if" obvious to someone watching a video
- Uses only fake, sandboxed tools from `tech.md`: in-memory files, a canned
  lookup, a calculator. Nothing reaches the real network or file system
- Takes between 5 and 15 steps on a typical run

Demo mode:

- Ships prerecorded runs and prerecorded futures for the most interesting fork
  points, all synthetic content we wrote
- Switches on by itself when a spend cap is hit or the model fails, and can be
  switched on by hand
- Behaves the same in the UI as live mode, except for the banner

Include tests proving no demo-agent tool can reach the network or the real file
system.

The gate for this spec: with the API key removed, a visitor can still do a full
rewind and compare in demo mode.
