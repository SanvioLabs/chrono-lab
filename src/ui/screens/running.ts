// src/ui/screens/running.ts
// The running screen (R-15).
//
// The running region is a live log (role="log", name "live steps"): each
// arriving live step is appended as an entry under the replayed prefix, and a
// live-region announcement names it (R-20). One "Stop" button posts /api/stop
// (R-08). The reserved space is the host in main.ts (it carries
// data-region="running" and a fixed height), so streaming steps do not push the
// Stop button around (R-11); the e2e test measures the Stop button's box as
// steps arrive. On the terminal event the caller moves the region to ready
// (offering compare), cap_reached or error.

import type { Step } from "../../trace/types.js";
import type { UiCallbacks } from "../controller.js";
import { el, stepAccessibleName } from "../a11y.js";

// Renders the running region content. prefix are the replayed steps (drawn
// above), liveSteps the live steps streamed so far. finished is true once the
// fork completes, when compare is offered. The Stop button sits in a
// fixed-height control row so it never moves as steps arrive.
export function renderRunning(
  prefix: Step[],
  liveSteps: Step[],
  finished: boolean,
  callbacks: UiCallbacks
): HTMLElement {
  const region = el("div", "running");

  // The control row holds the Stop (while running) or Compare (when done)
  // action. It keeps a fixed height, so swapping the button does not move the
  // log below it.
  const controls = el("div", "running-controls");
  if (!finished) {
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "btn btn--stop";
    stop.textContent = "Stop";
    stop.addEventListener("click", () => callbacks.stop());
    controls.appendChild(stop);
  } else {
    const compare = document.createElement("button");
    compare.type = "button";
    compare.className = "btn btn--compare";
    compare.textContent = "Compare with parent";
    compare.addEventListener("click", () => callbacks.compareWithParent());
    controls.appendChild(compare);
  }
  region.appendChild(controls);

  // The replayed prefix, shown above the live steps for context.
  const prefixBox = el("div", "running-prefix");
  prefixBox.appendChild(el("div", "running-prefix-label", "Replayed prefix"));
  for (const step of prefix) {
    prefixBox.appendChild(entry(step, "replayed"));
  }
  region.appendChild(prefixBox);

  // The live log.
  const log = el("div", "running-log");
  log.setAttribute("role", "log");
  log.setAttribute("aria-label", "live steps");
  log.setAttribute("aria-live", "polite");
  for (const step of liveSteps) {
    const item = entry(step, "live");
    item.setAttribute("role", "listitem");
    item.dataset["liveStep"] = "true";
    log.appendChild(item);
  }
  region.appendChild(log);

  return region;
}

// One log/prefix entry: the step's accessible name as text, tinted by role.
function entry(step: Step, role: "replayed" | "live"): HTMLElement {
  const item = el("div", "running-entry");
  item.dataset["role"] = role;
  item.setAttribute("aria-label", stepAccessibleName(step, role));
  item.appendChild(el("span", "running-entry-role", role));
  item.appendChild(el("span", "running-entry-text", stepAccessibleName(step)));
  return item;
}
