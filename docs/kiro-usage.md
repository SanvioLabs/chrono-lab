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
| | | | |
