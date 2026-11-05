// src/ui/draw/timelineSvg.ts
// The timeline spine drawing (R-13, decoration).
//
// A single vertical spine in --line with one node per step, coloured by role
// (--past for replayed, --future for live, --fork diamond for the fork point).
// Node shape doubles as the role signal: circle for a model call, square for a
// tool call, rounded square for a tool result. This is decoration beside the
// readable listbox in timeline.ts; the listbox carries the roles and names for
// a screen reader, so the spine is aria-hidden.

import type { Step } from "../../trace/types.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const ROW_H = 56;
const PAD = 20;
const CX = 20;
const R = 8;

function svgEl(name: string): SVGElement {
  return document.createElementNS(SVG_NS, name) as SVGElement;
}

// Draws the spine for a run's steps. aria-hidden: the meaning lives in the
// listbox, so a screen reader does not read the decorative spine twice.
export function drawTimelineSpine(steps: Step[]): SVGElement {
  const height = PAD * 2 + Math.max(1, steps.length) * ROW_H;
  const svg = svgEl("svg");
  svg.setAttribute("class", "timeline-spine");
  svg.setAttribute("viewBox", `0 0 40 ${height}`);
  svg.setAttribute("width", "40");
  svg.setAttribute("height", String(height));
  svg.setAttribute("aria-hidden", "true");

  if (steps.length > 1) {
    const line = svgEl("line");
    line.setAttribute("x1", String(CX));
    line.setAttribute("y1", String(PAD + R));
    line.setAttribute("x2", String(CX));
    line.setAttribute("y2", String(PAD + (steps.length - 1) * ROW_H + R));
    line.setAttribute("class", "spine-line");
    svg.appendChild(line);
  }

  steps.forEach((step, i) => {
    const cy = PAD + i * ROW_H + R;
    svg.appendChild(spineNode(step, cy));
  });

  return svg;
}

function spineNode(step: Step, cy: number): SVGElement {
  const roleClass = step.edited
    ? "node--fork"
    : step.live
      ? "node--live"
      : "node--replayed";

  if (step.edited) {
    const d = svgEl("polygon");
    d.setAttribute(
      "points",
      `${CX},${cy - R} ${CX + R},${cy} ${CX},${cy + R} ${CX - R},${cy}`
    );
    d.setAttribute("class", `node ${roleClass}`);
    return d;
  }
  if (step.kind === "model_call") {
    const c = svgEl("circle");
    c.setAttribute("cx", String(CX));
    c.setAttribute("cy", String(cy));
    c.setAttribute("r", String(R));
    c.setAttribute("class", `node ${roleClass}`);
    return c;
  }
  const rect = svgEl("rect");
  rect.setAttribute("x", String(CX - R));
  rect.setAttribute("y", String(cy - R));
  rect.setAttribute("width", String(R * 2));
  rect.setAttribute("height", String(R * 2));
  if (step.kind === "tool_result") rect.setAttribute("rx", "4");
  rect.setAttribute("class", `node ${roleClass}`);
  return rect;
}
