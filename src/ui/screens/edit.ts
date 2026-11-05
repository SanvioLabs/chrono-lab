// src/ui/screens/edit.ts
// The edit screen (R-14).
//
// Shows only the fields spec 02 R-01 allows for the selected step's kind, one
// edit at a time:
//   model_call: three single edits, one active at a time, each a radio named
//     "Edit the prompt" / "Edit the model" / "Edit the settings".
//     - the prompt lists the messages as a radiogroup named "message to edit";
//       each message is a radio whose name carries its role and a snippet; the
//       last user message is selected by default. Only the selected message's
//       content is in an editable textbox named "message content"; the others
//       are read-only. On run the edited content replaces that one message and
//       the whole new messages array is sent as the edit. The user never edits
//       the array as raw text.
//     - the model is a text field; the settings a settings editor.
//   tool_result: one editor for output.result.
// No control is shown for a tool_call step or a structural field. In demo mode
// a step is editable only when its id is in demoMode.forkableStepIds; otherwise
// the run action is disabled with a plain note. One button, "Run forward from
// here", posts the fork. The region host in main.ts carries data-region="edit".
//
// focusOnMount controls whether the editor pulls focus into its first field
// when it renders. main.ts passes true only when the selected step changed, so
// opening a step (by click or Enter) lands the keyboard there (R-19) while an
// incidental re-render (a streamed live step, a trace-list refresh) leaves the
// user's focus where they put it. A radio click inside the editor always moves
// focus to the field it opens, since that is a direct user action.

import type {
  Step,
  ModelCallStep,
  ToolResultStep,
  Message,
  ModelSettings,
} from "../../trace/types.js";
import type { StepEdit } from "../../compare/types.js";
import type { DemoMode } from "../state.js";
import type { UiCallbacks } from "../controller.js";
import { el, focus } from "../a11y.js";

type ActiveField = "prompt" | "model" | "settings";

// Renders the edit region content for the selected step. focusOnMount is true
// only when the selected step changed, so focus moves into the editor on open
// but not on an incidental re-render.
export function renderEdit(
  step: Step,
  demoMode: DemoMode,
  callbacks: UiCallbacks,
  focusOnMount: boolean
): HTMLElement {
  const region = el("div", "edit");

  region.appendChild(el("h2", "edit-title", "Change one step, then run forward"));

  if (step.kind === "tool_call") {
    // No edit control for a tool_call or any structural field.
    region.appendChild(
      el(
        "p",
        "edit-note",
        "A tool call cannot be edited. Pick a model call or a tool result to change one step."
      )
    );
    return region;
  }

  const demoDisabled =
    demoMode.active && !demoMode.forkableStepIds.includes(step.id);

  if (step.kind === "model_call") {
    renderModelCallEditor(region, step as ModelCallStep, callbacks, focusOnMount);
  } else {
    renderToolResultEditor(
      region,
      step as ToolResultStep,
      callbacks,
      focusOnMount
    );
  }

  // The run action. Labelled in words (R-21), disabled in demo mode for a step
  // with no prerecorded future, with a plain note saying why.
  const actions = el("div", "edit-actions");
  const run = document.createElement("button");
  run.type = "button";
  run.className = "btn btn--run";
  run.textContent = "Run forward from here";
  run.addEventListener("click", () => callbacks.runForward());
  if (demoDisabled) {
    run.disabled = true;
    const note = el(
      "p",
      "edit-note",
      "This step has no prerecorded future in demo mode. Pick a step that does."
    );
    note.setAttribute("role", "note");
    actions.appendChild(note);
  }
  actions.appendChild(run);
  region.appendChild(actions);

  return region;
}

// The three single edits for a model_call, one active at a time.
function renderModelCallEditor(
  region: HTMLElement,
  step: ModelCallStep,
  callbacks: UiCallbacks,
  focusOnMount: boolean
): void {
  let active: ActiveField = "prompt";

  const picker = el("div", "edit-picker");
  picker.setAttribute("role", "radiogroup");
  picker.setAttribute("aria-label", "what to edit");

  const fieldHost = el("div", "edit-field");

  const fields: Array<{ key: ActiveField; label: string }> = [
    { key: "prompt", label: "Edit the prompt" },
    { key: "model", label: "Edit the model" },
    { key: "settings", label: "Edit the settings" },
  ];

  const radios: HTMLElement[] = [];
  for (const f of fields) {
    const radio = document.createElement("button");
    radio.type = "button";
    radio.className = "edit-pick";
    radio.setAttribute("role", "radio");
    radio.setAttribute("aria-label", f.label);
    radio.textContent = f.label;
    radio.setAttribute("aria-checked", f.key === active ? "true" : "false");
    radio.addEventListener("click", () => {
      active = f.key;
      // Choosing one clears the others so only one field changes.
      callbacks.setEdit(null);
      for (const r of radios) {
        r.setAttribute(
          "aria-checked",
          r.getAttribute("aria-label") === f.label ? "true" : "false"
        );
      }
      // A radio click is a direct user action, so the opened field takes focus.
      fieldHost.replaceChildren(buildField(active, step, callbacks, true));
    });
    radios.push(radio);
    picker.appendChild(radio);
  }

  region.appendChild(picker);
  region.appendChild(fieldHost);
  fieldHost.appendChild(buildField(active, step, callbacks, focusOnMount));
}

// Builds the editor for the currently active model_call field.
function buildField(
  active: ActiveField,
  step: ModelCallStep,
  callbacks: UiCallbacks,
  focusOnMount: boolean
): HTMLElement {
  if (active === "prompt") return buildPromptEditor(step, callbacks, focusOnMount);
  if (active === "model") return buildModelEditor(step, callbacks, focusOnMount);
  return buildSettingsEditor(step, callbacks, focusOnMount);
}

// The prompt editor: a radiogroup of messages, the last user message selected
// by default; only the selected message's content is editable.
function buildPromptEditor(
  step: ModelCallStep,
  callbacks: UiCallbacks,
  focusOnMount: boolean
): HTMLElement {
  const host = el("div", "prompt-editor");

  const messages = step.input.messages.map((m) => ({ ...m }));
  // Default: the last user message. Fall back to the last message if none.
  let selected = lastUserIndex(messages);
  if (selected < 0) selected = messages.length - 1;

  const group = el("div", "message-group");
  group.setAttribute("role", "radiogroup");
  group.setAttribute("aria-label", "message to edit");

  // One editable textbox, re-pointed when the selected message changes.
  const textbox = document.createElement("textarea");
  textbox.className = "message-content";
  textbox.setAttribute("aria-label", "message content");

  const readonlyHost = el("div", "message-readonly");

  const stageEdit = () => {
    const next: Message[] = messages.map((m, i) =>
      i === selected ? { ...m, content: textbox.value } : m
    );
    const edit: StepEdit = {
      kind: "model_call",
      field: "messages",
      value: next,
    };
    callbacks.setEdit(edit);
  };

  const radios: HTMLElement[] = [];
  const renderReadonly = () => {
    readonlyHost.replaceChildren();
    messages.forEach((m, i) => {
      if (i === selected) return;
      const ro = el("div", "message-ro");
      ro.appendChild(el("span", "message-role", m.role));
      ro.appendChild(el("span", "message-ro-text", snippet(m.content)));
      readonlyHost.appendChild(ro);
    });
  };

  const selectMessage = (i: number) => {
    selected = i;
    radios.forEach((r, ri) =>
      r.setAttribute("aria-checked", ri === i ? "true" : "false")
    );
    const msg = messages[i];
    textbox.value = msg ? msg.content : "";
    renderReadonly();
    stageEdit();
  };

  messages.forEach((m, i) => {
    const radio = document.createElement("button");
    radio.type = "button";
    radio.className = "message-radio";
    radio.setAttribute("role", "radio");
    // The accessible name carries the role and a snippet.
    radio.setAttribute("aria-label", `${m.role}: ${snippet(m.content)}`);
    radio.textContent = `${m.role}: ${snippet(m.content)}`;
    radio.setAttribute("aria-checked", i === selected ? "true" : "false");
    radio.addEventListener("click", () => selectMessage(i));
    radios.push(radio);
    group.appendChild(radio);
  });

  textbox.addEventListener("input", stageEdit);

  host.appendChild(group);
  const editArea = el("div", "message-edit-area");
  editArea.appendChild(el("div", "message-edit-label", "Message content"));
  editArea.appendChild(textbox);
  host.appendChild(editArea);
  host.appendChild(readonlyHost);

  // Prime the default selection and staged edit.
  const first = messages[selected];
  textbox.value = first ? first.content : "";
  renderReadonly();
  stageEdit();
  if (focusOnMount) focus(textbox);

  return host;
}

function buildModelEditor(
  step: ModelCallStep,
  callbacks: UiCallbacks,
  focusOnMount: boolean
): HTMLElement {
  const host = el("div", "model-editor");
  host.appendChild(el("label", "model-label", "Model"));
  const input = document.createElement("input");
  input.type = "text";
  input.className = "model-input";
  input.setAttribute("aria-label", "model name");
  input.value = step.input.model;
  const stage = () => {
    const edit: StepEdit = {
      kind: "model_call",
      field: "model",
      value: input.value,
    };
    callbacks.setEdit(edit);
  };
  input.addEventListener("input", stage);
  host.appendChild(input);
  stage();
  if (focusOnMount) focus(input);
  return host;
}

function buildSettingsEditor(
  step: ModelCallStep,
  callbacks: UiCallbacks,
  focusOnMount: boolean
): HTMLElement {
  const host = el("div", "settings-editor");
  host.appendChild(el("div", "settings-label", "Settings (JSON)"));
  const textbox = document.createElement("textarea");
  textbox.className = "settings-input";
  textbox.setAttribute("aria-label", "settings as JSON");
  textbox.value = JSON.stringify(step.input.settings ?? {}, null, 2);
  const warn = el("p", "settings-warn");
  const stage = () => {
    try {
      const parsed = JSON.parse(textbox.value) as ModelSettings;
      warn.textContent = "";
      const edit: StepEdit = {
        kind: "model_call",
        field: "settings",
        value: parsed,
      };
      callbacks.setEdit(edit);
    } catch {
      warn.textContent = "Settings must be valid JSON.";
      callbacks.setEdit(null);
    }
  };
  textbox.addEventListener("input", stage);
  host.appendChild(textbox);
  host.appendChild(warn);
  stage();
  if (focusOnMount) focus(textbox);
  return host;
}

// The tool_result editor: one editor for output.result.
function renderToolResultEditor(
  region: HTMLElement,
  step: ToolResultStep,
  callbacks: UiCallbacks,
  focusOnMount: boolean
): void {
  const host = el("div", "result-editor");
  host.appendChild(el("label", "result-label", "Tool result"));
  const textbox = document.createElement("textarea");
  textbox.className = "result-input";
  textbox.setAttribute("aria-label", "tool result");
  const current = step.output.result;
  textbox.value =
    typeof current === "string" ? current : JSON.stringify(current, null, 2);
  const stage = () => {
    // Try JSON first so a structured result round-trips; fall back to the raw
    // string so plain text works too.
    let value: unknown = textbox.value;
    try {
      value = JSON.parse(textbox.value);
    } catch {
      value = textbox.value;
    }
    const edit: StepEdit = { kind: "tool_result", field: "result", value };
    callbacks.setEdit(edit);
  };
  textbox.addEventListener("input", stage);
  host.appendChild(textbox);
  region.appendChild(host);
  stage();
  if (focusOnMount) focus(textbox);
}

// --- helpers ---

function lastUserIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return i;
  }
  return -1;
}

function snippet(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (oneLine === "") return "(empty)";
  return oneLine.length <= 40 ? oneLine : oneLine.slice(0, 39) + "…";
}
