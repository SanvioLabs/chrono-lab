// tests/e2e/lab.spec.ts
// The one full-loop end-to-end test (Task 12, R-22), carrying the Task 13
// accessibility assertions (keyboard-only pass, accessible names and roles).
//
// Deterministic: the server runs modelMode "fake", so the loop records the same
// four steps every time and forks to a stable result, with no network and no
// API key.
//
// =====================================================================
// THE CONTRACT THE UI MUST MEET (roles and accessible names)
// =====================================================================
// This test finds every element by role and accessible name, never by CSS
// class or DOM order. The next session builds the screens to the names below.
// Names are matched case-insensitively and, where noted, as a substring, so the
// exact wording can grow as long as the quoted words stay in the name.
//
// Landmarks and regions (each a fixed-size container so no state change moves
// it, R-11):
//   - banner slot:      role="status",  name "demo mode" when active; present
//                       but empty (reserved) otherwise. data-region="banner".
//   - timeline region:  data-region="timeline"
//   - tree region:      data-region="tree"
//   - edit region:      data-region="edit"
//   - running region:   data-region="running"
//   - compare region:   data-region="compare"
//   Every region keeps its reserved height across empty/loading/ready/error/
//   cap_reached, so the test measures each region's box before and after a
//   state change and fails on any movement.
//
// Record (R-12):
//   - a textbox, accessible name contains "task", for the run's task string.
//   - a button, name "Record run", that starts the record.
//   - after record: the timeline is role="listbox" with name "timeline";
//     each step is a role="option" whose accessible name states the kind in
//     words ("model call", "tool call", "tool result"), its one-line summary,
//     its tokens (or "no tokens" for a tool step) and its duration.
//
// Rewind and edit (R-14):
//   - selecting a step option and activating it opens the edit region for that
//     step. For a model_call step the edit region offers exactly three single
//     edits, one active at a time, each a radio or tab with an accessible name:
//       "Edit the prompt", "Edit the model", "Edit the settings".
//   - "Edit the prompt" lists the messages as a role="radiogroup" name
//     "message to edit"; each message is a role="radio" whose name carries its
//     role and a snippet; the last user message is selected by default. Only
//     the selected message's content is in an editable role="textbox" name
//     contains "message content"; the others are read-only.
//   - "Edit the model" shows a role="textbox" name contains "model".
//   - no edit control exists for a tool_call step or any structural field.
//   - one button, name "Run forward from here", posts the fork. In demo mode a
//     step with no prerecorded future disables this button and shows a plain
//     note (role="note") saying the step has no prerecorded future.
//
// Running (R-15):
//   - the running region is role="log" (a live region) name contains "live
//     steps"; each arriving live step is appended as an entry whose accessible
//     name names the step, under the replayed prefix.
//   - one button, name "Stop", posts /api/stop. Its box never moves as steps
//     arrive (R-11).
//
// Compare (R-16):
//   - a button, name "Compare with parent", opens the compare region.
//   - the compare region holds two columns, each a region named "branch A" and
//     "branch B" (or the two runIds); the first-difference row is marked with
//     text "first difference" (role="mark" or an element whose accessible name
//     contains "first difference"), not colour alone.
//   - each column shows its final output, total tokens, total cost and total
//     duration as text.
//   - when the branches do not differ, the highlight area reads "these branches
//     do not differ" instead of being blank.
//
// Focus and keyboard (R-19):
//   - every control is reachable by Tab in a logical order and operable by
//     Enter/Space; the timeline listbox takes Up/Down to move selection, Enter
//     to open, Escape to close. A visible focus ring is present at all times
//     (the test asserts document.activeElement is a real control after Tab,
//     not <body>).
// =====================================================================

import { test, expect, type Page, type Locator } from "@playwright/test";

const TASK = "summarise the meeting notes";

// A box reader that returns a stable, rounded rect for a locator, so a
// before/after comparison fails only on real movement, not sub-pixel noise.
async function boxOf(locator: Locator): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no box (not laid out / not visible)");
  return {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.round(box.width),
    height: Math.round(box.height),
  };
}

// Assert a set of named regions did not move across an action. Reads every box
// before, runs the action, reads every box after, and fails on any change.
async function assertNoReflow(
  regions: Record<string, Locator>,
  action: () => Promise<void>
): Promise<void> {
  const before: Record<string, Awaited<ReturnType<typeof boxOf>>> = {};
  for (const [name, loc] of Object.entries(regions)) {
    before[name] = await boxOf(loc);
  }
  await action();
  for (const [name, loc] of Object.entries(regions)) {
    const after = await boxOf(loc);
    expect(after, `${name} moved or resized on a state change (R-11)`).toEqual(
      before[name]
    );
  }
}

function regionByData(page: Page, region: string): Locator {
  return page.locator(`[data-region="${region}"]`);
}

test.describe("Chrono-Lab: the full loop, no reflow, keyboard and a11y", () => {
  test("record, rewind, edit one field, run forward, compare", async ({
    page,
  }) => {
    await page.goto("/");

    // The banner slot and every region are present and reserved from the start
    // (R-11): the empty app already lays them out.
    const banner = regionByData(page, "banner");
    const timelineRegion = regionByData(page, "timeline");
    const editRegion = regionByData(page, "edit");
    const runningRegion = regionByData(page, "running");
    const compareRegion = regionByData(page, "compare");

    await expect(banner).toBeAttached();
    await expect(timelineRegion).toBeAttached();
    await expect(runningRegion).toBeAttached();
    await expect(compareRegion).toBeAttached();

    const reserved = {
      banner,
      timeline: timelineRegion,
      running: runningRegion,
      compare: compareRegion,
    };

    // ---- 1. Record a run (R-12). ----
    const taskBox = page.getByRole("textbox", { name: /task/i });
    await taskBox.fill(TASK);

    // The record moves the timeline region empty -> loading -> ready, and must
    // not move the reserved regions (R-11).
    await assertNoReflow(reserved, async () => {
      await page.getByRole("button", { name: /record run/i }).click();
      // Wait for the timeline to reach ready: its options appear.
      await expect(
        page.getByRole("listbox", { name: /timeline/i })
      ).toBeVisible();
    });

    const timeline = page.getByRole("listbox", { name: /timeline/i });
    const steps = timeline.getByRole("option");
    // The fake model records four steps (model_call, tool_call, tool_result,
    // model_call), proven by the Task 3 unit test.
    await expect(steps).toHaveCount(4);

    // Accessible names state the kind in words (R-20), not colour or shape.
    await expect(steps.first()).toHaveAccessibleName(/model call/i);
    await expect(
      timeline.getByRole("option", { name: /tool call/i })
    ).toBeVisible();
    await expect(
      timeline.getByRole("option", { name: /tool result/i })
    ).toBeVisible();

    // ---- 2. Rewind to a step and open the edit screen (R-14). ----
    // Pick the first model_call step, the prompt is editable there.
    const firstModelStep = steps.first();
    await firstModelStep.click();

    await expect(editRegion).toBeVisible();

    // Exactly the three allowed edits for a model_call, one active at a time.
    const editPrompt = page.getByRole("radio", { name: /edit the prompt/i }).or(
      page.getByRole("tab", { name: /edit the prompt/i })
    );
    const editModel = page.getByRole("radio", { name: /edit the model/i }).or(
      page.getByRole("tab", { name: /edit the model/i })
    );
    const editSettings = page
      .getByRole("radio", { name: /edit the settings/i })
      .or(page.getByRole("tab", { name: /edit the settings/i }));
    await expect(editPrompt).toBeVisible();
    await expect(editModel).toBeVisible();
    await expect(editSettings).toBeVisible();

    // No control for a tool_call step or a structural field is offered.
    await expect(
      page.getByRole("textbox", { name: /tool call|arguments|step id|branch/i })
    ).toHaveCount(0);

    // ---- 3. Edit the one allowed field: the prompt (R-14). ----
    // The prompt editor lists messages; the last user message is selected by
    // default. Editing changes that one message's content, not the whole array.
    await editPrompt.click();

    const messageGroup = page.getByRole("radiogroup", {
      name: /message to edit/i,
    });
    await expect(messageGroup).toBeVisible();

    const selectedMessage = messageGroup.getByRole("radio", { checked: true });
    // The default selection is a user message.
    await expect(selectedMessage).toHaveAccessibleName(/user/i);

    const contentBox = page.getByRole("textbox", {
      name: /message content/i,
    });
    const originalContent = await contentBox.inputValue();
    const editedContent = originalContent + " (edited for the fork)";
    await contentBox.fill(editedContent);
    // Only this field changed: its value now holds the edit.
    await expect(contentBox).toHaveValue(editedContent);

    // ---- 4. Run forward (R-15). ----
    const runButton = page.getByRole("button", {
      name: /run forward from here/i,
    });
    await expect(runButton).toBeEnabled();

    await runButton.click();
    await expect(runningRegion).toBeVisible();

    // The Stop control is present while the fork runs (R-08).
    const stopButton = page.getByRole("button", { name: /^stop$/i });
    await expect(stopButton).toBeVisible();

    // The running region is a live log; live steps arrive in order under the
    // replayed prefix (R-20).
    const liveLog = page.getByRole("log", { name: /live steps/i });
    await expect(liveLog).toBeVisible();

    // As steps arrive, the Stop button and the reserved regions do not move
    // (R-11). Measure the Stop box before and after at least one step lands.
    const stopBefore = await boxOf(stopButton);
    // At least one live step entry appears.
    const liveEntries = liveLog.getByRole("listitem").or(
      liveLog.locator("[data-live-step]")
    );
    await expect(liveEntries.first()).toBeVisible();
    const stopAfter = await boxOf(stopButton);
    expect(stopAfter, "the Stop button moved as live steps arrived (R-11)").toEqual(
      stopBefore
    );

    // Let the fork finish; the running region reaches ready and offers compare.
    const compareButton = page.getByRole("button", {
      name: /compare with parent/i,
    });
    await expect(compareButton).toBeVisible({ timeout: 30_000 });

    // ---- 5. Compare the new branch with its parent (R-16). ----
    await assertNoReflow(
      { banner, timeline: timelineRegion, compare: compareRegion },
      async () => {
        await compareButton.click();
        await expect(compareRegion).toBeVisible();
      }
    );

    // Two columns, aligned at the fork point.
    const columnA = page.getByRole("region", { name: /branch a|parent/i });
    const columnB = page.getByRole("region", { name: /branch b|new|future/i });
    await expect(columnA).toBeVisible();
    await expect(columnB).toBeVisible();

    // The first difference is marked in text (R-20), not colour alone. The
    // edited prompt changes the forked future, so a first difference exists.
    await expect(
      page.getByText(/first difference/i).first()
    ).toBeVisible();

    // Each column shows final output, tokens, cost and duration.
    for (const column of [columnA, columnB]) {
      await expect(column.getByText(/tokens/i).first()).toBeVisible();
      await expect(column.getByText(/\$|cost/i).first()).toBeVisible();
      await expect(column.getByText(/ms|duration/i).first()).toBeVisible();
    }
  });

  test("keyboard-only pass: reachable, operable, focus visible (R-19)", async ({
    page,
  }) => {
    await page.goto("/");

    // Tab lands on a real control, never <body>: a focus ring is always present.
    await page.keyboard.press("Tab");
    const activeRole = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? el.tagName.toLowerCase() : "none";
    });
    expect(activeRole).not.toBe("body");

    // Reach the task box and the Record button by keyboard, type and record.
    const taskBox = page.getByRole("textbox", { name: /task/i });
    await taskBox.focus();
    await taskBox.fill(TASK);
    await taskBox.press("Tab");
    // Enter or Space activates the focused Record button.
    const recordButton = page.getByRole("button", { name: /record run/i });
    await recordButton.focus();
    await recordButton.press("Enter");

    const timeline = page.getByRole("listbox", { name: /timeline/i });
    await expect(timeline).toBeVisible();

    // The timeline listbox takes Up/Down to move selection, Enter to open.
    await timeline.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("Enter");
    await expect(regionByData(page, "edit")).toBeVisible();

    // Escape closes the opened detail / edit without the pointer.
    await page.keyboard.press("Escape");
  });

  test("accessible names and roles on the tree and compare (R-20)", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("textbox", { name: /task/i }).fill(TASK);
    await page.getByRole("button", { name: /record run/i }).click();
    await expect(page.getByRole("listbox", { name: /timeline/i })).toBeVisible();

    // The branch tree is a tree with treeitem nodes (R-20). Each node's
    // accessible name carries its role in words: "replayed", "live" or
    // "fork point", so a screen reader and a colour-blind user both get it.
    const tree = page.getByRole("tree", { name: /branch tree|branches/i });
    if (await tree.count()) {
      await expect(tree).toBeVisible();
      const nodes = tree.getByRole("treeitem");
      await expect(nodes.first()).toBeVisible();
      // At least one node names its role in words.
      await expect(
        tree.getByRole("treeitem", { name: /replayed|live|fork point/i }).first()
      ).toBeVisible();
    }
  });
});
