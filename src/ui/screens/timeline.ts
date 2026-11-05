// src/ui/screens/timeline.ts
// The timeline: steps in order, select to open input/output (R-12, R-19).
//
// A keyboard-navigable listbox (role="listbox", name "timeline"). Each step is
// a role="option" whose accessible name states the kind in words, a one-line
// summary, its tokens (or "no tokens") and its duration (R-20). Up/Down move
// selection, Enter opens the step (which opens the edit region), Escape closes
// the detail. Selecting a step expands its full input and output, escaped
// (R-10). The spine never moves when a node expands; the detail opens to the
// side.

import type { Trace, Step } from "../../trace/types.js";
import type { UiCallbacks } from "../controller.js";
import { el, stepAccessibleName, focus } from "../a11y.js";
import { stepSummaryRow, stepDetail } from "../components/stepCard.js";

// Renders the timeline for a loaded trace. selectedStepId marks the open step;
// callbacks drive selection, open and close.
export function renderTimeline(
  trace: Trace,
  selectedStepId: string | null,
  callbacks: UiCallbacks
): HTMLElement {
  const listbox = el("div", "timeline");
  listbox.setAttribute("role", "listbox");
  listbox.setAttribute("aria-label", "timeline");
  listbox.tabIndex = 0;

  const options: HTMLElement[] = [];

  // The active option, kept in sync by both the keyboard handler and a pointer
  // press (see below). The listbox focus handler reads this, so a pointer press
  // must update it before focus moves into the listbox.
  let activeIndex = Math.max(
    0,
    trace.steps.findIndex((s) => s.id === selectedStepId)
  );

  trace.steps.forEach((step, index) => {
    const option = el("div", "timeline-option");
    option.setAttribute("role", "option");
    option.setAttribute("aria-label", stepAccessibleName(step));
    option.dataset["stepId"] = step.id;
    option.dataset["index"] = String(index);
    const isSelected = step.id === selectedStepId;
    option.setAttribute("aria-selected", isSelected ? "true" : "false");
    option.classList.toggle("is-selected", isSelected);
    // Role tint by live/edited, decoration only; the name already carries it.
    option.dataset["role"] = roleOf(step);

    option.appendChild(stepSummaryRow(step));
    if (isSelected) {
      option.appendChild(stepDetail(step));
    }

    // A pointer press on an option makes it the active option before focus
    // moves into the listbox. pointerdown fires before the listbox focus event,
    // so the focus handler activates the pressed option and never scrolls the
    // previously selected one into view (Bug 2): without this, a press while
    // focus was outside the listbox (the case right after a model call, whose
    // editor holds focus) fired the focus handler with the stale activeIndex,
    // scrolled the old option under the pointer and selected it instead.
    option.addEventListener("pointerdown", () => {
      activeIndex = index;
    });

    option.addEventListener("click", () => {
      activeIndex = index;
      callbacks.selectStep(step.id);
    });

    options.push(option);
    listbox.appendChild(option);
  });

  // Keyboard: Up/Down move the active option, Enter opens it, Escape closes the
  // open detail. Selection follows the active option so a screen reader hears
  // the step it lands on.
  listbox.addEventListener("keydown", (ev) => {
    const key = (ev as KeyboardEvent).key;
    if (key === "ArrowDown") {
      ev.preventDefault();
      activeIndex = Math.min(options.length - 1, activeIndex + 1);
      setActive(options, activeIndex);
    } else if (key === "ArrowUp") {
      ev.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
      setActive(options, activeIndex);
    } else if (key === "Enter" || key === " ") {
      ev.preventDefault();
      const step = trace.steps[activeIndex];
      if (step) callbacks.selectStep(step.id);
    } else if (key === "Escape") {
      ev.preventDefault();
      callbacks.closeDetail();
    }
  });

  // When the listbox takes focus, mark the active option active so Up/Down has
  // somewhere to start (R-19: Tab into the listbox activates the selected or
  // first option). A pointer press has already set activeIndex to the pressed
  // option by the time this runs, so a mouse user lands on what they pressed,
  // not the previously selected option.
  listbox.addEventListener("focus", () => {
    setActive(options, activeIndex);
  });

  return listbox;
}

// Visually and in the a11y tree, mark one option active and pull focus hint to
// it. Does not open the detail; Enter does that.
function setActive(options: HTMLElement[], index: number): void {
  options.forEach((opt, i) => {
    opt.classList.toggle("is-active", i === index);
  });
  const active = options[index];
  if (active) focus(active);
}

// The timeline role of a step, for the colour tint (decoration) and matching
// the tree's words.
function roleOf(step: Step): string {
  if (step.edited) return "fork point";
  if (step.live) return "live";
  return "replayed";
}
