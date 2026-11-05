// src/ui/components/states.ts
// The state blocks: empty, loading, error, cap_reached, ready (Task 9, R-18).
//
// Every state block for a given region renders into the same fixed-size
// container, so no state change moves anything (R-11). stateBox fills the
// region's reserved height for every state: loading is a skeleton the size of
// the ready content, and the demo-mode banner has a reserved slot that is empty
// (not absent) when demo mode is off. The no-reflow rule is verified in the
// browser by the Playwright test (Task 12); a Vitest unit test has no layout
// engine, so it cannot measure boxes.

import type { Loadable } from "../state.js";

// The regions that reserve a fixed-size box. Each screen owns one or more.
export type Region =
  | "traces"
  | "current"
  | "running"
  | "compare"
  | "banner";

// Turns a ready value into its DOM node. The caller supplies this so stateBox
// stays agnostic to what "ready" looks like for each region.
export type ReadyRenderer<T> = (value: T) => HTMLElement;

// A plain-text label per state so a screen reader (and a reader with styles
// off) always gets the state in words, not colour or shape alone (R-20).
const STATE_LABELS: Record<Loadable<unknown>["status"], string> = {
  empty: "Nothing here yet.",
  loading: "Loading…",
  error: "Something went wrong.",
  ready: "",
  cap_reached: "Spend cap reached.",
};

// Renders the block for a region's current state into the region's reserved
// box. The outer element carries the region as a data attribute and a fixed
// box class, so every state fills the same reserved height and a state change
// moves nothing (R-11). The browser test measures these boxes.
export function stateBox<T>(
  region: Region,
  state: Loadable<T>,
  readyRenderer: ReadyRenderer<T>
): HTMLElement {
  const box = document.createElement("div");
  box.className = `state-box state-box--${region}`;
  box.dataset["region"] = region;
  box.dataset["state"] = state.status;

  switch (state.status) {
    case "empty": {
      box.appendChild(plainBlock("state-empty", STATE_LABELS.empty));
      break;
    }
    case "loading": {
      // A skeleton the size of the ready content. Its height is set by the
      // region's CSS, not inline, so it matches the ready box.
      const skeleton = document.createElement("div");
      skeleton.className = "state-loading skeleton";
      skeleton.setAttribute("aria-busy", "true");
      skeleton.setAttribute("aria-label", STATE_LABELS.loading);
      box.appendChild(skeleton);
      break;
    }
    case "error": {
      const block = plainBlock("state-error", state.message);
      block.setAttribute("role", "alert");
      box.appendChild(block);
      break;
    }
    case "cap_reached": {
      // Show what completed (the ready content for the partial value) plus a
      // plain note that names the cap and its limit.
      box.appendChild(readyRenderer(state.value));
      const note = plainBlock(
        "state-cap",
        `The ${state.reason} spend cap of $${state.limitUsd} was reached, so the run stopped here.`
      );
      note.setAttribute("role", "status");
      box.appendChild(note);
      break;
    }
    case "ready": {
      box.appendChild(readyRenderer(state.value));
      break;
    }
  }

  return box;
}

// The reserved banner slot (R-17). Always present so the layout never shifts;
// empty (no visible text) when demo mode is off, filled with the reason when
// it is on.
export function bannerSlot(active: boolean, reason: string): HTMLElement {
  const slot = document.createElement("div");
  slot.className = "banner-slot";
  slot.dataset["active"] = active ? "true" : "false";
  // A live region so a screen reader hears the banner when it turns on.
  slot.setAttribute("role", "status");
  slot.setAttribute("aria-live", "polite");
  if (active) {
    const text = document.createElement("p");
    text.className = "banner-text";
    text.textContent = reason;
    slot.appendChild(text);
  }
  return slot;
}

// A small helper: a div with a class and a text line.
function plainBlock(className: string, text: string): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  const p = document.createElement("p");
  p.textContent = text;
  el.appendChild(p);
  return el;
}
