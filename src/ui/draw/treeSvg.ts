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

import type { Step } from "../../trace/types.js";
import { stepAccessibleName } from "../a11y.js";

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
    const cx = PAD + col.column * COL_W + R;

    // The spine line for the column.
    for (let i = 0; i < col.steps.length - 1; i++) {
      const step = col.steps[i];
      const y1 = PAD + i * ROW_H + R;
      const y2 = PAD + (i + 1) * ROW_H + R;
      const line = lineEl(cx, y1, cx, y2);
      // A live segment warms to --future; else it stays --line.
      line.setAttribute(
        "class",
        step && step.live ? "tree-line tree-line--live" : "tree-line"
      );
      svg.appendChild(line);
    }

    // The crack-in-glass split from the parent at the fork point.
    if (col.forkIndex !== null) {
      const parent = columns.find((c) => c.column === col.column - 1);
      if (parent) {
        const px = PAD + parent.column * COL_W + R;
        const py = PAD + col.forkIndex * ROW_H + R;
        const ty = PAD + 0 * ROW_H + R;
        svg.appendChild(crack(px, py, cx, ty));
      }
    }

    // The nodes.
    col.steps.forEach((step, i) => {
      const cy = PAD + i * ROW_H + R;
      const node = nodeFor(step, cx, cy);
      const g = svgEl("g");
      g.setAttribute("role", "treeitem");
      g.setAttribute("aria-label", stepAccessibleName(step, roleWords(step)));
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

// The timeline role words for a step, carried in the node's accessible name.
function roleWords(step: Step): string {
  if (step.edited) return "fork point";
  if (step.live) return "live";
  return "replayed";
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

// A short three-segment jag (a crack) from the parent fork point to the child's
// first node, in --fork.
function crack(x1: number, y1: number, x2: number, y2: number): SVGElement {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const jx = mx + 6;
  const jy = my - 4;
  const poly = svgEl("polyline");
  poly.setAttribute(
    "points",
    `${x1},${y1} ${mx - 4},${my + 4} ${jx},${jy} ${x2},${y2}`
  );
  poly.setAttribute("class", "tree-crack");
  return poly;
}
