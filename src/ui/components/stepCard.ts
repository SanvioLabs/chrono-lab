// src/ui/components/stepCard.ts
// One step's summary plus its expandable full input and output (R-12).
//
// The card shows the kind in plain words, a one-line summary, tokens (or "no
// tokens" for a tool step) and the duration. When expanded it shows the full
// input and output as JSON, escaped: every value reaches the DOM through
// textContent, never innerHTML, so trace content is shown, not run (R-10).

import type { Step } from "../../trace/types.js";
import {
  el,
  stepKindWords,
  stepSummary,
  stepTokensWords,
  stepDurationWords,
} from "../a11y.js";

// Builds the visible summary row for a step card (not the option wrapper; the
// timeline wraps this in a role="option"). The detail is appended by
// stepDetail when the step is selected.
export function stepSummaryRow(step: Step): HTMLElement {
  const row = el("div", "step-summary");

  const kind = el("span", "step-kind", stepKindWords(step));
  const summary = el("span", "step-text", stepSummary(step));
  const meta = el("span", "step-meta");
  meta.appendChild(el("span", "step-tokens", stepTokensWords(step)));
  meta.appendChild(el("span", "step-duration", stepDurationWords(step)));

  row.appendChild(kind);
  row.appendChild(summary);
  row.appendChild(meta);
  return row;
}

// Builds the expanded detail: the full input and output as pretty JSON, shown
// as text. Opens to the side of the spine (the spine never moves, R-11).
export function stepDetail(step: Step): HTMLElement {
  const detail = el("div", "step-detail");
  detail.appendChild(jsonBlock("input", step.input));
  detail.appendChild(jsonBlock("output", step.output));
  return detail;
}

// A labelled JSON block rendered as monospace text. JSON.stringify then
// textContent, so no trace string is ever parsed as markup.
function jsonBlock(label: string, value: unknown): HTMLElement {
  const block = el("div", "json-block");
  block.appendChild(el("div", "json-label", label));
  const pre = document.createElement("pre");
  pre.className = "json-body";
  // textContent only: the JSON is shown verbatim, never interpreted.
  pre.textContent = safeStringify(value);
  block.appendChild(pre);
  return block;
}

// JSON.stringify with a guard so a circular or unusual value cannot throw and
// blank the card.
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
