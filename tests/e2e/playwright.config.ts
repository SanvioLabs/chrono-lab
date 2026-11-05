// tests/e2e/playwright.config.ts
// Playwright config for the one end-to-end browser test (Task 12, R-22).
//
// What it sets up:
//   - testDir is this folder, testMatch is *.spec.ts only, so Playwright runs
//     lab.spec.ts and never picks up the Vitest *.test.ts files (and Vitest
//     excludes tests/e2e in vitest.config.ts, so the two never overlap).
//   - webServer starts the server itself on a free port with modelMode "fake",
//     builds the UI first, waits for the port, and is torn down after the run
//     (reuseExistingServer is false, so each run starts and stops its own). Its
//     working directory is the repo root (webServer.cwd), resolved from this
//     file's location, so the command's repo-relative paths (build:ui,
//     tests/e2e/server.ts) resolve against the repo root rather than this
//     config folder.
//   - one browser project, "chromium", named here but not downloaded by the
//     config. The browser is installed once, outside the build, by
//     `npm run e2e:install` (PLAYWRIGHT_BROWSERS_PATH=0 playwright install
//     chromium), which keeps the binary inside this project rather than the
//     shared machine cache another project depends on. The test:e2e script
//     sets PLAYWRIGHT_BROWSERS_PATH=0 too, so the run finds that local browser.
//
// The port is chosen once, in the main process, from an ephemeral OS port when
// E2E_PORT is unset. Playwright re-loads this config inside each worker
// process, so we write the chosen port back to process.env.E2E_PORT before
// defineConfig. Workers inherit the environment, read E2E_PORT, and reuse the
// same port instead of each picking its own, which kept baseURL and the server
// from ever agreeing. The port is passed to both the server (PORT) and the test
// (baseURL), so nothing is hard-coded and two runs never collide.

import { defineConfig, devices } from "@playwright/test";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Repo root, resolved from this file's location (tests/e2e), not process.cwd().
// Playwright runs webServer.command with the config folder as its working
// directory by default, which breaks the repo-relative paths in the command, so
// we pin webServer.cwd to the repo root below.
const CONFIG_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(CONFIG_DIR, "..", "..");

// Grab a free TCP port by opening a server on port 0 and reading the port the
// OS assigned, then closing it. Synchronous enough for config load: we block on
// a short promise via deasync-free polling is not available, so we resolve it
// before defineConfig using a tiny bound-and-close helper.
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("could not read a free port")));
      }
    });
  });
}

// Pick the port once. If E2E_PORT is already set (an explicit override, or the
// value the main process wrote for its workers), reuse it and never call
// freePort again. Otherwise pick a free port and write it back to the
// environment so the worker processes that re-load this config inherit it.
const PORT = Number(process.env.E2E_PORT ?? (await freePort()));
process.env.E2E_PORT = String(PORT);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: ".",
  // Only *.spec.ts here, so the Vitest *.test.ts files are never run by
  // Playwright.
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    // No tracing/video by default; this is a fast deterministic run.
    actionTimeout: 10_000,
  },

  // Start the server ourselves on the free port with the deterministic fake
  // model, after building the UI. Playwright waits for the port, then tears the
  // server down when the run ends. cwd is the repo root so the command's
  // repo-relative paths resolve correctly.
  webServer: {
    command: "npm run build:ui && npx tsx tests/e2e/server.ts",
    cwd: REPO_ROOT,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      MODEL_MODE: "fake",
      // Pace the fake model so a fork does not finish in the tick it starts:
      // the Stop button stays on screen long enough for the test to see it and
      // measure its box while live steps arrive (R-08, R-11). At 1500 ms per
      // step, Playwright's backing-off expect poll still catches the Stop
      // button between live entries; 400 ms was too short. The whole loop still
      // finishes well inside the test's 30 s compare wait.
      FAKE_STEP_DELAY_MS: "1500",
    },
    stdout: "pipe",
    stderr: "pipe",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
