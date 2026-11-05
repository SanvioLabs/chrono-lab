// tests/ui/treeSvg.test.ts
// Task 14 follow-up: the branch tree's fork connector endpoints (R-13, R-20).
//
// The connector (the crack) must leave the parent at the fork point and land on
// the branch's fork diamond. Before this test it ran from the parent's
// fork-point row up to the branch's first node (row 0), a diagonal going
// backwards. The parent's fork point and the branch's diamond sit at the same
// row (the fork index): the branch column repeats the replayed prefix, and the
// edited fork-point step is the branch's first live step at that row. So the
// crack is horizontal across one column, from the parent fork-point node to the
// diamond, matching design.md ("lines that split from the parent at the fork
// point", the parent line cold, the new branch warming from the fork point on).
//
// crackPoints, columnX and rowY are pure geometry, so the endpoints are checked
// without a DOM.

import { describe, it, expect } from "vitest";
import { crackPoints, columnX, rowY } from "../../src/ui/draw/treeSvg.js";

describe("the fork connector (crack) endpoints (R-13)", () => {
  // The full loop: the root run is column 0, the branch is column 1, forked at
  // the tool_result step at row index 2 (the step the user edited). The crack
  // must go from the parent's fork-point node at (column 0, row 2) to the
  // branch's diamond at (column 1, row 2), the same row on both.
  const parentColumn = 0;
  const branchColumn = 1;
  const forkRow = 2;

  const px = columnX(parentColumn);
  const py = rowY(forkRow);
  const cx = columnX(branchColumn);
  const ty = rowY(forkRow);

  it("starts on the parent's fork-point node", () => {
    const pts = crackPoints(px, py, cx, ty);
    expect(pts[0]).toEqual([px, py]);
  });

  it("ends on the branch's fork diamond, at the same row", () => {
    const pts = crackPoints(px, py, cx, ty);
    const last = pts[pts.length - 1]!;
    expect(last).toEqual([cx, ty]);
    // The diamond sits at the fork row, not the branch's first node (row 0).
    expect(last[1]).toBe(py);
    expect(last[1]).not.toBe(rowY(0));
  });

  it("the endpoint x values advance one column to the right", () => {
    const pts = crackPoints(px, py, cx, ty);
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    // Parent on the left, branch one column to the right.
    expect(last[0]).toBeGreaterThan(first[0]);
    expect(last[0]).toBe(columnX(branchColumn));
    expect(first[0]).toBe(columnX(parentColumn));
  });

  it("the connector does not run backwards to the branch's first node", () => {
    // The old bug landed the connector on row 0 of the branch. Assert the
    // endpoint is not at the branch's first node.
    const pts = crackPoints(px, py, cx, ty);
    const last = pts[pts.length - 1]!;
    expect(last).not.toEqual([columnX(branchColumn), rowY(0)]);
  });

  it("the jag is three segments (four points: two endpoints, two in between)", () => {
    const pts = crackPoints(px, py, cx, ty);
    expect(pts).toHaveLength(4);
  });
});
