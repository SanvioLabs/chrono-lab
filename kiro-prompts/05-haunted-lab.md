# Spec 05: the haunted lab

Paste the prompt below into a new Kiro **Spec** session.

---

Write a spec for Chrono-Lab's costume: the design pass that turns the working
lab UI from spec 03 into the mad scientist's time lab described in
`product.md` (*The lab theme*), for the Costume Contest category.

The UI works and is tested. It's a clean dark theme with nothing haunted about
it yet. This spec adds the costume without breaking anything that works.

What the costume has to do:

- Make the tool easier to use, not harder. Each spooky element carries meaning:
  - the recorded past should feel like a cold, ghostly timeline
  - the fork point is the moment the timeline cracks
  - the new future is warmer and alive
  - compare is two futures side by side, with the first difference impossible
    to miss
- Stay original. Generic imagery only: clocks, gears, hourglasses, lightning,
  glowing glass, cracks, fog, branching lines. Follow
  `safety-and-trademarks.md` exactly, with no film, show or character
  references, in code comments too.
- Come off cleanly. A developer can use the tool with the costume taken off,
  and every label still says plainly what it does. Plain words stay plain:
  "Run forward from here" doesn't become a pun.

Propose three design directions in the design, with how each one dresses the
timeline, the branch tree, the fork moment, the running log and compare.
Recommend one. Then specify the recommended one fully: palette tokens, type,
textures, SVG motifs, and the motion and sound for the fork moment.

Constraints that carry over from spec 03 and must still hold, with tests:

- **No layout shift (R-11).** Decoration never changes a region's box. The
  existing no-reflow e2e checks still pass.
- **Contrast.** Every text and meaning-carrying token still meets the spec 03
  thresholds on both backgrounds. Extend the contrast test to every new token.
  Supply the measured ratios in the design from a computation, not an estimate.
  If you can't compute them, list the pairs and say so.
- **Motion.** All animation respects `prefers-reduced-motion`. With it set, the
  fork moment is a static change, and a test proves it.
- **Sound** (if the design uses any) is off by default, toggled by a labelled
  control, original or with a license that allows this use. Record the license
  in `docs/assets.md`.
- **Keyboard and screen reader (R-19, R-20)** behaviour is unchanged. Purely
  decorative elements are hidden from assistive technology.
- **Performance.** No new runtime dependency. CSS and hand-written SVG only, no
  image larger than 100 KB, and the bundle stays under 60 KB gzipped.
- **Both themes.** A light theme still exists and stays usable. It can be the
  lab with the lights on.

Write the tests first in tasks.md, as the earlier specs did. The gate for this
spec: someone who has never seen Chrono-Lab looks at a screenshot of the compare
view and can say which future is the new one and where it split, without
reading a label.
