# Chrono-Lab kickoff

Read this once, top to bottom, before you open Kiro. It takes about ten minutes
and gets you from a fresh clone to Kiro writing the first spec.

Chrono-Lab is a time machine for AI agents. You record an agent run as a
timeline of steps, rewind to any step, change one thing, and let the run play
forward again from there. Then you put the two futures side by side and see
what that one change did.

**Hackathon:** Kiroween 2026, <https://kiroween.devpost.com/>.
**Deadline:** Friday 2026-12-04, 2:00 pm PT, no extensions. We aim to submit by
Wednesday 2026-12-02.

## 0. Before anything else

Where things stand, as of 2026-11-03:

| Question | Answer |
|---|---|
| License | **MIT**, in `LICENSE`. It must show in the repo's About section |
| Repo | **`SanvioLabs/chrono-lab`, private for now.** The rules require a public repo, so it has to be made public before we submit. Don't make it public before then without Pat |
| Entrant | **Sanvio Labs, LLC**, which `LICENSE` names. Pat enters it as the organization's Representative |
| Category | **Costume Contest**, recommended: "a haunting user interface" with "spooky design elements that enhance your app's function". Confirmed at submission |

Work goes on a feature branch, then a pull request into `staging`, then
`staging` into `main`. Both branches are protected: no direct pushes.

## 1. Lay out the folders

Clone the harness, then clone Chrono-Lab into the harness's `projects/` folder.
The harness ignores everything in `projects/`, so nothing of Chrono-Lab is ever
committed to it, and Chrono-Lab keeps its own history:

```
my-harness/              <- sanvio-harness-starter: rules, skills, guards
└── projects/
    └── chrono-lab/      <- this repo, its own git clone
```

```bash
git clone https://github.com/SanvioLabs/sanvio-harness-starter my-harness
cd my-harness
git config core.hooksPath .githooks
python3 scripts/check_setup.py
cd projects
git clone https://github.com/SanvioLabs/chrono-lab.git
cd chrono-lab
git config fetch.prune true
npm install
npm run e2e:install     # Playwright's browser, kept inside this project
npm test
```

**Where to start each tool.** Start Claude Code at the harness root
(`my-harness/`) and point it at `projects/chrono-lab`, so it loads the
harness's rules, skills and guards. Open `projects/chrono-lab` itself as the
Kiro workspace, because Kiro reads `.kiro/` from the workspace root and this
repo's `.kiro/` holds the specs and steering the judges look at.

Nothing gets committed into this repo that you haven't read and meant to
publish.

## 2. Add the harness

**Already done in this copy** (harness commit `4c9a782`, 2026-11-03). The three
`harness-*.md` files are in `.kiro/steering/` and the README lists them. Repeat
this step only to pull in a newer harness.

The harness is `sanvio-harness-starter`: MIT-licensed, public, and it already
works with Kiro. Its rules for how the agent works, replies and handles data
come across as three steering files.

Copy them as real files, not symlinks. A symlink into the harness looks
fine on your machine and arrives on GitHub as a broken link:

```bash
# from projects/chrono-lab, with the harness two folders up
cp -L ../../steering/operating.md       .kiro/steering/harness-operating.md
cp -L ../../steering/response-style.md  .kiro/steering/harness-response-style.md
cp -L ../../steering/data-and-tools.md  .kiro/steering/harness-data-and-tools.md
```

Then two small edits:

- Open each copied file and check the links. Three point at files that only
  exist in the harness (`gates.md`, `../.claude/hooks/guard.py`,
  `../skills/learn/`). Turn those into
  links to `https://github.com/SanvioLabs/sanvio-harness-starter/blob/main/...`
  or delete the sentence
- Fill in the **Pre-existing material** section of `README.md`. The rules require
  us to disclose anything we didn't write during the hackathon, and these three
  files are that. Keep the MIT notice from the harness's `LICENSE`

Everything else in `.kiro/` was written for Chrono-Lab and stays as it is.

## 3. Set up the repo

**Already done:** the repo is `SanvioLabs/chrono-lab`, with `main` and
`staging` protected. To work on it:

```bash
git switch staging && git pull
git switch -c <kind>/<short-name>     # for example spec/04-demo-agent
```

Open a pull request into `staging`. Nobody pushes to `main` or `staging`
directly, and a pull request merges only when Pat says so.

**Keep `.kiro/` committed.** The rules require `/.kiro` at the repo root and not
gitignored. The `.gitignore` leaves it in on purpose.

## 4. Open it in Kiro

1. Open the `chrono-lab` folder in Kiro
2. Check the steering panel lists all seven files in `.kiro/steering/`
3. Open `kiro-prompts/01-trace-and-replay.md` and paste its prompt into a new
   **Spec** session. Let Kiro write the requirements, design and tasks. Read
   them before saying yes to any of it
4. Work the tasks in Kiro. When the first spec's gate passes (see the schedule),
   move to prompt 02

**Kiro builds the application.** The rules require a project "built using Kiro
(IDE, CLI, Web, and/or Kiro Crew)", disqualify "insufficient use of Kiro", and
score how deeply we used it. They don't ban other AI tools. Our own rule is
stricter: Kiro writes the app. Claude Code may review a diff, read the rules, or
start a Kiro CLI run, and when it does, that goes in `docs/kiro-usage.md` too.

## 5. Kiro features to use, and where

Keep `docs/kiro-usage.md` going as you work: a dated line each time you use one
of these for something real. It becomes the write-up, and it's far easier
written as you go than reconstructed on December 1st.

| Feature | Use in Chrono-Lab |
|---|---|
| Specs | One per prompt in `kiro-prompts/`: trace and replay, fork and compare, the lab UI, the demo agent |
| Steering | What's in `.kiro/steering/` now, plus anything we learn the hard way |
| Hooks | Ask Kiro to create three: run the tests when a source file is saved; scan changed copy and assets for the banned names in `safety-and-trademarks.md`, skipping `.kiro/steering/` itself, since the rule file has to name them; flag when code under a spec's folder changes and its `tasks.md` doesn't |
| Property-based tests | Replay of an unchanged prefix reproduces the recorded steps exactly; a fork never changes its parent; the step diff is symmetric; a trace survives a save and load unchanged |
| MCP | Browser automation to drive the UI through a full rewind, edit and compare in a test |
| Custom agents | A safety reviewer that reads every change against `safety-and-trademarks.md`, adapted from the harness's reviewer agents |
| Kiro CLI | Headless spec and task runs alongside the IDE, so the write-up can compare the two |

### Taking more from the harness

The rules allow starter templates and require us to "disclose any other
pre-existing code or work". Open source we use has to keep its license, and
our project has to build on it rather than repackage it. So when we adapt
another piece of `sanvio-harness-starter`, its reviewer agents, its pre-commit
secret check, its gates, add a line for it to the README's **Pre-existing
material** list in the same commit, and say in `docs/kiro-usage.md` what we
turned it into in Kiro.

## 6. Schedule

| Week | Work | Gate that ends it |
|---|---|---|
| Nov 3-8 | Repo, license, credit request. Spec 01: trace format, recorder, replay | A recorded demo run replays to the same final answer with zero model calls |
| Nov 9-15 | Spec 02: fork at a step, edit it, run forward live, compare | Change one step, get a second future, see the two side by side |
| Nov 16-22 | Spec 03 and 04: the lab UI and the demo agent. Public deploy | Someone who has never seen it does a full rewind and compare at the public URL without help |
| Nov 23-29 | Test with three or more real people, fix what they trip on. Thanksgiving is Nov 26 | Three people each find a step that changes the outcome |
| Nov 30-Dec 2 | Make the repo public, video, write-up, blog post, social post, submit | Submitted Dec 2 |
| Dec 3-4 | Buffer only | Closes Dec 4, 2:00 pm PT |

When a week slips, cut from the stretch list in `.kiro/steering/product.md`, never
from the list marked "never cut".

## 7. Rules checklist

Read the official rules once yourself at <https://kiroween.devpost.com/rules>.
This list was last checked against them on 2026-11-03.

- [ ] New repo, and all our code written on or after 2026-10-30
- [ ] Pre-existing material disclosed in the README (the harness steering, any template, anything else adapted)
- [ ] Category named on the form (Costume Contest, unless we change our minds)
- [ ] Public GitHub repo with an open source license showing in the About section
- [ ] `/.kiro` at the repo root and not gitignored
- [ ] All source, assets and run instructions in the repo
- [ ] A working URL, free and open to judges, through 2027-01-29
- [ ] Public YouTube video under 3 minutes, showing it actually working
- [ ] Text description and the write-up of how we used Kiro
- [ ] Kiro credit request filed early. Hard deadline 2026-12-01, 12:00 pm PT. Allow 48 business hours
- [ ] Social post starting with `#KiroweenHackathon26`, published during the period
- [ ] Blog post on a third-party platform that mentions Kiroween 2026

## 8. When you get stuck

Write down what you tried and ask Pat. Don't paper over it: a step that doesn't
work, written up honestly, makes a better Kiro write-up than one that quietly
got done somewhere else.
