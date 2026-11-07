# Spec 05: The Haunted Lab: Requirements

**Date:** 2026-11-07
**Scope:** the costume for the working lab UI from spec 03. A design pass that
turns the clean dark theme into the mad scientist's time lab described in
`product.md` (*The lab theme*), for the Costume Contest category. It changes how
the UI looks, and adds one short sound at the fork moment that is off by
default. It changes no behaviour, no label, no server endpoint and no trace
format.

**Builds on:** spec 03 (the lab UI), built and merged. It reads and extends the
real files: `src/ui/theme/tokens.css`, `src/ui/theme/theme.css`,
`src/ui/draw/treeSvg.ts`, `src/ui/screens/*.ts`, `src/ui/components/*.ts`,
`src/ui/main.ts`, `tests/ui/contrast.test.ts` and `tests/e2e/*.spec.ts`.

**Not in this spec:** the demo agent and prerecorded futures (spec 04, owned by
another teammate). Nothing here touches `src/agent/`, `demo/` or spec 04's
files. The costume has to work with the fake model and the demo fixtures that
exist today, and with whatever spec 04 ships later, because it only dresses what
the UI already draws.

---

## Background

The UI works and is tested. It is a clean dark theme with nothing haunted about
it. The Costume Contest asks for a haunting interface whose spooky design makes
the tool easier to use, not harder. So every spooky element in this spec has a
job:

| Idea | What it means on screen |
|---|---|
| The recorded past | Cold, frosted and ghostly. It is fixed and cannot change |
| The fork point | The moment the timeline cracks |
| The new future | Warmer and alive, lit like a filament |
| Compare | Two futures side by side; the new one is the warm one, the crack is where they part, and the first difference cannot be missed |

The costume has to come off cleanly. A developer can use the tool with the
costume taken off, and every label still says plainly what it does.

The gate for this spec is:

> Someone who has never seen Chrono-Lab looks at a screenshot of the compare
> view and can say which future is the new one and where it split, without
> reading a label.

---

## Glossary

Words from `product.md`, used exactly in code, UI and docs: run, step,
timeline, branch, fork point, future, replay. This spec adds four words for the
costume. They are not trace words.

| Word | Means |
|---|---|
| Costume | All decoration added by this spec: tints, textures, motifs, glow, motion and sound |
| Plain view | The UI with the costume off. The spec 03 look, with every label and behaviour unchanged |
| Crack | The jagged line that marks a fork point. A motif, not a trace word |
| Fork moment | The short moment after "Run forward from here" when the crack draws and the new future lights up |

---

## Plain view and plain words

### R-01: The costume comes off cleanly

**EARS:** The UI shall have a plain view. When the page is opened with the query
`?costume=off`, or when the browser reports `forced-colors: active`, the UI
shall render without any costume: no tints, textures, motifs, glow, motion or
sound. In plain view the full loop (record, rewind, edit, run forward, compare)
shall work exactly as in the costumed view, and every region shall keep its
reserved box.

All costume styling shall live behind one switch, so plain view is one attribute
on the root element and not a second code path.

### R-02: Plain words stay plain

**EARS:** The costume shall not change, pun on, abbreviate or replace any label,
button name, heading or state message that spec 03 defined. These names shall be
unchanged: "Record run", "Run forward from here", "Stop", "Compare with parent",
"Edit the prompt", "Edit the model", "Edit the settings", "first difference",
"fork point", "replayed", "live", "branch A (parent)" and "branch B (new
future)". New text added by this spec (the sound control) shall also say plainly
what it does. Decoration shall carry no text of its own.

---

## What the costume says

### R-03: The recorded past is cold and ghostly

**EARS:** Where the UI shows a replayed step (the timeline, the running log's
replayed prefix, the compare columns, the tree), the costume shall dress it in
the cold set: the `--past` family, a frosted wash and a hairline glass
highlight. The past shall look fixed: no glow and no motion.

### R-04: The fork point is where the timeline cracks

**EARS:** Where the UI shows the fork point (the step with `edited: true`), the
costume shall mark it with the crack motif and the `--fork` family, in the
timeline, the branch tree, the running log and both compare columns. The crack
shall sit at the same step in every place it appears.

### R-05: The new future is warm and alive

**EARS:** Where the UI shows a live step, or a branch's future, the costume
shall dress it in the warm set: the `--future` family and a soft glow. Warm
shall mean only "live, from the fork point on". Nothing replayed shall ever be
dressed warm.

### R-06: Compare says which future is new, where it split, and where it first differs

**EARS:** In the compare view, the costume shall make three facts readable
without reading a label:
1. Which branch is the new future: it turns from cold to warm at the fork point,
   while the parent stays cold.
2. Where the fork point is: a crack divider crosses both columns at the same
   row, and the two columns stay aligned on it.
3. Where the first difference is: the first-difference row carries a distinct
   fill, an outline and a marker on both sides, so it is the strongest mark on
   the screen.

The words ("first difference", "fork point", "branch A (parent)", "branch B (new
future)") stay as spec 03 has them. The costume adds to them; it never replaces
them (R-02, and spec 03 R-20 and R-21).

### R-07: The running log keeps the same story

**EARS:** The running region shall dress its replayed prefix cold, its fork-point
entry with the crack, and each arriving live step warm. A step that is already
on screen shall not animate again when a later step arrives or when the region
re-renders. Only a step that has just arrived is new.

---

## Look and feel

### R-08: Palette tokens, measured

**EARS:** Every colour the costume uses shall be a token in `tokens.css`, with a
dark set (default) and a light set. Every token that carries text or meaning
shall meet the spec 03 thresholds against every background it can sit on, in
both themes: 4.5:1 for text, 3:1 for a graphic that carries meaning (lines, the
crack, the focus ring). The contrast unit test shall be extended to every new
token and every new pair, and its figures shall match the table in `design.md`.

Decoration that carries no text and no meaning (glow, haze, frost hairlines)
shall use a separate class of token that a test proves is never used as a text
colour, and whose opacity is capped so it cannot change a text pair's contrast.

### R-09: No layout shift

**EARS:** The costume shall never change a region's box. Spec 03 R-11 holds in
full: the banner slot, the Stop button, the control row, and every region host
keep the same box across empty, loading, ready, error and cap-reached, and
across the fork moment. Decoration shall not add or remove in-flow height or
width, change a border width, or change a padding. The existing no-reflow
end-to-end checks shall still pass unchanged, and a new check shall measure the
boxes on every frame through the fork moment.

### R-10: Motion respects `prefers-reduced-motion`

**EARS:** All costume animation and transition shall be CSS only and shall be
switched off when `prefers-reduced-motion: reduce` is set. With it set, the fork
moment shall be a static change: the crack, the warm tint and the fork-point
marker appear in their final state with no animation, no transition and no
flash. A test shall prove it in a real browser by sampling the page's running
animations through the whole fork moment.

Outside the fork moment and the arrival of a live step, nothing shall move.

### R-11: Sound is off, labelled, original and short

**EARS:** The fork moment shall have one short sound. The sound shall be off by
default on every page load and shall play only after the user turns it on with
one labelled control that says plainly what it does and shows its state in text.
The sound shall be original: made at run time by the UI's own code, with no audio
file, so there is nothing to license from outside. `docs/assets.md` shall record
the sound, its source and its license. No audio context shall be created before
the user turns sound on. In plain view the sound control and the sound are
absent.

### R-12: Keyboard and screen reader behaviour is unchanged

**EARS:** Spec 03 R-19 and R-20 hold unchanged. Every control keeps its tab
order, key handling, role and accessible name. Every purely decorative element
(each motif, divider, glow layer and texture element) shall be hidden from
assistive technology and shall not be focusable. The focus ring stays visible on
every background the costume introduces.

### R-13: Fast and light

**EARS:** The costume shall add no runtime dependency. It shall be CSS and
hand-written SVG built by the UI's own code. No image file in the repo, the
built UI or the docs shall be larger than 100 KB. The built UI (all files in
`dist/ui`) shall stay under 60 KB gzipped in total. A test shall fail the build
when any of these is broken.

### R-14: Both themes

**EARS:** The light theme shall stay usable and shall carry the same story as
the dark one, as the lab with the lights on: pale washes instead of dark ones,
cast shadow instead of glow, the same cold-to-warm meaning, the same crack. The
full loop shall run and pass its checks under `prefers-color-scheme: light`.

### R-15: Original, generic and plain-spoken

**EARS:** The costume shall use only generic imagery: clocks, gears, hourglasses,
lightning, glowing glass, cracks, fog and branching lines. It shall name, quote
or imitate no film, show, character, device or sound from `safety-and-trademarks.md`,
including in code comments, file names, class names and alt-style text. Every
file this spec writes shall follow `writing.md`: no em dashes, the words from
`product.md`, plain and short.

### R-16: It works under the existing content security policy

**EARS:** The costume shall work under the server's policy from spec 03 R-01a
(same-origin scripts and styles only, no inline script, no third-party
resource). It shall use no inline `style` attribute written as markup, no
`<style>` element, no `data:` URL, no web font and no remote file. Styles set at
run time shall go through the CSS object model. A test shall fail on any
content security policy violation during the full loop.

### R-17: Nothing that works stops working

**EARS:** Every existing unit test and end-to-end test shall pass unchanged. No
existing test shall be edited to make the costume pass, except
`tests/ui/contrast.test.ts`, which is extended and not weakened.

---

## The gate

### R-18: The unlabelled compare check

**EARS:** The costume shall pass this check, run and recorded before the spec is
closed. Take a screenshot of the compare view of a real fork, with all text made
invisible. Show it to at least five adults who agree to take part and have never
seen Chrono-Lab. Ask two questions: "Which future is the new one?" and "Where
did it split?" The check passes when at least four of the five answer both
correctly. The result, the date, the number of people and anything that confused
them are recorded in `tasks.md`. No personal data about the people is recorded.

---

## Out of scope

- A manual theme switch. The light theme still follows `prefers-color-scheme`.
- Any new screen, control (other than the sound control), label or endpoint.
- Web fonts, image files, video, or sound files.
- Recorded or sampled audio of any kind.
- Looping or ambient motion. The costume only moves at the fork moment and when
  a live step arrives.
- Changes to the demo agent, the demo fixtures or the spec 04 files.
