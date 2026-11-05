// tests/gate/gate.test.ts
// Automates the Task 11 gate checks end-to-end.
// Records a stand-in run to a temporary file, replays it, and verifies:
//   1. The replayed final answer is "Final answer: hello".
//   2. Step ids and durationMs match the recording.
//   3. The saved file contains no string matching sk-[A-Za-z0-9_\-]{20,}.
//   4. Loading the file with version "99.0.0" throws TraceVersionError naming "99.0.0".

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { Recorder } from "../../src/recorder/recorder.js";
import { replayTrace } from "../../src/replay/replay.js";
import { loadTrace } from "../../src/trace/save.js";
import { TraceVersionError } from "../../src/trace/version.js";
import { makeStandInAdapters } from "../fixtures/stand-in-agent.js";
import type { Trace, ModelCallStep } from "../../src/trace/types.js";

let tmpDir: string;
let tracePath: string;
let recorded: Trace;
let replayed: Trace;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-gate-"));

  const adapters = makeStandInAdapters();
  const recorder = new Recorder({
    modelAdapter: adapters.modelAdapter,
    toolRegistry: adapters.toolRegistry,
    traceDir: tmpDir,
  });

  recorded = await recorder.run("hello");
  tracePath = path.join(tmpDir, `${recorded.runId}.json`);

  adapters.reset();
  replayed = await replayTrace(recorded);
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true });
});

describe("gate: end-to-end record and replay", () => {
  it("replayed final answer is 'Final answer: hello'", () => {
    // The last model_call step carries the final answer.
    const modelSteps = replayed.steps.filter(
      (s): s is ModelCallStep => s.kind === "model_call"
    );
    const finalModelStep = modelSteps[modelSteps.length - 1];
    expect(finalModelStep).toBeDefined();
    expect(finalModelStep!.output.message.content).toBe("Final answer: hello");
  });

  it("replayed step ids match the recording", () => {
    expect(replayed.steps.length).toBe(recorded.steps.length);
    for (let i = 0; i < recorded.steps.length; i++) {
      expect(replayed.steps[i]!.id).toBe(recorded.steps[i]!.id);
    }
  });

  it("replayed durationMs values match the recording", () => {
    for (let i = 0; i < recorded.steps.length; i++) {
      expect(replayed.steps[i]!.durationMs).toBe(recorded.steps[i]!.durationMs);
    }
  });

  it("saved trace file contains no API key patterns", async () => {
    const raw = await fs.readFile(tracePath, "utf-8");
    // Verifies the scrub ran even though the stand-in adapter never emits
    // a real key. Pattern covers OpenAI-style and Anthropic-style keys.
    expect(raw).not.toMatch(/sk-[A-Za-z0-9_\-]{20,}/);
  });

  it("loading the trace with version '99.0.0' throws TraceVersionError naming '99.0.0'", async () => {
    // Read the saved file and inject a fake version string.
    const raw = await fs.readFile(tracePath, "utf-8");
    const patched = raw.replace(/"version"\s*:\s*"[^"]*"/, '"version": "99.0.0"');

    // Write to a sibling path so we can load it via loadTrace.
    const patchedPath = path.join(tmpDir, "patched-99.json");
    await fs.writeFile(patchedPath, patched, "utf-8");

    let caught: unknown;
    try {
      await loadTrace(patchedPath);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TraceVersionError);
    expect((caught as TraceVersionError).message).toContain("99.0.0");
    expect((caught as TraceVersionError).version).toBe("99.0.0");
  });
});
