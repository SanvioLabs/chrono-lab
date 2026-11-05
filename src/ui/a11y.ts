// src/ui/a11y.ts
// Focus management, roles and a live region (R-19, R-20).
//
// Small helpers the screens share so keyboard use and screen-reader output stay
// consistent. escapeText is the single safe-text helper: every piece of trace
// content reaches the DOM through textContent, never innerHTML, so a crafted
// string is shown, not run (R-10). announce speaks a message through one shared
// aria-live region so a screen reader hears a step arrive or a state change.

// Sets textContent, never innerHTML. Returns the element for chaining. This is
// the one way trace content reaches the DOM: a string the server recorded is
// shown as text, so markup inside it is inert.
export function setText(el: HTMLElement, text: string): HTMLElement {
  el.textContent = text;
  return el;
}

// Builds an element with a class and optional text, using textContent only.
export function el(
  tag: string,
  className?: string,
  text?: string
): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The one shared polite live region. Created on first use and kept in the DOM,
// off-screen but not display:none (so assistive tech still reads it).
let liveRegion: HTMLElement | null = null;

function ensureLiveRegion(): HTMLElement {
  if (liveRegion) return liveRegion;
  const region = document.createElement("div");
  region.className = "sr-only";
  region.setAttribute("role", "status");
  region.setAttribute("aria-live", "polite");
  region.setAttribute("aria-atomic", "true");
  document.body.appendChild(region);
  liveRegion = region;
  return region;
}

// Announces a message through the shared live region. Clearing first, then
// setting on the next frame, makes a repeat message re-read.
export function announce(message: string): void {
  const region = ensureLiveRegion();
  region.textContent = "";
  // A microtask delay so a repeated identical string is still announced.
  requestAnimationFrame(() => {
    region.textContent = message;
  });
}

// Moves focus to an element if it is focusable, after it is in the DOM. Used to
// pull focus to a newly opened region so a keyboard user lands there.
export function focus(elm: HTMLElement | null): void {
  if (!elm) return;
  if (!elm.hasAttribute("tabindex") && !isNativelyFocusable(elm)) {
    elm.setAttribute("tabindex", "-1");
  }
  elm.focus();
}

function isNativelyFocusable(elm: HTMLElement): boolean {
  const tag = elm.tagName.toLowerCase();
  return (
    tag === "button" ||
    tag === "a" ||
    tag === "input" ||
    tag === "textarea" ||
    tag === "select"
  );
}

// A one-line summary of a step for an accessible name. States the kind in
// words, a short summary, tokens (or "no tokens" for a tool step) and the
// duration, so a screen reader and a colour-blind user both get the meaning
// (R-20). Imported by the timeline, the tree and the running log.
import type { Step, ModelCallStep } from "../trace/types.js";

export function stepKindWords(step: Step): string {
  switch (step.kind) {
    case "model_call":
      return "model call";
    case "tool_call":
      return "tool call";
    case "tool_result":
      return "tool result";
  }
}

// A short, human summary of a step's content (R-12's per-kind rule).
export function stepSummary(step: Step): string {
  switch (step.kind) {
    case "model_call": {
      const out = (step as ModelCallStep).output;
      if (out.finishReason === "tool_calls" && out.toolCalls?.length) {
        const names = out.toolCalls.map((t) => t.name).join(", ");
        return `asks for tool: ${names}`;
      }
      const content = out.message.content.trim();
      return content === "" ? "(no text)" : truncate(content, 80);
    }
    case "tool_call":
      return `calls ${step.input.name}`;
    case "tool_result": {
      const result = step.output.result;
      const text = typeof result === "string" ? result : JSON.stringify(result);
      return `returns ${truncate(text, 80)}`;
    }
  }
}

// Tokens as words: a count for a model call, "no tokens" for a tool step.
export function stepTokensWords(step: Step): string {
  if (step.kind === "model_call") {
    const t = (step as ModelCallStep).tokens;
    return `${t.input + t.output} tokens`;
  }
  return "no tokens";
}

export function stepDurationWords(step: Step): string {
  return `${Math.round(step.durationMs)} ms`;
}

// The full accessible name for a step node, used by the timeline option and the
// running-log entry. role is the timeline role ("replayed", "live" or
// "fork point") for the tree; omitted for the plain timeline.
export function stepAccessibleName(step: Step, role?: string): string {
  const parts = [
    stepKindWords(step),
    stepSummary(step),
    stepTokensWords(step),
    stepDurationWords(step),
  ];
  if (role) parts.unshift(role);
  return parts.join(", ");
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + "…";
}
