# Spec 05: The Haunted Lab: Design

**Date:** 2026-11-07

---

## Overview

The costume is a layer over the UI that spec 03 built. It adds one stylesheet,
a few hand-written SVG motifs, one small sound module and a handful of tokens.
It changes no label, no endpoint, no trace field and no keyboard behaviour.

```
src/ui/theme/tokens.css     modified: new tokens (washes, edge, haze, timing, display type)
src/ui/theme/theme.css      modified: motion removed (it moves to costume.css), dead spine rules removed
src/ui/theme/costume.css    new: every costume rule, all behind one switch
src/ui/draw/timelineSvg.ts  deleted: dead code from spec 03 (Task 2, its own commit)
src/ui/draw/motifs.ts       new: clock, gear, hourglass, bolt as pure descriptors
src/ui/draw/crack.ts        new: the wide crack geometry, pure and deterministic
src/ui/draw/treeSvg.ts      modified: pathLength on the crack, aria-hidden, bead shine
src/ui/fresh.ts             new: which steps have just arrived, pure
src/ui/sound.ts             new: the fork moment sound, made at run time
src/ui/costume.ts           new: the plain view switch and the fork moment beats
src/ui/main.ts              modified: import costume.css, boot costume, header, beats
src/ui/index.html           modified: data-costume="on" on <html>
src/ui/screens/timeline.ts  modified: crack decoration on the fork point option
src/ui/screens/running.ts   modified: fresh marker, crack, gear
src/ui/screens/compare.ts   modified: data-branch, data-role, crack divider, headers
tests/repo/banned-names.test.ts  new: scans the repo against the steering list
```

### What reading the real UI showed

These facts shaped the design. Each one comes from the code as it is today.

1. **`tokens.css` is read by a test with a simple parser.**
   `tests/ui/contrast.test.ts` takes the first `:root { ... }` body with a
   `[^}]*` match and reads 6-digit hex values. So the new token blocks must have
   no `}` inside them (not even in a comment), measured tokens must be 6-digit
   hex, and the light set must stay in the `@media (prefers-color-scheme: light)`
   block.
2. **The server's policy blocks the usual shortcuts.** spec 03 R-01a sets
   `default-src 'self'; style-src 'self'`. With no `img-src`, images fall back to
   `default-src`, so a `data:` URL background is blocked, and so is an inline
   `style` attribute written as markup. Textures therefore have to be CSS
   gradients or SVG elements built in the DOM. Styles set from code must use the
   CSS object model (`element.style.setProperty`), which the policy allows.
3. **The new branch is not in the tree while the fork runs.** `main.ts` builds
   the tree from the saved trace list, so the new branch's column only appears
   when the fork is done. At the moment of "Run forward from here" the things on
   screen are the timeline (the step being forked), the edit region and the
   running region. So the fork moment has two beats, not one (see below).
4. **Every live step re-renders the running region, and the animation replays.**
   `renderRunningRegion` rebuilds all entries on each arriving step, and
   `theme.css` keys `fork-draw` on `data-role="live"` and `data-role="fork point"`.
   So all live entries animate again on every new step. The costume fixes this
   with a freshness tracker (`fresh.ts`).
5. **`drawTimelineSpine` is not used.** `src/ui/draw/timelineSvg.ts` defines it
   and `theme.css` styles it, but `timeline.ts` never calls it. The role rail
   today is the 4px left border on each timeline option. The costume dresses the
   options, not the spine. **Decision (owner, 2026-11-07):** delete
   `drawTimelineSpine` and anything only it uses, as its own task at the start of
   the build (Task 2), in a separate commit, under this spec and not under spec 03.
6. **The only motion today is in `theme.css`, with a reduced-motion rule that
   covers two selectors.** The costume moves all motion into `costume.css` and
   replaces the narrow rule with a global one.
7. **Roles already have one source.** `stepRoleWords(step)` returns "replayed",
   "live" or "fork point" and every region already writes it to `data-role`.
   The costume keys on that same attribute, so cold, warm and crack mean the same
   step everywhere, with no second classification.

### What this spec changes in spec 03's design

spec 03 said "No sound" and "one short, purposeful animation, and only there".
This spec supersedes both for the fork moment only: the animation grows to two
beats and one optional sound is added. `product.md` lists "sound and animation
beyond the fork moment" as stretch item 4. Nothing here goes beyond the fork
moment, so it is inside the base scope. It is still the last build task, and the
first to cut if the weekly gate slips.

---

## Three design directions

Each direction dresses the same five things. All three keep the same meaning:
past cold and fixed, fork point cracked, new future warm.

| | A. Frost and Filament | B. Brass and Lamplight | C. Phosphor Scope |
|---|---|---|---|
| **Idea** | A lab at night. The recorded past is frosted glass. The new future is a lit filament. The fork is a lightning crack | A workshop of brass and clockwork. The past is tarnished, the future is polished | A bench instrument. Black glass, traces drawn in phosphor, scanlines |
| **Timeline** | Rows are glass panes with a cold wash and a hairline edge. Live rows glow warm. The fork point row has a crack across its top edge | Rows are brass plates on a rail. Past plates are dull, live plates are bright. The fork point is a snapped link | Rows are lines of a readout. Past in dim green, live in bright green. The fork point is a trigger marker |
| **Branch tree** | Cold lines and glass beads. The crack jag in purple at the fork point. The new branch line turns amber and glows | Gear-toothed nodes on pipes. The new branch is a bright pipe | Waveform traces. The new branch is a trace that splits off and brightens |
| **Fork moment** | The crack draws across (300 ms), the fork row flashes once (250 ms), the new line lights up and live steps fade in warm. Optional crack-and-kindle sound | A gear clunks one tooth and the new plate polishes up | A scanline sweep, then the trace brightens |
| **Running log** | Cold replayed prefix, a crack, then warm live entries. A small gear ticks one tooth per arriving step | Plates stack up, each stamped as it lands | Lines print on the scope as they arrive, with a cursor |
| **Compare** | Two panes. The parent stays cold all the way down. The new one is cold above the crack and warm below it. The first difference has a red fill, outline and notch on both sides | Two ledgers side by side. The new one has bright brass below the break | Two scopes. The new trace is brighter below the split |
| **Strength** | Cold against warm differs in hue and in lightness. The fork token (purple) already exists and is measured. Smallest change from spec 03. Most haunting: frost, fog, lightning | Rich and distinctive | Reads as a developer tool; easy to take off |
| **Risk** | Too much glow can blur text. Controlled by capped opacity and a contrast test | Warm against warm: the past and the new future are hard to tell apart, especially for colour-blind users. Heavy ornament costs bytes and tempts layout change | One hue family makes past and future hard to tell apart. Scanlines hurt reading. Less spooky, which is what the category scores. Glitch effects tempt looping motion |

### Recommendation: A, Frost and Filament

**Decision (owner, 2026-11-07): direction A.**

A is the only direction where the story is told by two different hues and by
lightness, so the unlabelled compare check has the best chance, including for
people with colour vision differences (the crack and the notch carry it where hue
cannot). It reuses the three role colours spec 03 already measured (`--past`,
`--future`, `--fork`), so the contrast risk is limited to a few new wash tokens.
Frost, fog and lightning are the most haunting imagery on the safe list, and all
of it is CSS gradients and a few small SVG paths, so it is the cheapest to ship.
B fails the "cold against warm" test. C is the easiest to take off but the least
spooky, and the category scores spooky design that helps.

Everything below specifies direction A.

---

## The recommended direction in full

### One switch: the costume attribute

`index.html` sets `data-costume="on"` on `<html>`. `main.ts` calls
`initCostume()` first, before any region is built:

- If the URL has `?costume=off`, set `data-costume="off"`.
- `costume.css` is wrapped in `@media (forced-colors: none)`, so a forced-colors
  browser gets plain view with no code.

Every rule in `costume.css` starts with `[data-costume="on"]`. There is no other
way costume styling applies. Plain view is therefore the spec 03 look, with its
motion removed (the old `fork-draw` and its reduced-motion rule leave
`theme.css`).

```css
/* costume.css: the only shape a rule may take */
@media (forced-colors: none) {
  [data-costume="on"] .timeline-option[data-role="replayed"] { /* ... */ }
}
```

In plain view the sound control and every `[data-decor]` element are
`display: none`.

### Palette tokens

Existing tokens keep their values (`--bg`, `--surface`, `--ink`, `--ink-dim`,
`--past`, `--future`, `--fork`, `--diff`, `--line`, `--focus`, `--danger`, and
the figures spec 03 recorded for them). New tokens go in `tokens.css`, in the
dark block and in the light media block.

**Measured tokens.** Solid 6-digit hex. They sit behind text or carry meaning, so
they are tested against thresholds.

| Token | Dark | Light | Role |
|---|---|---|---|
| `--past-wash` | `#0f1a30` | `#f5f9ff` | Fill behind replayed rows and the parent column. Frosted glass in the dark, pale glass in the light |
| `--future-wash` | `#261b0e` | `#fff8ec` | Fill behind live rows and the new future. Lit filament in the dark, warm paper in the light |
| `--fork-wash` | `#1c1430` | `#f8f3ff` | Fill behind the fork point row |
| `--diff-wash` | `#2b1219` | `#fff1f3` | Fill behind the first difference row |

These values are the candidates that were measured on 2026-11-07 (next section).
All 25 pairs pass in both themes with them. The text token is never changed to
rescue a wash, because the text tokens belong to spec 03.

**The light `--past-wash` must not go darker than `#f5f9ff`.** It carries the
tightest pair (see below). If any wash moves, every pair on it is measured again
before the change is kept.

**Decoration tokens.** Not text and not meaning. A test proves they are never
used as a text colour and that, when used in a `background`, their opacity is at
most 0.15, so they cannot move a text pair's contrast.

| Token | Dark | Light | Used for |
|---|---|---|---|
| `--edge` | `rgba(200, 225, 255, 0.10)` | `rgba(22, 26, 36, 0.08)` | The glass edge: an inset 1px highlight in the dark, a soft edge in the light |
| `--haze-cold` | `rgba(78, 163, 255, 0.07)` | `rgba(31, 111, 214, 0.05)` | Fog at the foot of the timeline and tree hosts |
| `--haze-warm` | `rgba(255, 178, 76, 0.08)` | `rgba(154, 86, 0, 0.05)` | Warm bloom behind live rows |
| `--moon` | `rgba(150, 190, 255, 0.06)` | `rgba(255, 255, 255, 0.60)` | The page backdrop light |
| `--fork-glow`, `--future-glow` | unchanged | unchanged | Existing. Used in `box-shadow` and `filter` only |

The light `--moon` is above 0.15 because it is a page backdrop behind no text
and is exempt by name from the cap; the cap applies to the other three. The test
lists this one exception by name, so it cannot spread.

**Timing and type tokens** (no contrast, not measured): `--crack-draw-ms: 300ms`,
`--flash-ms: 250ms`, `--tick-ms: 250ms`, plus the existing `--fork-draw-ms: 450ms`.
`--font-display`: `ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino,
Georgia, serif`. `--font-readout` is `var(--font-mono)`.

#### Contrast pairs, measured 2026-11-07

Every pair was computed with the WCAG 2.x relative-luminance formula, on the
current `tokens.css` values and the wash values in the table above. There are 25
pairs per theme, 50 in total, on top of spec 03's. All pass in both themes.
Failures: none.

| Foreground | Background | Min | Dark | Light |
|---|---|---|---|---|
| `--ink` | `--past-wash` | 4.5:1 | 14.66 | 16.46 |
| `--ink` | `--future-wash` | 4.5:1 | 14.25 | 16.47 |
| `--ink` | `--fork-wash` | 4.5:1 | 14.89 | 15.95 |
| `--ink` | `--diff-wash` | 4.5:1 | 14.75 | 15.84 |
| `--ink-dim` | `--past-wash` | 4.5:1 | 7.09 | 5.95 |
| `--ink-dim` | `--future-wash` | 4.5:1 | 6.90 | 5.95 |
| `--ink-dim` | `--fork-wash` | 4.5:1 | 7.21 | 5.76 |
| `--ink-dim` | `--diff-wash` | 4.5:1 | 7.14 | 5.73 |
| `--past` | `--past-wash` | 4.5:1 | 6.61 | 4.62 |
| `--future` | `--future-wash` | 4.5:1 | 9.41 | 5.37 |
| `--fork` | `--fork-wash` | 4.5:1 | 7.54 | 6.07 |
| `--diff` | `--diff-wash` | 4.5:1 | 6.35 | 5.41 |
| `--fork` | `--past-wash` | 3:1 | 7.42 | 6.27 |
| `--fork` | `--future-wash` | 3:1 | 7.21 | 6.27 |
| `--fork` | `--diff-wash` | 3:1 | 7.47 | 6.03 |
| `--line` | `--past-wash` | 3:1 | 3.54 | 3.55 |
| `--line` | `--future-wash` | 3:1 | 3.44 | 3.56 |
| `--line` | `--fork-wash` | 3:1 | 3.59 | 3.44 |
| `--line` | `--diff-wash` | 3:1 | 3.56 | 3.42 |
| `--focus` | `--past-wash` | 3:1 | 12.55 | 5.50 |
| `--focus` | `--future-wash` | 3:1 | 12.20 | 5.51 |
| `--focus` | `--fork-wash` | 3:1 | 12.75 | 5.33 |
| `--focus` | `--diff-wash` | 3:1 | 12.63 | 5.30 |
| `--diff` | `--past-wash` | 3:1 | 6.31 | 5.62 |
| `--diff` | `--future-wash` | 3:1 | 6.13 | 5.62 |

The first 12 rows are text pairs (4.5:1): row text, step meta and labels on each
wash, and each role word on its own wash (the kind word, the "fork point" label,
the "first difference" mark). The last 13 are graphic pairs (3:1): the crack
across a row or divider, rails and tree lines, the focus ring (spec 03 R-19) and
the first difference outline.

**The tightest pair is `--past` on `--past-wash` in the light theme, at 4.62
against a minimum of 4.5.** It is the first to fail if the light wash moves
darker. That is why the light `--past-wash` must not go darker than `#f5f9ff`.
Lightening it only helps.

The extended contrast test asserts every figure above to two decimals (the
computed ratio, rounded half up to two decimals, equals the figure), as well as
the threshold. A figure that no longer matches means a token moved. Fix the
token, or measure again and update this table in the same commit.

Rule for the build: role-coloured text (`--past`, `--future`, `--fork`, `--diff`)
may sit only on `--bg`, `--surface`, or its own wash, because those are the
pairs measured. On any other wash, text uses `--ink`. In the light theme the
washes are chosen lighter than `--bg` for exactly this reason: `--past` on `--bg`
is close to its limit in spec 03's table, so a wash darker than `--bg` would push
it under. The 4.62 figure above confirms how little room there is.

The contrast test cannot see gradient layers or the glow in the browser. The
decoration-token cap and the "never a text colour" lint cover that gap. The
end-to-end test does not sample pixels.

### Type

No web font (R-16, R-13). The costume adds two stacks and changes no size.

- **Display** (`--font-display`, serif) for the page title (`.app-title`), the
  region titles (`.edit-title`, `.compare-title`) and the compare column titles.
  A serif at the same `--step-*` sizes reads as a lab notebook label against the
  system sans body.
- **Readout** (`--font-readout`, the mono stack) with
  `font-variant-numeric: tabular-nums` for the compare footer, the step meta
  (tokens, duration) and the cap note, so digits do not change width as values
  update.
- Body text, buttons and inputs keep `--font-ui`. All sizes are unchanged, so
  wrapping inside the fixed-height hosts is unchanged.

### Textures

All CSS, layered as backgrounds, all behind the content. None is a pseudo-element
placed over text.

| Texture | How | Where |
|---|---|---|
| Glass edge | `box-shadow: inset 0 1px 0 var(--edge)` | Every region host, every timeline option |
| Fog | A `linear-gradient` from `transparent` up to `--haze-cold`, in the lowest 35 percent of the host | Timeline and tree hosts |
| Frost streaks | `repeating-linear-gradient(115deg, var(--haze-cold) 0 1px, transparent 1px 14px)` over the wash | Replayed rows only |
| Warm bloom | A `radial-gradient` of `--haze-warm` at the left edge | Live rows only |
| Moonlight | A `radial-gradient` of `--moon` at the top centre of `body` | The page |

No SVG noise filter (`feTurbulence`): it repaints expensively on a large area, and
a grain you cannot see does not help the tool. No scanlines: they hurt reading.

### SVG motifs

Four motifs plus the crack. All are hand-written, built from a pure descriptor,
drawn with `stroke: currentColor` and no fill, on a 24 by 24 viewBox. Total
serialised size is under 3 KB.

| Motif | Looks like | Carries this meaning | Where |
|---|---|---|---|
| `clock` | A round dial, twelve ticks, two hands set at ten past ten | This is a tool about time | Page header, left of the title |
| `hourglass` | Two bulbs, sand settled at the bottom | The recorded past, finished | Compare column header for branch A (parent) |
| `bolt` | A lightning zigzag | The new future, live current | Compare column header for branch B (new future) |
| `gear` | A six-tooth cog | A run in progress | Running region, only while a run is live |
| crack | A jagged line, 4 points when short, 6 to 9 when wide | The fork point | Timeline, running log, compare, tree |

Rules for every motif:

- The root `<svg>` carries `aria-hidden="true"`, `focusable="false"` and
  `data-decor`. It has no `<title>` or `<text>`.
- It never sits inside a control's accessible name. A motif next to a label is a
  sibling or a hidden child, and the label keeps the name.
- Colour comes from a measured token through `color`: `--past` for the clock and
  hourglass, `--future` for the bolt and gear, `--fork` for the crack.
- It is positioned absolutely or sits in a slot that already exists. It never
  adds in-flow size.

#### The crack geometry (`draw/crack.ts`)

The tree already has `crackPoints(x1, y1, x2, y2)`, a four-point jag with exact
endpoints, tested in `tests/ui/treeSvg.test.ts`. It stays as it is. The wide
crack is a new pure function:

```typescript
// Points of a jagged line across a box. The first point is (0, height / 2) and
// the last is (width, height / 2). Every y is inside [0, height]. The same
// seed always gives the same points, so a screenshot is reproducible and the
// crack does not change between renders. The seed is the branch run id.
export function wideCrackPoints(
  width: number,
  height: number,
  segments: number,
  seed: string
): Array<[number, number]>;
```

The seed comes from the run id so two forks of the same run do not crack
identically, and nothing uses `Math.random`. The crack is drawn as a `polyline`
with `pathLength="1"`, so the draw-on animation is a single dash offset.

### How each screen is dressed

This table is the contract. A cell names what the costume adds. The words and
behaviour come from spec 03 and do not change.

| Screen | Replayed (cold) | Fork point (crack) | Live (warm) |
|---|---|---|---|
| Timeline option | `--past-wash`, edge, frost streaks, rail `--past` | `--fork-wash`, rail `--fork`, a wide crack along the top edge (absolute, 8px tall, in the 8px gap) | `--future-wash`, warm bloom, rail `--future`, soft `--future-glow` |
| Running log entry | Same as timeline replayed, in the prefix box | Same as timeline fork point; a crack divider at the foot of the prefix box | Same as timeline live; arrives with the draw-in |
| Branch tree | Cold lines, glass beads (a small shine circle on each node) | The `--fork` jag, drawn on; the diamond pulses once | The new line in `--future` with a soft glow, drawn on |
| Compare column | Parent column cold throughout. In the new column, rows above the crack are cold | A wide crack across the top of the fork point row in both columns, at the same row | The new column from the fork point down is warm. The parent column stays cold |
| Compare first difference | n/a | n/a | `--diff-wash` fill, the existing 2px `--diff` outline, a 4px inset notch in `--diff` on the left, the existing "first difference" text. On both sides, same row |

Each cell is chosen by `data-role` ("replayed", "live", "fork point"), which the
screens already write, plus `data-branch="parent"` or `"new"` on the compare
columns. Nothing new is classified in the costume layer.

#### Compare in detail

This is the view the gate screenshot shows, so it gets the most care.

- `compare.ts` adds `data-branch="parent"` and `data-branch="new"` to the two
  columns and `data-role` (from `stepRoleWords`) to every row.
- The crack goes on the row that is the fork point in the new column (the first
  step with `edited: true`), and on the row at the same index in the parent
  column. If the new column has no edited step (not expected, since compare is
  only offered from a fork), the crack uses `firstDiff.index`. If neither exists,
  there is no crack.
- The crack is an absolutely positioned child of the row, 8px tall, centred on
  the row's top edge. Rows have a 4px top and bottom padding and no gap, so the
  crack lies inside two paddings and crosses no text. Both columns use the same
  index, so the cracks line up whenever the rows do (rows already align by
  index in spec 03).
- Column headers get a motif: hourglass for branch A (parent), bolt for branch B
  (new future). The header text is unchanged.
- The first difference is the loudest mark on the screen: a fill, an outline and
  a notch, on both sides. On a grey-scale view, the notch and outline still show
  where it is.
- The footer uses the readout face and `--edge` cells. Its labels and values are
  unchanged.

#### Running region in detail

- The prefix box gets a crack as an absolute child at its foot, drawn on at the
  first beat.
- A gear sits at the right end of the fixed-height control row (`position:
  absolute`, so the Stop button does not move). It exists only while the run is
  live, and advances one tooth (30 degrees) for each step that has just arrived.
  The tooth is a one-shot `--tick-ms` rotation keyed on the fresh marker. When
  the run finishes, the gear is gone and "Compare with parent" takes its place in
  the same row as before.

### Freshness: only a step that just arrived animates

`fresh.ts` is a small pure tracker:

```typescript
export interface FreshTracker {
  // Returns the ids not seen before and remembers them.
  mark(ids: readonly string[]): Set<string>;
  // Forgets everything. Called when a new fork starts.
  reset(): void;
}
export function createFreshTracker(): FreshTracker;
```

`renderRunning` asks the tracker which live step ids are new and sets
`data-fresh="true"` on those entries only. `costume.css` runs `fork-draw` on
`[data-fresh="true"]`, not on `[data-role]`. A re-render caused by a later step,
by the finished branch loading or by a trace-list refresh therefore animates
nothing that was already on screen. `renderRunning` calls `reset()` when it is
given zero live steps and the run is not finished, which is the state at the
start of every fork.

### The fork moment

Two beats. Both are driven by one attribute on `#app`, `data-fork-moment`, set by
`costume.ts` and cleared by a timer. The attribute is set even when reduced
motion is on, so tests can see the beats happen; CSS that reads it does nothing
under reduced motion.

| Beat | When | What moves |
|---|---|---|
| `start` | `runForward()` is called. Lasts 900 ms | The crack at the foot of the replayed prefix draws across (`--crack-draw-ms`, from 0 ms). The fork point entry flashes in `--fork-glow` once (`--flash-ms`, from 200 ms). Each live entry that arrives draws in warm (`--fork-draw-ms`). The gear ticks. The sound plays if it is on |
| `settle` | The fork is done and the saved branch is loaded. Lasts 900 ms | In the tree, the crack draws on, the diamond pulses once, and the new branch line draws on in `--future`. In the timeline of the new branch, the crack on the fork point row draws on |

The compare view has no motion. It is a place to read, not a moment.

Final state: every keyframe animates *from* a hidden or offset state *to* the
element's normal style, so the normal style is the end state. Nothing relies on
`animation-fill-mode: forwards`. Remove the animation and the end state is
already on screen.

```css
@keyframes crack-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes fork-flash { from { box-shadow: 0 0 0 0 var(--fork-glow); }
                        50%  { box-shadow: 0 0 12px 3px var(--fork-glow); }
                        to   { box-shadow: 0 0 0 0 var(--fork-glow); } }
@keyframes fork-draw  { from { opacity: 0; transform: translateX(-6px); }
                        to   { opacity: 1; transform: translateX(0); } }
```

Nothing in the beats changes layout. Only `opacity`, `transform`, `box-shadow`,
`stroke-dashoffset` and `filter` animate. `fork-draw` moves an entry 6px left to
right inside its own box, which is what spec 03 already does.

#### Reduced motion

`costume.css` ends with one global rule:

```css
@media (prefers-reduced-motion: reduce) {
  [data-costume="on"] *,
  [data-costume="on"] *::before,
  [data-costume="on"] *::after {
    animation: none !important;
    transition: none !important;
  }
}
```

A global rule can be proved complete, where a list of selectors drifts. There is
no motion written in JavaScript. The beats only set an attribute, and the sound
is not motion. With reduced motion set, the fork moment is a static change: the
crack, the washes and the fork marker are on screen in their final state from
the first frame they exist.

### Sound

**Decision (owner, 2026-11-07): sound is the last build task and the first to
cut. It is stretch item 4 in `product.md`.**

One sound, for the `start` beat only, made at run time with the Web Audio API.
There is no audio file, so there is nothing to host, nothing to fetch (which the
policy would also have to allow), and no outside license.

- **Control.** One button in the page header, right aligned, with the visible
  text `Sound: off` or `Sound: on`, or `Sound: unavailable` (disabled) if the
  browser cannot make a context. The button has a fixed width (19ch) so the text
  change moves nothing. It is a plain button, so it is in the tab order and
  works with Enter and Space. On change it calls `announce("Sound on")` or
  `announce("Sound off")`.
- **Default.** Off, on every page load. It is not stored.
- **Context.** `AudioContext` is created the first time the user turns sound on
  (a user gesture, which browsers require). It is never created before. Turning
  sound off suspends it.
- **The sound** (about 450 ms, quiet): a "crack", 90 ms of noise through a
  band-pass filter around 2.5 kHz with a fast exponential fall; then a "kindle",
  a sine tone gliding from 220 Hz to 330 Hz over 220 ms with a soft attack and
  release. Master gain peaks at 0.15.
- **Plain view.** The control is hidden and `playForkMoment` is never called.
- **Reduced motion.** Independent. Sound is not motion, and it is off unless the
  user chose it.

```typescript
// src/ui/sound.ts
export interface SoundContextLike { /* the few AudioContext members used */ }
export interface Sound {
  state(): "off" | "on" | "unavailable";
  toggle(): "off" | "on" | "unavailable";
  playForkMoment(): void;      // no-op unless state() is "on"
}
export function createSound(
  makeContext: () => SoundContextLike | null
): Sound;
```

The factory takes the context constructor as a parameter so a unit test can pass
a fake and count what happens. `docs/assets.md` gets one row: the fork moment
sound, synthesized at run time by `src/ui/sound.ts`, original code, MIT with the
repo, no audio file.

### Content security policy

Checked against the policy from spec 03:

| Costume feature | Allowed because |
|---|---|
| `costume.css`, bundled by Vite | Same-origin stylesheet |
| CSS gradients | Not a fetch |
| SVG motifs built with `createElementNS` and attributes | DOM, not markup in a string with `style=` |
| `stroke-dashoffset`, `filter: drop-shadow` | Plain CSS |
| Run-time `style.setProperty` (gear angle) | The CSS object model is not blocked |
| Web Audio synthesis | Opens no resource |
| `data:` URLs, inline `style=`, web fonts, remote files | Not used |

A lint test fails on any `url(` in the costume CSS, and an end-to-end listener
fails on any `securitypolicyviolation` during the loop.

### Layout rule (spec 03 R-11) and how the costume keeps it

- Decoration is a background layer, a `box-shadow`, a `filter`, or an absolutely
  positioned child with `pointer-events: none`. None of these changes a box.
- Border widths and paddings are untouched. Selected and active states keep
  their spec 03 styles.
- The sound control sits in the header, whose height does not depend on any
  state, with a fixed width. The gear is absolute inside the existing fixed-height
  control row.
- The fork moment animates only properties that cannot change layout.
- A new end-to-end check samples the box of every region, the banner slot and the
  Stop button on every animation frame through both beats.

### Light theme: the lab with the lights on

Same story, different light. Washes are pale glass and warm paper. `--edge` is a
soft shadow edge instead of a highlight. Glow tokens are already softer in the
light set; the glow reads as a faint warm halo. `--moon` becomes a white lift at
the top of the page. The crack keeps `--fork` (a deep purple in the light set).
Nothing changes in meaning, so the unlabelled compare check applies to both
themes.

### Performance budget

No new runtime dependency (`package.json` has none today, only dev dependencies
at pinned versions). No image file. Estimates for the additions, to be checked
by the budget test and not yet measured: `costume.css` about 8 KB raw, motifs
about 3 KB, sound about 2 KB, so roughly 4 to 5 KB gzipped. The whole built UI
must stay under 60 KB gzipped. The baseline is not measured here; Task 1 records
it before any costume code is written. Task 2 deletes dead code, so it can only
lower the number.

---

## Tests

The tests come first (see `tasks.md`). Where each rule is proved:

| Rule | Test | Kind |
|---|---|---|
| Contrast on every new token and pair, both themes, figures held to two decimals (R-08) | `tests/ui/contrast.test.ts` extended with a `PAIRS` list | Unit |
| Decoration tokens never used as text, opacity cap (R-08) | `tests/ui/costume-css.test.ts` | Unit, reads the CSS |
| Every costume rule is behind `[data-costume="on"]` and `forced-colors: none` (R-01) | `tests/ui/costume-css.test.ts` | Unit |
| Global reduced-motion rule present and last (R-10) | `tests/ui/costume-css.test.ts` | Unit |
| No `url(`, `@import`, `@font-face`, `data:` in costume CSS (R-13, R-16) | `tests/ui/costume-css.test.ts` | Unit |
| Motifs hidden from assistive technology, small, no text (R-12, R-13) | `tests/ui/motifs.test.ts` | Unit |
| Wide crack endpoints, bounds, determinism (R-04) | `tests/ui/crack.test.ts` with `fast-check` | Property |
| Only new steps are fresh (R-07) | `tests/ui/fresh.test.ts` | Unit and property |
| Sound: no context before on, off by default, short, quiet, fails quietly (R-11) | `tests/ui/sound.test.ts` | Unit, fake context |
| Bundle under 60 KB gzipped, images under 100 KB, no new runtime dependency (R-13) | `tests/ui/budget.test.ts` | Unit, runs a Vite build |
| No em dashes in the UI source and the new docs (R-15) | `tests/ui/writing.test.ts` | Unit |
| No banned name in `src/`, `docs/`, `README.md` or `kiro-prompts/` (R-15) | `tests/repo/banned-names.test.ts` | Unit, reads the steering file at test time |
| Plain view runs the full loop, labels unchanged (R-01, R-02) | `tests/e2e/costume.spec.ts` | End to end |
| Reduced motion gives a static fork moment (R-10) | `tests/e2e/costume.spec.ts` | End to end |
| No reflow on every frame through the fork moment (R-09) | `tests/e2e/costume.spec.ts` | End to end |
| Light and dark both pass the loop (R-14) | `tests/e2e/costume.spec.ts` | End to end |
| No policy violation (R-16) | `tests/e2e/costume.spec.ts` | End to end |
| Decoration hidden from assistive technology (R-12) | `tests/e2e/costume.spec.ts` | End to end |
| Compare: cold parent, warm new future, aligned crack, first difference mark (R-06) | `tests/e2e/costume.spec.ts` | End to end |
| Sound control default and no context before use (R-11) | `tests/e2e/costume.spec.ts` | End to end |
| Existing no-reflow and keyboard checks (R-09, R-12, R-17) | `tests/e2e/lab.spec.ts`, `cap.spec.ts`, `demo.spec.ts` unchanged | End to end |
| Unlabelled compare check (R-18) | A manual protocol, recorded in `tasks.md` | Manual |

### The banned names scan

**Decision (owner, 2026-11-07): the test reads the names from
`.kiro/steering/safety-and-trademarks.md` itself, at test time. No copy of the
names goes anywhere else in the repo.**

- **Source of the list.** The test finds the line "Never use, name, quote or
  imitate" and reads the bullet list under it, up to the first blank line.
- **Parsing.** Each quoted phrase is a term. The rest of each bullet is split on
  commas. A leading "or " and "the " are dropped, parenthetical text is dropped,
  and an item that starts with "any " is skipped, because it describes a kind of
  thing and is not a name.
- **Sanity floor.** The test fails if it cannot find the line, or if it parses
  fewer than 10 terms. A reformatted steering file therefore fails loudly and
  does not let the scan pass on an empty list.
- **Matching.** Terms are matched as written, as whole words. A one-word term
  matches case-sensitively, because some are also ordinary words when lower case.
  A term of more than one word matches without regard to case.
- **What it scans.** Every text file under `src/`, `docs/` and `kiro-prompts/`,
  plus `README.md`, and the path of each file as well as its contents. It skips
  `.kiro/steering/` (where the list lives), `node_modules/`, `dist/` and binary
  files. A failure names the file, the line and the term.
- **No names in the test.** The test file holds no name. A positive control takes
  the first term it parsed, builds a string around it, and proves the scanner
  flags that string and passes a clean one. This shows the scan can fail without
  writing a name anywhere.
- **What it cannot see.** Look-alikes and imitation (a design, a sound, a
  phrase that is close but not the same). The screenshot review in the review
  task still covers those by eye.

---

### Making the reduced-motion test mean something

A test that says "no animations" passes if the test never sees any. So the
end-to-end test runs the fork twice. With `reducedMotion: "no-preference"` it
must see `document.getAnimations().length > 0` in at least one sample during the
`start` beat. With `reducedMotion: "reduce"` it must see zero in every sample
taken every 50 ms from the click until the fork is done, must see
`data-fork-moment` set (the beats still happened), and must find the final state
in place: the crack polyline fully drawn (`stroke-dashoffset` of 0), the fork
point entry on its `--fork-wash`, and live entries on `--future-wash`.

### Plain view is not a second code path

In plain view the same end-to-end loop assertions run against `/?costume=off`.
Because plain view is one attribute, the test proves the costume is removable:
if a rule leaks outside the switch, the CSS lint fails first.

### What the tests cannot prove

- **Contrast under gradients and glow.** The contrast test works on token pairs.
  The opacity cap and the text-colour lint limit the risk. They do not measure
  pixels.
- **Assistive technology.** Hiding decoration and keeping names is checked by
  attributes and by the existing role queries. Whether a screen reader reads the
  page well still needs manual review.
- **Look-alikes of banned names.** The scan matches names, not imitation.
- **Taste.** Whether the costume is spooky is the judge's call. The unlabelled
  compare check measures only whether it is clear.

---

## The unlabelled compare check (the gate)

1. Run the full loop against the fake model, and open the compare view.
2. Hide all text: inject `*{color:transparent !important;text-shadow:none
   !important}` and take a screenshot of the compare region. The fills, outlines,
   cracks and motifs stay; every word goes.
3. Show it to at least five adults who agree to take part and have never seen
   Chrono-Lab. Ask exactly: "Which future is the new one?" and "Where did it
   split?"
4. Pass when at least four of five answer both correctly. Record the date, the
   count, the result and any confusion in `tasks.md`. Record nothing about who
   they are.
5. Repeat once in the light theme with at least three people.

The screenshot is a test artefact and is not committed.

---

## Open questions for the owner

None. The three questions from the first draft are settled, and each decision is
recorded where it applies: the timeline spine in "What reading the real UI
showed" (item 5), the banned names scan in "The banned names scan", and sound in
"Sound".
