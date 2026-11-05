# Chrono-Lab

A time machine for AI agents. Rewind a run, change one step, and compare the
futures.

An agent run is a chain of decisions: a prompt, a model reply, a tool call, a
result, the next reply. When the run goes wrong, you usually can't tell which
link broke it. Chrono-Lab records every step, lets you jump back to any one of
them and change it, then plays the run forward from that point. The original
timeline stays as it was. You get both futures next to each other, with what
changed, what it cost, and where they split.

Built for [Kiroween 2026](https://kiroween.devpost.com/), in
[Kiro](https://kiro.dev).

> Status: in progress. Recording, replay, fork and compare are built (specs 01
> and 02). The lab UI (spec 03) is being built. `KICKOFF.md` says how to join in.

## What it does

1. **Record.** Run the demo agent and every step lands on a timeline: what went
   in, what came out, the tokens and the time it took
2. **Rewind.** Pick any step. Everything before it replays from the recording,
   so the past costs nothing and comes out the same every time
3. **Change one thing.** Edit that step's prompt, swap the model, or rewrite
   what a tool returned
4. **Run forward.** From that step on, the agent runs live and a new branch
   grows off the timeline
5. **Compare.** See the futures side by side: where they first differ, the final
   answers, and the cost of each

## Run it

To be written once there is something to run.

## How we built it with Kiro

See [`docs/kiro-usage.md`](docs/kiro-usage.md).

## Pre-existing material

The Kiroween rules require us to list anything we didn't write during the
hackathon.

- `.kiro/steering/harness-operating.md`, `harness-response-style.md` and
  `harness-data-and-tools.md`: copied from
  [sanvio-harness-starter](https://github.com/SanvioLabs/sanvio-harness-starter)
  at commit `4c9a782`, with links repointed at that repo and a Kiro frontmatter
  block added. MIT License, Copyright (c) 2026 Sanvio Labs, LLC.

## License

[MIT](LICENSE).
