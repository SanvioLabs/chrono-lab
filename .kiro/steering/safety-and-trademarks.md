---
inclusion: always
---

# Safety and trademarks

The repo, the site and the video are all public. These rules apply to code,
copy, assets, the video and the blog post alike.

## Trademarks and copyrighted material

The rules bar third-party trademarks and copyrighted material without
permission. Time travel is crowded with famous properties, so the theme stays
generic and our own.

Never use, name, quote or imitate:

- Back to the Future, the DeLorean, the flux capacitor, "88 miles per hour",
  "Great Scott", or any character from those films
- Doctor Who, the TARDIS, Daleks, or the show's sound effects
- The Time Machine film designs, Terminator, Primer, Tenet, Loki's Time Variance
  Authority, or any other film or series time device
- Any film quote, film music or film still
- Frankenstein's creature in the classic film look (flat head, neck bolts). The
  character from the 1818 novel is fine; the film studio's design is not

Use instead: our own lab, our own machine, our own words. Clocks, gears,
hourglasses, lightning, glowing glass and branching lines are all generic.

**Music and sound** are original or carry a license that allows this use. Note
the license in `docs/assets.md`.

**Product names** of model vendors and frameworks may appear only where we
describe what Chrono-Lab works with, never as part of our branding.

## The public site

- Rate limits and spend caps from the first deploy. A public AI endpoint gets
  abused
- Visitors can't upload their own traces to the public site. They use the demo
  agent or demo mode
- Anything a visitor types is treated as text. It is escaped on display and never
  run as code
- Sessions and their traces are deleted at expiry
- A short note on screen: don't type anything confidential

## Data

- `demo/` and test fixtures are synthetic. Write them; don't collect them
- No health, children's or payment data, and nothing about a real person beyond
  the team's own names in the credits
- No secret, key or token in a trace, a fixture, a log or a commit

## The video and live tests

- People filmed agree to appear. Adults only
- Review the footage before it's published for anything on a screen that
  shouldn't be: a key, a notification, another project
