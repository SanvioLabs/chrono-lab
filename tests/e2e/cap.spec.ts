// tests/e2e/cap.spec.ts
// The cap-reached end-to-end test (Task 12 bullet 3; Task 14, R-14/R-17).
//
// Runs against the cap server: MODEL_MODE "fake" with a priced fake model and a
// tuned session cap (set in playwright.config.ts). The fake model is free in
// MODEL_PRICES, so a limit alone never trips it; the cap server passes a price
// override and a small cap for this instance only, so a fork trips a real spend
// cap through forkTrace's cap path (a real ForkCapHit, not a stubbed UI state).
// Production pricing and the default caps are unchanged, so removing the cap
// check in forkTrace lets the fork run to the end, the running region never
// reaches cap_reached, and this test fails. That is the non-vacuous check the
// task asks for.
//
// The cap is tuned so the fork's first live model call passes but its second
// trips the cap: the fork emits the edited model call, the echo tool_call and
// tool_result as live steps (the Stop button on screen while they stream), then
// stops at the cap and keeps that partial branch. The test asserts:
//   - the running region reaches cap_reached and names the cap in words;
//   - the partial branch is kept (its live steps are still on screen and a
//     compare with the parent is offered);
//   - the demo banner appears with its reason (R-17);
//   - the banner, the Stop/control row and every region keep their boxes across
//     the change (the same assertNoReflow helper as the full-loop test, R-11).
//
// This file pins its own baseURL to the cap server's port (E2E_CAP_PORT), so it
// never hits the full-loop or demo server.

import { test, expect, type Page, type Locator } from "@playwright/test";

const PORT = process.env.E2E_CAP_PORT;
test.use({ baseURL: `http://127.0.0.1:${PORT}` });

const TASK = "summarise the meeting notes";

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

function regionByData(page: Page, region: string): Locator {
  return page.locator(`[data-region="${region}"]`);
}

test.describe("Chrono-Lab: a fork hits a real spend cap", () => {
  test("cap reached names the cap, keeps the partial branch, shows the banner, no reflow", async ({
    page,
  }) => {
    await page.goto("/");

    const banner = regionByData(page, "banner");
    const timelineRegion = regionByData(page, "timeline");
    const treeRegion = regionByData(page, "tree");
    const editRegion = regionByData(page, "edit");
    const runningRegion = regionByData(page, "running");
    const compareRegion = regionByData(page, "compare");

    await expect(banner).toBeAttached();
    await expect(runningRegion).toBeAttached();

    // Before the cap, the banner slot is reserved but empty: no "demo mode".
    await expect(banner).toHaveText("");

    // ---- Record a run (the recorder itself never checks the cap; only the
    // fork does, so record always succeeds here). ----
    await page.getByRole("textbox", { name: /task/i }).fill(TASK);
    await page.getByRole("button", { name: /record run/i }).click();
    const timeline = page.getByRole("listbox", { name: /timeline/i });
    await expect(timeline).toBeVisible();
    const steps = timeline.getByRole("option");
    await expect(steps).toHaveCount(4);

    // ---- Rewind to the first model_call step and stage the one allowed edit
    // (the prompt editor stages its edit on open). ----
    await steps.first().click();
    await expect(editRegion).toBeVisible();
    const editPrompt = page
      .getByRole("radio", { name: /edit the prompt/i })
      .or(page.getByRole("tab", { name: /edit the prompt/i }));
    await editPrompt.click();
    const contentBox = page.getByRole("textbox", { name: /message content/i });
    await contentBox.fill((await contentBox.inputValue()) + " (edited)");

    // The reserved regions we assert do not move across the cap change (R-11).
    const reserved: Record<string, Locator> = {
      banner,
      timeline: timelineRegion,
      tree: treeRegion,
      edit: editRegion,
      running: runningRegion,
      compare: compareRegion,
    };
    const before: Record<string, Awaited<ReturnType<typeof boxOf>>> = {};
    for (const [name, loc] of Object.entries(reserved)) {
      before[name] = await boxOf(loc);
    }

    // ---- Run forward. The running region renders at once with the Stop
    // button (the fork's first live call waits on the paced fake model, so
    // Stop is on screen well before the cap trips). ----
    const runButton = page.getByRole("button", {
      name: /run forward from here/i,
    });
    await expect(runButton).toBeEnabled();
    await runButton.click();

    await expect(runningRegion).toBeVisible();
    const stopButton = page.getByRole("button", { name: /^stop$/i });
    await expect(stopButton).toBeVisible();

    // The control row holds the Stop button now; measure it while Stop is up,
    // then again after the cap to prove the row keeps its box (R-11).
    const controlRow = runningRegion.locator(".running-controls");
    await expect(controlRow).toBeVisible();
    const controlRowWithStop = await boxOf(controlRow);

    // ---- The second live model call trips the cap. The running region reaches
    // cap_reached and names the cap in words (R-18, R-20). ----
    const capNote = runningRegion.locator("[data-cap-reached]");
    await expect(capNote).toBeVisible({ timeout: 30_000 });
    await expect(capNote).toHaveText(/spend cap/i);
    // It names which cap (session or overall) and that the run stopped.
    await expect(capNote).toHaveText(/session|overall/i);
    await expect(capNote).toHaveText(/stopped/i);

    // ---- The partial branch is kept: the live steps that completed before the
    // cap are still on screen, and a compare with the parent is offered. ----
    const liveLog = page.getByRole("log", { name: /live steps/i });
    await expect(liveLog).toBeVisible();
    const liveEntries = liveLog
      .getByRole("listitem")
      .or(liveLog.locator("[data-live-step]"));
    // The edited model call, the echo tool_call and its tool_result all landed
    // before the cap, so at least one live step is kept.
    expect(await liveEntries.count()).toBeGreaterThan(0);

    const compareButton = page.getByRole("button", {
      name: /compare with parent/i,
    });
    await expect(compareButton).toBeVisible();
    // Stop has been swapped for Compare; the control row keeps the same box.
    await expect(stopButton).toHaveCount(0);
    const controlRowWithCompare = await boxOf(controlRow);
    expect(
      controlRowWithCompare,
      "the running control row moved or resized when Stop became the cap state (R-11)"
    ).toEqual(controlRowWithStop);

    // ---- The demo banner appears with its reason (R-17). ----
    await expect(banner.getByText(/demo mode/i)).toBeVisible();
    await expect(banner).toHaveText(/spend cap/i);

    // ---- No reserved region moved across the cap change (R-11). ----
    for (const [name, loc] of Object.entries(reserved)) {
      const after = await boxOf(loc);
      expect(
        after,
        `${name} moved or resized when the cap was reached (R-11)`
      ).toEqual(before[name]);
    }

    // ---- The cap came from the real path: the fork response was a cap hit,
    // not a stubbed UI state. Re-posting the same fork returns status
    // "cap_hit" from the server (a real ForkCapHit surfaced as JSON). ----
    const parentRunId = await page.evaluate(async () => {
      const res = await fetch("/api/traces", { credentials: "same-origin" });
      const list = (await res.json()) as Array<{
        runId: string;
        parentRunId?: string;
      }>;
      const root = list.find((t) => t.parentRunId === undefined);
      return root ? root.runId : "";
    });
    expect(parentRunId).not.toBe("");

    const forkStatus = await page.evaluate(async (runId) => {
      const trace = (await (
        await fetch(`/api/traces/${runId}`, { credentials: "same-origin" })
      ).json()) as { steps: Array<{ id: string; kind: string }> };
      const firstModel = trace.steps.find((s) => s.kind === "model_call");
      const res = await fetch("/api/fork", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          parentRunId: runId,
          forkPointStepId: firstModel ? firstModel.id : "",
          edit: {
            kind: "model_call",
            field: "model",
            value: "fake",
          },
        }),
      });
      return (await res.json()) as { status: string };
    }, parentRunId);
    expect(forkStatus.status).toBe("cap_hit");
  });
});
