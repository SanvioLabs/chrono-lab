# How we used Kiro

A dated line each time a Kiro feature does real work on Chrono-Lab. This becomes
the write-up for the submission, so note what happened, including what didn't
work.

| Date | Feature | What it did | What we learned |
|---|---|---|---|
| 2026-11-03 | (before Kiro) | The starter kit's steering files and spec prompts were drafted in Claude Code as planning. No application code came from it | Planning happened outside Kiro; everything from spec 01 on is Kiro |
| 2026-11-03 | Kiro CLI, spec mode (`kiro-cli chat --v3 --mode spec --no-interactive`), started from Claude Code | Wrote spec 01's requirements, design and tasks from `kiro-prompts/01-trace-and-replay.md`, with read and write tools only | A headless spec run works, but folder creation needs a write tool, not a shell tool. It ignored "property tests first" and used em dashes |
| 2026-11-03 | Steering | Added `.kiro/steering/writing.md` (no em dashes, product vocabulary) after the first spec run | A style rule belongs in steering, not in each prompt |
| 2026-11-03 | Kiro CLI, spec mode, second pass | Revised spec 01 against a nine-point review: replay reuses recorded ids, the network guard covers `fetch` and sockets, the hex scrub pattern is gone, replay takes a stop-at-step boundary for spec 02, tests come before code | Kiro took a written review and fixed all nine points in one run. The spec review caught real bugs before any code existed |
| 2026-11-04 | Kiro CLI (`--v3`), build session, started from Claude Code | Wrote all spec 01 source and tests (`src/trace/`, `src/recorder/`, `src/replay/`, `tests/`) from tasks.md in one session | The shell tool wasn't trusted (`--trust-tools` named `shell`, which this version didn't accept), so no command ran. Tests were written before code in file order, but never seen failing. Claude Code ran install, typecheck and tests afterwards: 11 passed, 2 failed |
| 2026-11-04 | Kiro CLI (`--v3`), fix session | Fixed both failures from the first `vitest` run. The network guard assigned to `import * as http` namespace objects, which are read-only at runtime, so it switched to the mutable default imports. Replay seeded its first message with a hard-coded string, so strict mode rejected step one; it now uses the recorded input. Also wrote `tests/gate/gate.test.ts` for the spec's gate | `tsc` passed while the code was broken: both bugs only showed up when the tests ran |
| 2026-11-04 | Kiro CLI (`--v3`), zero-network test rewrite | A mutation check (Claude Code commented out the `fetch` guard) showed the zero-network test still passed: it never called a guarded surface during replay. Kiro split the guard into `withNetworkGuard`, gave each of six surfaces its own failing case, and added a test that `replayTrace` runs under the guard. Re-checked: removing any one patch, or the guard itself, now fails a test | A passing property test can still test nothing. The mutation check found it, not the test run |
| | | | |
