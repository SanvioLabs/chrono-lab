# Spec 03: the lab

Paste the prompt below into a new Kiro **Spec** session.

---

Write a spec for Chrono-Lab's web UI, using the theme in `product.md`.

Screens and states I expect the spec to cover:

- **Timeline:** the steps of a run in order, each showing its kind, a short
  summary, tokens and time. Selecting one opens its full input and output
- **Branch tree:** every branch of the run, drawn as lines splitting off at
  their fork points. Replayed steps and live steps look different
- **Edit at a fork point:** the editable fields for the selected step, and a
  clear action to run the future forward
- **Running:** live steps appearing as they arrive, with a way to stop
- **Compare:** two branches side by side, aligned at the fork point, with the
  first difference highlighted and the cost of each
- **Demo mode banner:** shown whenever the app is using prerecorded futures,
  saying why
- Empty, loading, error and cap-reached states for every screen

Layout rule: reserve space for every state of an element up front so nothing
shifts when a state changes.

It must work with a keyboard alone and read correctly with a screen reader. The
theme never hides what a control does.

Include an end-to-end test that drives a browser through record, rewind, edit,
run forward and compare.

The gate for this spec: someone who has never seen Chrono-Lab completes a full
rewind and compare without help.
