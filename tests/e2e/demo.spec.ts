// tests/e2e/demo.spec.ts
// The demo-mode end-to-end test (Task 14, R-14/R-17).
//
// Runs against the demo server: MODEL_MODE "demo" with the committed demo/
// fixtures (a root run and one prerecorded future that forks the root at its
// first model_call step). No live call is ever made; the server replays the
// fixtures. The test asserts:
//   - the demo banner shows its reason from first load (R-17);
//   - only the fork points that have a prerecorded future are offered: the
//     root's first model_call step offers "Run forward from here", and a step
//     with no future has the action disabled with a plain note that says why
//     (role="note"), so the name says why it is not offered (R-14, R-17);
//   - running forward from an offered fork point returns that fork point's
//     prerecorded future, not another one: the loaded branch is the committed
//     future, and its fork point is the step we forked from.
//
// This file pins its own baseURL to the demo server's port (E2E_DEMO_PORT), so
// it never hits the full-loop or cap server.

import { test, expect, type Page, type Locator } from "@playwright/test";

const PORT = process.env.E2E_DEMO_PORT;
test.use({ baseURL: `http://127.0.0.1:${PORT}` });

function regionByData(page: Page, region: string): Locator {
  return page.locator(`[data-region="${region}"]`);
}

test.describe("Chrono-Lab: demo mode", () => {
  test("banner from first load, only futured fork points offered, the future belongs to its fork point", async ({
    page,
  }) => {
    await page.goto("/");

    // ---- 1. The demo banner shows its reason from first load (R-17). ----
    const banner = regionByData(page, "banner");
    await expect(banner).toBeAttached();
    await expect(banner.getByText(/demo mode/i)).toBeVisible();
    // The reason is plain text that says live runs are unavailable / prerecorded.
    await expect(banner).toHaveText(/prerecorded|unavailable/i);

    // The server reports the mode and the fork points that have a future. Read
    // it so the test knows which step to expect as offered and which as not.
    const mode = await page.evaluate(async () => {
      const res = await fetch("/api/mode", { credentials: "same-origin" });
      return (await res.json()) as {
        modelMode: string;
        forkableStepIds: string[];
      };
    });
    expect(mode.modelMode).toBe("demo");
    // Exactly one fork point has a prerecorded future in the committed fixtures.
    expect(mode.forkableStepIds.length).toBe(1);
    const futuredStepId = mode.forkableStepIds[0]!;

    // The root run opens on boot, so its timeline is on screen.
    const timeline = page.getByRole("listbox", { name: /timeline/i });
    await expect(timeline).toBeVisible();
    const options = timeline.getByRole("option");
    await expect(options).toHaveCount(4);

    // Read the root run's step ids in order, so the test can map the offered /
    // not-offered fork points to the right timeline options.
    const rootStepIds = await page.evaluate(async () => {
      const list = (await (
        await fetch("/api/traces", { credentials: "same-origin" })
      ).json()) as Array<{ runId: string; parentRunId?: string }>;
      const root = list.find((t) => t.parentRunId === undefined)!;
      const trace = (await (
        await fetch(`/api/traces/${root.runId}`, { credentials: "same-origin" })
      ).json()) as { steps: Array<{ id: string }> };
      return {
        runId: root.runId,
        stepIds: trace.steps.map((s) => s.id),
      };
    });
    const futuredIndex = rootStepIds.stepIds.indexOf(futuredStepId);
    expect(futuredIndex).toBeGreaterThanOrEqual(0);

    // ---- 2. Only the futured fork point is offered. ----
    // Select the futured step: the edit region offers an enabled "Run forward
    // from here" and no "no prerecorded future" note.
    const editRegion = regionByData(page, "edit");
    await options.nth(futuredIndex).click();
    await expect(editRegion).toBeVisible();
    const runButtonOffered = page.getByRole("button", {
      name: /run forward from here/i,
    });
    await expect(runButtonOffered).toBeEnabled();
    await expect(page.getByRole("note")).toHaveCount(0);

    // Select a different editable step that has no future: the action is
    // disabled and a plain note (role="note") says why it is not offered. The
    // committed root run is model_call, tool_call, tool_result, model_call, so
    // its last step is a model_call that is not the futured one, and its edit
    // screen shows the run action disabled with the note.
    const notFuturedIndex = rootStepIds.stepIds.length - 1;
    expect(notFuturedIndex).not.toBe(futuredIndex);
    await options.nth(notFuturedIndex).click();
    await expect(editRegion).toBeVisible();
    const note = page.getByRole("note");
    await expect(note).toBeVisible();
    await expect(note).toHaveText(/no prerecorded future/i);
    const runButtonNotOffered = page.getByRole("button", {
      name: /run forward from here/i,
    });
    await expect(runButtonNotOffered).toBeDisabled();

    // ---- 3. Running forward from the offered fork point returns that fork
    // point's prerecorded future, not another one. ----
    await options.nth(futuredIndex).click();
    await expect(runButtonOffered).toBeEnabled();
    await runButtonOffered.click();

    // The running log shows the future's steps replayed in order.
    const liveLog = page.getByRole("log", { name: /live steps/i });
    await expect(liveLog).toBeVisible();
    const liveEntries = liveLog
      .getByRole("listitem")
      .or(liveLog.locator("[data-live-step]"));
    await expect(liveEntries.first()).toBeVisible();

    // The loaded branch is the committed future, and its fork point is the step
    // we forked from: the returned future belongs to the chosen fork point.
    const loaded = await page.evaluate(async (forkedFrom) => {
      const list = (await (
        await fetch("/api/traces", { credentials: "same-origin" })
      ).json()) as Array<{
        runId: string;
        parentRunId?: string;
        forkPointStepId?: string;
      }>;
      const future = list.find((t) => t.forkPointStepId === forkedFrom);
      return future ?? null;
    }, futuredStepId);
    expect(loaded).not.toBeNull();
    expect(loaded!.forkPointStepId).toBe(futuredStepId);

    // The compare with the parent shows the future as the new branch, so the
    // future reached the UI from the chosen fork point.
    const compareButton = page.getByRole("button", {
      name: /compare with parent/i,
    });
    await expect(compareButton).toBeVisible({ timeout: 30_000 });
    await compareButton.click();
    const compareRegion = regionByData(page, "compare");
    await expect(compareRegion).toBeVisible();
    // The future's final model output is "Final answer: hello"; it appears in
    // the compare region as the new branch's final output.
    await expect(compareRegion.getByText(/final answer/i).first()).toBeVisible();
  });
});
