// tests/trace/trace.property.test.ts
// Property-based tests for the save/load round-trip and scrub idempotency.
// Written before saveTrace and loadTrace exist (Task 4).
// Made passing in Task 5.

import { describe, it } from "vitest";
import * as fc from "fast-check";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { saveTrace, loadTrace, scrubTrace } from "../../src/trace/save.js";
import type {
  Trace,
  Step,
  ModelCallStep,
  ToolCallStep,
  ToolResultStep,
  Message,
  ModelSettings,
} from "../../src/trace/types.js";

// Safe string: does not match any scrub pattern so round-trip equality holds.
// The three banned patterns are:
//   sk-[A-Za-z0-9_-]{20,}
//   sk-ant-[A-Za-z0-9_-]{20,}
//   AKIA[0-9A-Z]{16}
// We generate short alphanum strings that cannot match any of these.
const safeString = fc
  .stringOf(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789"), {
    minLength: 1,
    maxLength: 12,
  })
  .filter(
    (s) =>
      !/sk-[A-Za-z0-9_\-]{20,}/.test(s) &&
      !/AKIA[0-9A-Z]{16}/.test(s)
  );

// Arbitrary safe id: hex-like, short, never matches a key pattern.
const safeId = fc
  .stringOf(fc.constantFrom(..."abcdef0123456789"), {
    minLength: 6,
    maxLength: 16,
  })
  .filter((s) => !/sk-/.test(s) && !/AKIA/.test(s));

const arbMessage = (): fc.Arbitrary<Message> =>
  fc.record({
    role: fc.constantFrom(
      "system" as const,
      "user" as const,
      "assistant" as const
    ),
    content: safeString,
  });

const arbModelSettings = (): fc.Arbitrary<ModelSettings> =>
  fc.record({
    temperature: fc.option(fc.float({ min: 0, max: 2 }), { nil: undefined }),
    maxTokens: fc.option(fc.integer({ min: 1, max: 4096 }), { nil: undefined }),
  });

const arbModelCallStep = (
  runId: string,
  index: number,
  parentId: string | null
): fc.Arbitrary<ModelCallStep> =>
  fc
    .record({
      finishReason: fc.constantFrom("stop", "tool_calls", "length"),
      content: safeString,
      model: safeString,
      inputTokens: fc.integer({ min: 0, max: 1000 }),
      outputTokens: fc.integer({ min: 0, max: 1000 }),
      cost: fc.float({ min: 0, max: 1 }),
      durationMs: fc.integer({ min: 0, max: 5000 }),
      settings: arbModelSettings(),
      messages: fc.array(arbMessage(), { minLength: 1, maxLength: 4 }),
    })
    .map(
      (r): ModelCallStep => ({
        id: `${runId}-${index}`,
        runId,
        parentId,
        kind: "model_call",
        branch: "main",
        forkPointId: null,
        durationMs: r.durationMs,
        model: r.model,
        settings: r.settings,
        tokens: { input: r.inputTokens, output: r.outputTokens },
        cost: r.cost,
        input: {
          messages: r.messages,
          model: r.model,
          settings: r.settings,
        },
        output: {
          message: { role: "assistant", content: r.content },
          finishReason: r.finishReason,
        },
        live: false,
        edited: false,
      })
    );

const arbToolCallStep = (
  runId: string,
  index: number,
  parentId: string | null
): fc.Arbitrary<ToolCallStep> =>
  fc
    .record({
      toolCallId: safeId,
      name: safeString,
      durationMs: fc.integer({ min: 0, max: 5000 }),
    })
    .map(
      (r): ToolCallStep => ({
        id: `${runId}-${index}`,
        runId,
        parentId,
        kind: "tool_call",
        branch: "main",
        forkPointId: null,
        durationMs: r.durationMs,
        model: null,
        settings: null,
        tokens: null,
        cost: null,
        input: {
          toolCallId: r.toolCallId,
          name: r.name,
          arguments: {},
        },
        output: null,
        live: false,
        edited: false,
      })
    );

const arbToolResultStep = (
  runId: string,
  index: number,
  parentId: string | null,
  toolCallId: string
): fc.Arbitrary<ToolResultStep> =>
  fc
    .record({
      result: safeString,
      isError: fc.boolean(),
      durationMs: fc.integer({ min: 0, max: 5000 }),
    })
    .map(
      (r): ToolResultStep => ({
        id: `${runId}-${index}`,
        runId,
        parentId,
        kind: "tool_result",
        branch: "main",
        forkPointId: null,
        durationMs: r.durationMs,
        model: null,
        settings: null,
        tokens: null,
        cost: null,
        input: { toolCallId },
        output: { result: r.result, isError: r.isError },
        live: false,
        edited: false,
      })
    );

// Arbitrary Trace with 0-20 steps. The step sequence may be empty or mixed.
const arbTrace = (): fc.Arbitrary<Trace> =>
  safeId.chain((runId) =>
    fc
      .integer({ min: 0, max: 20 })
      .chain((numSteps) => {
        const steps: fc.Arbitrary<Step>[] = [];
        let prevId: string | null = null;
        let lastToolCallId = "tc-0";

        for (let i = 0; i < numSteps; i++) {
          const kind = i % 3 === 0 ? 0 : i % 3 === 1 ? 1 : 2;
          let stepArb: fc.Arbitrary<Step>;

          if (kind === 0) {
            stepArb = arbModelCallStep(runId, i, prevId) as fc.Arbitrary<Step>;
          } else if (kind === 1) {
            stepArb = arbToolCallStep(
              runId,
              i,
              prevId
            ) as fc.Arbitrary<Step>;
          } else {
            stepArb = arbToolResultStep(
              runId,
              i,
              prevId,
              lastToolCallId
            ) as fc.Arbitrary<Step>;
          }

          steps.push(stepArb);
          prevId = `${runId}-${i}`;
          if (kind === 1) {
            lastToolCallId = `${runId}-${i}`;
          }
        }

        if (steps.length === 0) {
          return fc.constant({ steps: [] as Step[] });
        }
        return fc.tuple(...(steps as [fc.Arbitrary<Step>])).map((s) => ({
          steps: Array.isArray(s) ? (s as Step[]) : ([s] as Step[]),
        }));
      })
      .map(({ steps }) => ({
        version: "1.1.0",
        runId,
        createdAt: new Date(0).toISOString(),
        steps,
      }))
  );

describe("save/load round-trip", () => {
  it("load(save(t)) deep-equals scrub(t) for arbitrary traces", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-rt-"));

    await fc.assert(
      fc.asyncProperty(arbTrace(), async (trace) => {
        const filePath = path.join(
          tmpDir,
          `trace-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
        );
        await saveTrace(trace, filePath);
        const loaded = await loadTrace(filePath);
        const scrubbed = scrubTrace(trace);

        // deep equality check
        const loadedJson = JSON.stringify(loaded);
        const scrubbedJson = JSON.stringify(scrubbed);
        if (loadedJson !== scrubbedJson) {
          throw new Error(
            `Round-trip mismatch.\nExpected: ${scrubbedJson}\nGot: ${loadedJson}`
          );
        }
      }),
      { numRuns: 200 }
    );

    await fs.rm(tmpDir, { recursive: true });
  });

  it("scrubTrace is idempotent", async () => {
    await fc.assert(
      fc.asyncProperty(arbTrace(), async (trace) => {
        const once = scrubTrace(trace);
        const twice = scrubTrace(once);
        const onceJson = JSON.stringify(once);
        const twiceJson = JSON.stringify(twice);
        if (onceJson !== twiceJson) {
          throw new Error(
            `Scrub not idempotent.\nOnce: ${onceJson}\nTwice: ${twiceJson}`
          );
        }
      }),
      { numRuns: 200 }
    );
  });
});
