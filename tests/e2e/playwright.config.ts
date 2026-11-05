// tests/e2e/playwright.config.ts
// Playwright config for the one end-to-end browser test (Task 12, R-22).
//
// What it sets up:
//   - testDir is this folder, testMatch is *.spec.ts only, so Playwright runs
//     lab.spec.ts and never picks up the Vitest *.test.ts files (and Vitest
//     excludes tests/e2e in vitest.config.ts, so the two never overlap).
//   - webServer starts the server itself on a free port with modelMode "fake",
//     builds the UI first, waits for the port, and is torn down after the run
//     (reuseExistingServer is false, so each run starts and stops its own).
//   - one browser project, "chromium", named here but not downloaded by the
//     config. The browser is installed once, outside the build, by
//     `npm run e2e:install` (PLAYWRIGHT_BROWSERS_PATH=0 playwright install
//     chromium), which keeps the binary inside this project rather than the
//     shared machine cache another project depends on. The test:e2e script
//     sets PLAYWRIGHT_BROWSERS_PATH=0 too, so the run finds that local browser.
//
// The port is chosen at config-load time from an ephemeral OS port, then passed
// to both the server (PORT) and the test (baseURL), so nothing is hard-coded
// and two runs never collide.

import { defineConfig, devices } from "@playwright/test";
import { createServer } from "node:net";

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

const PORT = Number(process.env.E2E_PORT ?? (await freePort()));
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
  // server down when the run ends.
  webServer: {
    command: "npm run build:ui && npx tsx tests/e2e/server.ts",
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PORT: String(PORT),
      MODEL_MODE: "fake",
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
