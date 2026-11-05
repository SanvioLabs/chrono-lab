// tests/e2e/playwright.config.ts
// Playwright config for the end-to-end browser tests (Task 12, R-22; Task 14,
// R-14/R-17).
//
// Three server instances run at once, one per behaviour the suite covers:
//   - the full-loop server (MODEL_MODE "fake"): lab.spec.ts drives record,
//     rewind, edit, run forward and compare, and checks no reflow and the
//     keyboard/a11y contract. The fake model is free, so no cap ever trips.
//   - the cap server (MODEL_MODE "fake" + a priced fake model and a tuned
//     session cap): cap.spec.ts forks until a real spend cap is hit through
//     forkTrace's cap path, and checks the running region names the cap, the
//     partial branch is kept, the demo banner appears, and no region reflows.
//   - the demo server (MODEL_MODE "demo" + the committed demo/ fixtures):
//     demo.spec.ts checks the banner shows from first load, only fork points
//     with a prerecorded future are offered, and running forward returns that
//     fork point's future.
//
// Playwright accepts an array for webServer, so all three start together. The
// UI bundle is built once in globalSetup before any server starts, so the three
// servers never race three concurrent `vite build` runs into one dist/ui; each
// server only starts the HTTP server and reads dist/ui per request.
//
// Each server gets its own free port, picked once in the main process from an
// ephemeral OS port and written back to the environment (E2E_PORT, E2E_CAP_PORT,
// E2E_DEMO_PORT). Playwright re-loads this config inside each worker process;
// the ports are already in the environment by then, so workers reuse them and
// never pick their own. Each spec file sets its own baseURL from its port
// (test.use), so no test can hit the wrong server. The browser is installed
// once by `npm run e2e:install` (PLAYWRIGHT_BROWSERS_PATH=0), and test:e2e sets
// the same path so the run finds that local browser.

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
// OS assigned, then closing it.
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

// Pick each port once. If the env var is already set (an explicit override, or
// the value the main process wrote for its workers), reuse it and never call
// freePort for it again. Otherwise pick a free port and write it back so the
// worker processes that re-load this config inherit it.
async function portFor(envVar: string): Promise<number> {
  const existing = process.env[envVar];
  if (existing !== undefined) return Number(existing);
  const p = await freePort();
  process.env[envVar] = String(p);
  return p;
}

const PORT = await portFor("E2E_PORT");
const CAP_PORT = await portFor("E2E_CAP_PORT");
const DEMO_PORT = await portFor("E2E_DEMO_PORT");

const BASE_URL = `http://127.0.0.1:${PORT}`;
const CAP_BASE_URL = `http://127.0.0.1:${CAP_PORT}`;
const DEMO_BASE_URL = `http://127.0.0.1:${DEMO_PORT}`;

// The cap server prices the fake model (P per token, input and output) and sets
// a session cap tuned so a fork's first live model call passes the cap but its
// second one trips it. forkTrace checks the cap before each live call using an
// upper-bound estimate (outputPrice * maxTokens, maxTokens defaulting to 1024),
// and charges the actual tokens after each call:
//   - first call:  ledger 0,       estimate P*1024.  Passes when P*1024 <= C.
//   - the fork charges the first call's actual tokens (12 in + 4 out = 16),
//     so the ledger holds P*16.
//   - second call: ledger P*16,     estimate P*1024.  Trips when P*1040 > C.
// With P = 0.001 the window is 1.024 <= C < 1.040; C = 1.03 sits well inside it
// (0.006 of margin on each side). So the fork emits the edited model call, the
// echo tool_call and tool_result as live steps, then the second model call
// trips a real session cap: the Stop button is on screen while those live steps
// stream, and the partial branch is kept. Production pricing and the default
// caps are untouched, so removing the cap check lets the fork run to the end
// and the cap test fails.
const CAP_PRICE_FAKE_PER_TOKEN = "0.001";
const CAP_SESSION_USD = "1.03";

export default defineConfig({
  testDir: ".",
  // Only *.spec.ts here, so the Vitest *.test.ts files are never run by
  // Playwright.
  testMatch: /.*\.spec\.ts$/,
  // Build the UI bundle once before any server starts (see global-setup.ts).
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    // Each spec sets its own baseURL (test.use) from the port its server runs
    // on, so no test hits the wrong server. This default is the full-loop URL.
    baseURL: BASE_URL,
    actionTimeout: 10_000,
  },

  // Start all three servers. The UI is already built by globalSetup, so each
  // command only starts the HTTP server. Playwright waits for each port, then
  // tears them down when the run ends. cwd is the repo root so the command's
  // repo-relative path resolves correctly.
  webServer: [
    {
      command: "npx tsx tests/e2e/server.ts",
      cwd: REPO_ROOT,
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: String(PORT),
        MODEL_MODE: "fake",
        // Pace the fake model so a fork does not finish in the tick it starts:
        // the Stop button stays on screen long enough for the test to see it
        // and measure its box while live steps arrive (R-08, R-11).
        FAKE_STEP_DELAY_MS: "1500",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "npx tsx tests/e2e/server.ts",
      cwd: REPO_ROOT,
      url: CAP_BASE_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: String(CAP_PORT),
        MODEL_MODE: "fake",
        // The same pacing as the full-loop server, so the Stop button is on
        // screen long enough to measure while the first live steps stream,
        // before the second model call trips the cap.
        FAKE_STEP_DELAY_MS: "1500",
        // Price the fake model and set the tuned session cap for this server
        // only (overrides, so MODEL_PRICES and the default caps are untouched).
        E2E_PRICE_FAKE_PER_TOKEN: CAP_PRICE_FAKE_PER_TOKEN,
        E2E_SESSION_CAP_USD: CAP_SESSION_USD,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "npx tsx tests/e2e/server.ts",
      cwd: REPO_ROOT,
      url: DEMO_BASE_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: String(DEMO_PORT),
        MODEL_MODE: "demo",
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  ],

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
