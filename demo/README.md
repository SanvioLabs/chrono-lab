# Demo content

These files are synthetic content we wrote. They are made by
`scripts/make-demo.ts`, which records the deterministic fake model once and
forks that run once:

- `root-run.json`: a recorded root run (trace version 1.1.0) from the fake
  model.
- `prerecorded-future.json`: one forked future of the root run. Its
  `parentRunId` and `forkPointStepId` point at the root run.

Nothing here is collected from a real person. No real data, no third-party
transcript, no secret, key or token. To regenerate both files, run:

```
tsx scripts/make-demo.ts
```

The root run and the future seed two things in the lab: the empty state shows a
run to open before anyone records one, and demo mode returns the future when the
AI budget is spent or the model is down.
