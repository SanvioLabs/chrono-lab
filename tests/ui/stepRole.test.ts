// tests/ui/stepRole.test.ts
// Task 14 follow-up: the timeline role a step reads in words (R-20).
//
// The running log and the compare column name each step by its role in words,
// never colour or shape alone. The edited step is the fork point the user
// changed; before this test it was mislabelled "live" in the running region,
// because the fork-point step is the branch's first live step and the running
// log keyed its label off the live flag alone. stepRoleWords is the one place
// that decides the word, so the edited step reads "fork point", a replayed
// prefix step reads "replayed", and a live-but-not-edited step reads "live".
//
// stepRoleWords is a pure function over a step's flags, so no DOM is needed.

import { describe, it, expect } from "vitest";
import { stepRoleWords } from "../../src/ui/a11y.js";
import type { ToolResultStep } from "../../src/trace/types.js";

// A minimal tool_result step with the given live/edited flags. The fork-point
// step in the full loop is a tool_result (the user edited "hello" to
// "goodbye"), so this mirrors the step the running region mislabelled.
function toolResult(flags: {
  live: boolean;
  edited: boolean;
}): ToolResultStep {
  return {
    id: "s2",
    runId: "r",
    parentId: null,
    kind: "tool_result",
    branch: "b",
    forkPointId: null,
    durationMs: 1,
    input: { toolCallId: "tc-1" },
    output: { result: "goodbye", isError: false },
    model: null,
    settings: null,
    tokens: null,
    cost: null,
    ...flags,
  };
}

describe("stepRoleWords: the timeline role of a step in words (R-20)", () => {
  it("the edited fork-point step reads 'fork point', not 'live'", () => {
    // The fork-point step is saved as the first live step (live: true) and
    // marked edited: true. It must read "fork point", the word the tree uses
    // for the diamond, not "live".
    const forkPoint = toolResult({ live: true, edited: true });
    expect(stepRoleWords(forkPoint)).toBe("fork point");
  });

  it("a live-but-not-edited step reads 'live'", () => {
    const live = toolResult({ live: true, edited: false });
    expect(stepRoleWords(live)).toBe("live");
  });

  it("a replayed prefix step reads 'replayed'", () => {
    const replayed = toolResult({ live: false, edited: false });
    expect(stepRoleWords(replayed)).toBe("replayed");
  });

  it("'edited' wins over 'live': the fork point is named as the fork point", () => {
    // edited implies the step was re-run live, so both flags are set on the
    // saved fork-point step. The edited flag decides the word so the one step
    // the user changed is named as the fork point, matching the tree (R-20).
    const both = toolResult({ live: true, edited: true });
    expect(stepRoleWords(both)).toBe("fork point");
  });
});
