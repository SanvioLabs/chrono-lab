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
//
// When a spend cap is reached the caller passes capInfo: the region keeps the
// partial branch it has (the replayed prefix plus any live step that landed)
// and adds a plain note that names the cap and its limit, so the running region
// itself says what happened in words, not colour (R-18, R-20). The note sits
// inside the fixed-height host, so it does not move the host's box (R-11).
//
// Each entry names its timeline role in words from the step's own flags
// (stepRoleWords): a prefix step reads "replayed", a live step reads "live",
// and the edited fork-point step reads "fork point", so the one step the user
// changed is named as the fork point here, not mislabelled "live" (R-20).

import type { Step } from "../../trace/types.js";
import type { UiCallbacks } from "../controller.js";
import { el, stepAccessibleName, stepRoleWords } from "../a11y.js";

// The cap that stopped a run: its reason and the limit in dollars. Passed only
// when the running region is in the cap_reached state.
export interface RunningCapInfo {
  reason: "session" | "overall";
  limitUsd: number;
}

// Renders the running region content. prefix are the replayed steps (drawn
// above), liveSteps the live steps streamed so far. finished is true once the
// fork completes, when compare is offered. The Stop button sits in a
// fixed-height control row so it never moves as steps arrive. capInfo, when
// given, names the cap that stopped the run in a plain note below the log.
export function renderRunning(
  prefix: Step[],
  liveSteps: Step[],
  finished: boolean,
  callbacks: UiCallbacks,
  capInfo?: RunningCapInfo
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
    prefixBox.appendChild(entry(step));
  }
  region.appendChild(prefixBox);

  // The live log.
  const log = el("div", "running-log");
  log.setAttribute("role", "log");
  log.setAttribute("aria-label", "live steps");
  log.setAttribute("aria-live", "polite");
  for (const step of liveSteps) {
    const item = entry(step);
    item.setAttribute("role", "listitem");
    item.dataset["liveStep"] = "true";
    log.appendChild(item);
  }
  region.appendChild(log);

  // The cap note names the cap in words, so the running region itself says the
  // run stopped at a cap, not colour alone (R-18, R-20). It carries
  // data-cap-reached so the e2e test can find the cap state on the running
  // region.
  if (capInfo) {
    const note = el(
      "p",
      "running-cap-note",
      `The ${capInfo.reason} spend cap of $${capInfo.limitUsd} was reached, so the run stopped here. The partial branch is kept.`
    );
    note.setAttribute("role", "status");
    note.dataset["capReached"] = "true";
    region.appendChild(note);
  }

  return region;
}

// One log/prefix entry: the step's accessible name as text, tinted and labelled
// by its own role (stepRoleWords), so the edited fork-point step reads "fork
// point" rather than "live" (R-20). data-role carries the same word for the
// theme's tint and for the e2e test to read.
function entry(step: Step): HTMLElement {
  const role = stepRoleWords(step);
  const item = el("div", "running-entry");
  item.dataset["role"] = role;
  item.setAttribute("aria-label", stepAccessibleName(step, role));
  item.appendChild(el("span", "running-entry-role", role));
  item.appendChild(el("span", "running-entry-text", stepAccessibleName(step)));
  return item;
}
