// scripts/make-demo.ts
// Generates the synthetic demo content in demo/ (Task 4, C-02).
//
// Records the fake model once to make a root run, forks that run at one step
// with one edit to make one future, and saves both with saveTrace. Run this
// script to produce demo/root-run.json and demo/prerecorded-future.json; both
// files are synthetic content we wrote, checked in and never collected from a
// real person.
//
// Usage: tsx scripts/make-demo.ts
//
// The files it writes are valid 1.1.0 traces. The future carries parentRunId
// and forkPointStepId pointing at the root run. saveTrace scrubs every trace
// before it hits disk, and the fake model emits only plain text, so no scrub
// pattern matches either file.

import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs/promises";
import { Recorder } from "../src/recorder/recorder.js";
import { forkTrace } from "../src/compare/fork.js";
import { makeFakeModel } from "../src/agent/fake-model.js";
import { saveTrace } from "../src/trace/save.js";
import type { ModelCallStep } from "../src/trace/types.js";

// The demo/ directory sits next to this script's parent (the repo root).
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const demoDir = path.join(repoRoot, "demo");

async function main(): Promise<void> {
  // A scratch dir for the fork's own save; we re-save the results into demo/.
  const scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-make-demo-"));

  const fake = makeFakeModel();

  // 1. Record the root run with the fake model: model_call, tool_call,
  //    tool_result, model_call.
  const recorder = new Recorder({
    modelAdapter: fake.modelAdapter,
    toolRegistry: fake.toolRegistry,
    traceDir: scratchDir,
    modelName: "fake",
  });
  const rootRun = await recorder.run("Echo hello back to me.");

  // 2. Fork the root run at its first model_call step with one model edit, and
  //    run forward live. The fake model's later turns drive a stable future.
  const firstModelStep = rootRun.steps.find(
    (s): s is ModelCallStep => s.kind === "model_call"
  );
  if (firstModelStep === undefined) {
    throw new Error("The recorded root run has no model_call step to fork at.");
  }

  // Reset the fake model's cursor so the fork's live phase starts a fresh,
  // deterministic sequence.
  fake.reset();

  const forkResult = await forkTrace({
    parentTrace: rootRun,
    forkEdit: {
      forkPointStepId: firstModelStep.id,
      edit: { kind: "model_call", field: "model", value: "fake" },
    },
    modelAdapter: fake.modelAdapter,
    toolRegistry: fake.toolRegistry,
    traceDir: scratchDir,
    capConfig: { sessionLimitUsd: 10, overallLimitUsd: 100 },
  });

  if (forkResult.status !== "ok") {
    throw new Error(
      `Expected the fork to succeed, got status "${forkResult.status}".`
    );
  }

  // 3. Save both traces into demo/. saveTrace scrubs and writes atomically.
  await fs.mkdir(demoDir, { recursive: true });
  await saveTrace(rootRun, path.join(demoDir, "root-run.json"));
  await saveTrace(forkResult.branch, path.join(demoDir, "prerecorded-future.json"));

  // Clean up the scratch dir.
  await fs.rm(scratchDir, { recursive: true, force: true });

  // eslint-disable-next-line no-console
  console.log(
    `Wrote demo/root-run.json (runId ${rootRun.runId}) and ` +
      `demo/prerecorded-future.json (runId ${forkResult.branch.runId}, ` +
      `forkPointStepId ${forkResult.branch.forkPointStepId}).`
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
