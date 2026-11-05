// src/ui/screens/branchTree.ts
// The branch tree (R-13, R-20).
//
// Builds the tree from the loaded trace plus the trace list: each summary's
// parentRunId and forkPointStepId give the edges. The root run is one column;
// each fork is a column that splits off its parent at the fork-point node.
// Selecting a branch loads its timeline. The drawing (draw/treeSvg.ts) makes
// every node a role="treeitem" whose accessible name carries its role in words.

import type { Trace } from "../../trace/types.js";
import type { TraceSummary } from "../../server/routes.js";
import type { UiCallbacks } from "../controller.js";
import { el } from "../a11y.js";
import { drawTree, type TreeColumn } from "../draw/treeSvg.js";

// Renders the branch tree. current is the loaded trace (its steps are drawn);
// summaries give sibling/child branches so the tree shows the whole family.
export function renderBranchTree(
  current: Trace,
  summaries: TraceSummary[],
  tracesById: Map<string, Trace>,
  callbacks: UiCallbacks
): HTMLElement {
  const wrapper = el("div", "branch-tree");

  // The root of the family the current trace belongs to.
  const rootId = findRoot(current.runId, summaries);
  const columns = buildColumns(rootId, current, summaries, tracesById);

  const svg = drawTree(columns, (runId) => callbacks.openRun(runId));
  wrapper.appendChild(svg);
  return wrapper;
}

// Walks parentRunId up to the run with no parent.
function findRoot(runId: string, summaries: TraceSummary[]): string {
  const byId = new Map(summaries.map((s) => [s.runId, s]));
  let id = runId;
  // Guard against a missing link or a cycle with a bounded walk.
  for (let i = 0; i < 100; i++) {
    const s = byId.get(id);
    if (!s || s.parentRunId === undefined) return id;
    id = s.parentRunId;
  }
  return id;
}

// Builds one column per branch, root at column 0, each child one column right.
// The current trace contributes its real steps; other branches draw from the
// trace we already loaded (tracesById) when available, else a thin placeholder
// column from the summary's step count.
function buildColumns(
  rootId: string,
  current: Trace,
  summaries: TraceSummary[],
  tracesById: Map<string, Trace>
): TreeColumn[] {
  const byParent = new Map<string, TraceSummary[]>();
  for (const s of summaries) {
    if (s.parentRunId !== undefined) {
      const list = byParent.get(s.parentRunId) ?? [];
      list.push(s);
      byParent.set(s.parentRunId, list);
    }
  }

  const columns: TreeColumn[] = [];

  const addColumn = (runId: string, column: number, forkPointStepId?: string) => {
    const trace = runId === current.runId ? current : tracesById.get(runId);
    const summary = summaries.find((s) => s.runId === runId);
    const steps = trace ? trace.steps : [];
    // The fork index on the parent column, from the parent's step order.
    let forkIndex: number | null = null;
    if (forkPointStepId !== undefined) {
      const parentId = summary?.parentRunId;
      const parentTrace = parentId
        ? parentId === current.runId
          ? current
          : tracesById.get(parentId)
        : undefined;
      if (parentTrace) {
        const idx = parentTrace.steps.findIndex((st) => st.id === forkPointStepId);
        forkIndex = idx >= 0 ? idx : null;
      }
    }

    columns.push({
      runId,
      label: runId.slice(0, 8),
      steps,
      forkIndex,
      column,
    });

    for (const child of byParent.get(runId) ?? []) {
      addColumn(child.runId, column + 1, child.forkPointStepId);
    }
  };

  addColumn(rootId, 0);
  return columns;
}
