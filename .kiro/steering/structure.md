---
inclusion: always
---

# Structure

A starting layout. Change it in the first spec if there's a better one, then
update this file.

```
chrono-lab/
├── .kiro/
│   ├── steering/        rules Kiro loads every session
│   ├── specs/           one folder per spec, written by Kiro
│   └── hooks/           written by Kiro
├── src/
│   ├── trace/           the trace format, load, save, migrate
│   ├── recorder/        wraps an agent loop and writes steps
│   ├── replay/          replay, fork, run forward
│   ├── compare/         diff two branches
│   ├── agent/           the demo agent and its fake tools
│   ├── server/          HTTP and caps
│   └── ui/              the lab
├── demo/                prerecorded runs and futures for demo mode
├── tests/
├── docs/
│   └── kiro-usage.md    dated log of how we used Kiro
├── kiro-prompts/        the prompts that started each spec
├── KICKOFF.md
└── README.md
```

## Conventions

- One spec per prompt in `kiro-prompts/`. When code under a spec's area
  changes, its `tasks.md` changes in the same commit
- Tests sit beside the area they test under `tests/`, named after it
- `demo/` holds only synthetic content we wrote. No real person's data, no
  third-party transcripts
- Small commits, each with a message saying what changed and why
