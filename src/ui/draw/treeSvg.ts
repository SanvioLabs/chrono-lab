// src/ui/draw/treeSvg.ts
// The branch tree drawing (R-13, R-20).
//
// Branches are drawn as lines that split from the parent at the fork point,
// styled like cracks in glass: the split is a short jagged segment in --fork,
// not a smooth curve. The parent line stays cold --past; the new branch warms
// to --future from the fork point on. The whole tree is one SVG with a
// role="tree" wrapper and each node a role="treeitem". The role of each node
// ("replayed", "live", "fork point") is in its accessible name, so a screen
// reader and a colour-blind user both get it, never colour or shape alone.
//
// Node shape doubles as the role signal: a circle for a model call, a square
// for a tool call, a rounded square for a tool result, and a diamond for the
// fork-point step.
//
// The split leaves the parent at the fork-point node and lands on the branch's
// fork diamond: both sit at the same row (the fork index), because the branch
// column repeats the replayed prefix and the edited fork-point step is the
// branch's first live step at that row. So the crack runs from the parent's
// fork-point row across to the diamond's row, not back up to the branch's first
// node. crackPoints is the pure geometry, so the endpoints are unit-tested
// without a DOM (design.md: "lines that split from the parent at the fork
// point", the parent line cold, the new branch warming from the fork point on).

import type { Step } from "../../trace/types.js";
import { stepAccessibleName, stepRoleWords } from "../a11y.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// One column of nodes for one branch.
export interface TreeColumn {
  runId: string;
  label: string;
  steps: Step[];
  // Index on the parent column this branch forks from, or null for the root.
  forkIndex: number | null;
  // The x offset (column) for the drawing.
  column: number;
}

const COL_W = 120;
const ROW_H = 56;
const PAD = 28;
const R = 9;

// The x centre of a column's nodes.
export function columnX(column: number): number {
  return PAD + column * COL_W + R;
}

// The y centre of a node at a row.
export function rowY(row: number): number {
  return PAD + row * ROW_H + R;
}

function svgEl(name: string): SVGElement {
  return document.createElementNS(SVG_NS, name) as SVGElement;
}

// Builds the SVG tree for the given columns. Each node carries role="treeitem"
// and an accessible name that includes its timeline role in words.
export function drawTree(
  columns: TreeColumn[],
  onSelectBranch: (runId: string) => void
): SVGElement {
  const maxRows = columns.reduce((m, c) => Math.max(m, c.steps.length), 0);
  const width = PAD * 2 + Math.max(1, columns.length) * COL_W;
  const height = PAD * 2 + Math.max(1, maxRows) * ROW_H;

  const svg = svgEl("svg");
  svg.setAttribute("class", "tree-svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("role", "tree");
  svg.setAttribute("aria-label", "branch tree");

  for (const col of columns) {
    const cx = columnX(col.column);

    // The spine line for the column.
    for (let i = 0; i < col.steps.length - 1; i++) {
      const step = col.steps[i];
      const y1 = rowY(i);
      const y2 = rowY(i + 1);
      const line = lineEl(cx, y1, cx, y2);
      // A live segment warms to --future; else it stays --line.
      line.setAttribute(
        "class",
        step && step.live ? "tree-line tree-line--live" : "tree-line"
      );
      svg.appendChild(line);
    }

    // The crack-in-glass split from the parent's fork-point node to this
    // branch's fork diamond. Both sit at col.forkIndex: the parent's fork-point
    // row and, because the branch repeats the prefix, the branch's edited
    // first-live step. The connector runs across at that row, leaving the
    // parent at the fork point and landing on the diamond (not back up to the
    // branch's first node).
    if (col.forkIndex !== null) {
      const parent = columns.find((c) => c.column === col.column - 1);
      if (parent) {
        const px = columnX(parent.column);
        const py = rowY(col.forkIndex);
        const ty = rowY(col.forkIndex);
        svg.appendChild(crack(px, py, cx, ty));
      }
    }

    // The nodes.
    col.steps.forEach((step, i) => {
      const cy = rowY(i);
      const node = nodeFor(step, cx, cy);
      const g = svgEl("g");
      g.setAttribute("role", "treeitem");
      g.setAttribute("aria-label", stepAccessibleName(step, stepRoleWords(step)));
      g.setAttribute("tabindex", "0");
      g.setAttribute("class", "tree-node");
      (g as SVGElement & { dataset: DOMStringMap }).dataset["runId"] = col.runId;
      g.appendChild(node);
      g.addEventListener("click", () => onSelectBranch(col.runId));
      g.addEventListener("keydown", (ev) => {
        const key = (ev as KeyboardEvent).key;
        if (key === "Enter" || key === " ") {
          ev.preventDefault();
          onSelectBranch(col.runId);
        }
      });
      svg.appendChild(g);
    });
  }

  return svg;
}

// Builds the shape for a step: diamond for the fork point, else by kind.
function nodeFor(step: Step, cx: number, cy: number): SVGElement {
  const roleClass = step.edited
    ? "node--fork"
    : step.live
      ? "node--live"
      : "node--replayed";

  if (step.edited) {
    const d = svgEl("polygon");
    d.setAttribute(
      "points",
      `${cx},${cy - R} ${cx + R},${cy} ${cx},${cy + R} ${cx - R},${cy}`
    );
    d.setAttribute("class", `node ${roleClass}`);
    return d;
  }

  if (step.kind === "tool_call") {
    const sq = svgEl("rect");
    sq.setAttribute("x", String(cx - R));
    sq.setAttribute("y", String(cy - R));
    sq.setAttribute("width", String(R * 2));
    sq.setAttribute("height", String(R * 2));
    sq.setAttribute("class", `node ${roleClass}`);
    return sq;
  }

  if (step.kind === "tool_result") {
    const rr = svgEl("rect");
    rr.setAttribute("x", String(cx - R));
    rr.setAttribute("y", String(cy - R));
    rr.setAttribute("width", String(R * 2));
    rr.setAttribute("height", String(R * 2));
    rr.setAttribute("rx", "4");
    rr.setAttribute("class", `node ${roleClass}`);
    return rr;
  }

  // model_call: a circle.
  const c = svgEl("circle");
  c.setAttribute("cx", String(cx));
  c.setAttribute("cy", String(cy));
  c.setAttribute("r", String(R));
  c.setAttribute("class", `node ${roleClass}`);
  return c;
}

function lineEl(x1: number, y1: number, x2: number, y2: number): SVGElement {
  const line = svgEl("line");
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(x2));
  line.setAttribute("y2", String(y2));
  return line;
}

// The points of the three-segment jag (a crack) from (x1,y1) to (x2,y2). Pure,
// so a unit test can assert the endpoints land on the fork-point node and the
// diamond. The first and last points are exactly the endpoints; the two middle
// points are the jag between them. The jag reads as a crack without looking
// noisy (design.md: "the jag is three segments").
export function crackPoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number
): Array<[number, number]> {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  return [
    [x1, y1],
    [mx - 4, my + 4],
    [mx + 6, my - 4],
    [x2, y2],
  ];
}

// A short three-segment jag (a crack) from the parent fork point to the child's
// fork diamond, in --fork.
function crack(x1: number, y1: number, x2: number, y2: number): SVGElement {
  const pts = crackPoints(x1, y1, x2, y2);
  const poly = svgEl("polyline");
  poly.setAttribute("points", pts.map(([x, y]) => `${x},${y}`).join(" "));
  poly.setAttribute("class", "tree-crack");
  return poly;
}
