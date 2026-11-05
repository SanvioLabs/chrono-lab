// tests/demo/demo.test.ts
// Task 4 (C-02): the synthetic demo content loads and is clean.
//
// Loads demo/root-run.json and demo/prerecorded-future.json with loadTrace
// (so an unknown version would throw), checks the future's parentRunId and
// forkPointStepId point at the root run, and checks neither file contains a
// string any scrub pattern matches. scrubTrace applies every scrub pattern;
// running it over a loaded trace must be a no-op, which is the direct proof
// that no pattern matches.
//
// These assertions pass once scripts/make-demo.ts has produced the two files.
// Until the files exist, loadTrace rejects and every case fails.

import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTrace, scrubTrace } from "../../src/trace/save.js";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..", "..");
const demoDir = path.join(repoRoot, "demo");

describe("demo content (C-02)", () => {
  it("both files load with loadTrace without a version error", async () => {
    const root = await loadTrace(path.join(demoDir, "root-run.json"));
    const future = await loadTrace(
      path.join(demoDir, "prerecorded-future.json")
    );

    expect(root.version).toBe("1.1.0");
    expect(future.version).toBe("1.1.0");
    expect(root.steps.length).toBeGreaterThan(0);
    expect(future.steps.length).toBeGreaterThan(0);
  });

  it("the future's parentRunId and forkPointStepId point at the root run", async () => {
    const root = await loadTrace(path.join(demoDir, "root-run.json"));
    const future = await loadTrace(
      path.join(demoDir, "prerecorded-future.json")
    );

    // parentRunId is the root run's runId.
    expect(future.parentRunId).toBe(root.runId);

    // forkPointStepId names a real step in the root run.
    expect(typeof future.forkPointStepId).toBe("string");
    const forkStep = root.steps.find((s) => s.id === future.forkPointStepId);
    expect(forkStep).toBeDefined();
  });

  it("neither file contains a string any scrub pattern matches", async () => {
    for (const file of ["root-run.json", "prerecorded-future.json"]) {
      const trace = await loadTrace(path.join(demoDir, file));
      // scrubTrace applies every scrub pattern. If any pattern matched, the
      // scrubbed trace would differ from the loaded one. Equal serialisations
      // prove no pattern matches.
      const scrubbed = scrubTrace(trace);
      expect(JSON.stringify(scrubbed)).toBe(JSON.stringify(trace));
    }
  });
});
