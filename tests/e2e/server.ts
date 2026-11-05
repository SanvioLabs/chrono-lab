// tests/e2e/server.ts
// Boots the Chrono-Lab server for the Playwright end-to-end test (Task 12).
//
// Why this exists: src/server/server.ts exports createServer but has no
// top-level listen, so the e2e run needs a small entry that starts a server and
// keeps the process alive until Playwright tears it down. This entry:
//   - reads PORT and MODEL_MODE from the environment (the Playwright config sets
//     both: a free port it picked, and "fake"),
//   - serves the built UI from dist/ui and writes traces under a temp dir that
//     is swept on exit,
//   - paces the fake model with a per-step delay (FAKE_STEP_DELAY_MS,
//     default 1500) so a fork does not finish in the same tick it starts: the
//     Stop button stays on screen long enough for the test to see it and
//     measure its box while live steps arrive (R-08, R-11). At 1500 ms per
//     step, Playwright's backing-off expect poll still catches the Stop button
//     between live entries; 400 ms was too short, since the fork's remaining
//     steps could all land inside one poll gap. The delay only moves when steps
//     land, never what they record, so the loop stays deterministic. Record
//     does two model calls (about 3 s) and the fork two (about 3 s), both well
//     inside the test's 60 s timeout and 30 s compare wait,
//   - starts listening and prints "listening on <port>" so Playwright's
//     webServer can wait on the port,
//   - stops cleanly on SIGINT/SIGTERM.
//
// It makes no live model call: modelMode "fake" uses the deterministic fake
// model, so the whole loop runs with no network and no API key.

import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { createServer } from "../../src/server/server.js";
import { defaultConfig } from "../../src/server/config.js";
import type { ModelMode } from "../../src/server/config.js";

const port = Number(process.env.PORT ?? "0");
const modelMode = (process.env.MODEL_MODE ?? "fake") as ModelMode;

// The fake-model per-step delay, in milliseconds. Default 1500: long enough
// that Playwright's backing-off expect poll catches the Stop button between
// live entries, short enough that the two-step record and the two-step fork
// each finish (about 3 s) well under the test's 30 s compare wait. Set
// FAKE_STEP_DELAY_MS to override.
const fakeStepDelayMs = Number(process.env.FAKE_STEP_DELAY_MS ?? "1500");

// A throwaway trace root for the run; removed on exit.
const traceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chrono-e2e-"));

const config = defaultConfig({
  port,
  modelMode,
  traceRoot,
  fakeStepDelayMs,
  // Serve the production UI bundle. The Playwright config runs build:ui first.
  staticRoot: path.join(process.cwd(), "dist", "ui"),
  demoDir: path.join(process.cwd(), "demo"),
});

const server = createServer(config);

async function main(): Promise<void> {
  await server.start();
  const addr = server.address();
  // Playwright waits on this line / the open port.
  console.log(`listening on ${addr.port}`);
}

async function shutdown(): Promise<void> {
  try {
    await server.stop();
  } finally {
    fs.rmSync(traceRoot, { recursive: true, force: true });
    process.exit(0);
  }
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

main().catch((err) => {
  console.error("e2e server failed to start:", err);
  fs.rmSync(traceRoot, { recursive: true, force: true });
  process.exit(1);
});
