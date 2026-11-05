// src/ui/components/banner.ts
// The demo-mode banner content (R-17).
//
// The reserved slot is the host in main.ts (it carries data-region="banner" and
// role="status" and keeps its box). This renders only the inner content: empty
// (no visible text) when demo mode is off, the plain reason when it is on. The
// e2e test finds the banner by role="status" (on the host) and the name "demo
// mode" when active.

import { el } from "../a11y.js";
import type { DemoMode } from "../state.js";

// Renders the banner's inner content for the current demo-mode state. When off,
// returns an empty placeholder so the host box stays reserved but shows nothing.
export function renderBanner(demo: DemoMode): HTMLElement {
  if (!demo.active) {
    // An empty, zero-content node keeps the host reserved without any text.
    return el("div", "banner-empty");
  }
  // The text carries "demo mode" so the test can find it, plus the server's
  // plain reason.
  return el(
    "p",
    "banner-text",
    `Demo mode: ${demo.reason || "live runs are unavailable, showing prerecorded runs."}`
  );
}
