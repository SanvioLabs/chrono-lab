// src/ui/screens/compare.ts
// The compare screen (R-16).
//
// Two columns, one per branch, aligned so the fork-point row lines up. The row
// at firstDiff.index is highlighted on both sides and labelled "first
// difference" in text, not colour alone (R-20). The fork-point row (the edited
// step) carries a "fork point" label in text too, so the step the user changed
// is named in words here as it is in the tree and the running log (R-20),
// matching the shared vocabulary (stepRoleWords). A footer per column shows the
// final output, total tokens, total cost and total duration from
// compareBranches. When firstDiff is null the highlight area reads "these
// branches do not differ" rather than being blank. The host in main.ts carries
// data-region="compare" and keeps the box.

import type { Trace, Step } from "../../trace/types.js";
import type { CompareResult, BranchStats } from "../../compare/compare.js";
import { el, stepAccessibleName, stepRoleWords } from "../a11y.js";

// Renders the compare region content for two branches and the compare result.
// a is the parent (branch A), b the new branch (branch B).
export function renderCompare(
  a: Trace,
  b: Trace,
  result: CompareResult
): HTMLElement {
  const region = el("div", "compare");

  region.appendChild(el("h2", "compare-title", "Compare two futures"));

  // The whole-page diff label, so the e2e test (and a screen reader) finds the
  // result in text, not colour alone.
  const diffBanner = el("div", "compare-diff-banner");
  if (result.firstDiff === null) {
    diffBanner.textContent = "These branches do not differ.";
  } else {
    diffBanner.textContent = `First difference at step ${
      result.firstDiff.index + 1
    }.`;
  }
  region.appendChild(diffBanner);

  const columns = el("div", "compare-columns");
  const diffIndex = result.firstDiff ? result.firstDiff.index : null;
  columns.appendChild(
    renderColumn("branch A (parent)", a.steps, diffIndex, result.a)
  );
  columns.appendChild(
    renderColumn("branch B (new future)", b.steps, diffIndex, result.b)
  );
  region.appendChild(columns);

  return region;
}

// One branch column: a header, the aligned step rows, and a footer of stats.
function renderColumn(
  name: string,
  steps: Step[],
  diffIndex: number | null,
  stats: BranchStats
): HTMLElement {
  const column = el("div", "compare-column");
  column.setAttribute("role", "region");
  column.setAttribute("aria-label", name);

  column.appendChild(el("h3", "compare-column-title", name));

  const rows = el("div", "compare-rows");
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const row = el("div", "compare-row");
    if (diffIndex !== null && i === diffIndex) {
      row.classList.add("is-diff");
      // Mark the first difference in text, not colour alone.
      const mark = el("span", "compare-mark", "first difference");
      mark.setAttribute("role", "mark");
      row.appendChild(mark);
    }
    // The fork-point row (the edited step) is named in words, so the step the
    // user changed reads "fork point" here as it does in the tree and the
    // running log (R-20). The label is text, not colour alone.
    if (step && step.edited) {
      const forkMark = el("span", "compare-fork-mark", stepRoleWords(step));
      forkMark.dataset["role"] = "fork point";
      row.appendChild(forkMark);
    }
    row.appendChild(
      el(
        "span",
        "compare-row-text",
        step ? stepAccessibleName(step) : "(no step here)"
      )
    );
    rows.appendChild(row);
  }
  column.appendChild(rows);

  // The footer: final output, tokens, cost, duration.
  const footer = el("div", "compare-footer");
  footer.appendChild(stat("final output", stats.finalOutput ?? "(none)"));
  footer.appendChild(stat("tokens", String(stats.totalTokens)));
  footer.appendChild(stat("cost", `$${stats.totalCostUsd.toFixed(4)}`));
  footer.appendChild(stat("duration", `${Math.round(stats.totalDurationMs)} ms`));
  column.appendChild(footer);

  return column;
}

// A labelled stat line. The label text carries the word the e2e test looks for
// ("tokens", "cost", "ms"/"duration").
function stat(label: string, value: string): HTMLElement {
  const row = el("div", "compare-stat");
  row.appendChild(el("span", "compare-stat-label", label));
  row.appendChild(el("span", "compare-stat-value", value));
  return row;
}
