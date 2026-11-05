// tests/e2e/server.ts
// Boots the Chrono-Lab server for the Playwright end-to-end tests (Task 12).
//
// Why this exists: src/server/server.ts exports createServer but has no
// top-level listen, so the e2e run needs a small entry that starts a server and
// keeps the process alive until Playwright tears it down. This entry reads its
// whole configuration from the environment, so one file serves all three e2e
// server instances the Playwright config starts:
//
//   - the full-loop server: MODEL_MODE "fake", production caps and pricing. The
//     fake model is free in MODEL_PRICES, so no cap ever trips.
//   - the cap server: MODEL_MODE "fake" plus a real price for the fake model
//     (E2E_PRICE_FAKE_PER_TOKEN, applied to both input and output tokens for
//     this server only) and a tuned session cap (E2E_SESSION_CAP_USD), so a
//     fork trips a real spend cap through forkTrace's cap path. The price is an
//     override passed to this server only; MODEL_PRICES and the production
//     defaults are unchanged, so removing the cap check makes the capped run
//     complete and the cap test fail.
//   - the demo server: MODEL_MODE "demo" and the committed demo/ fixtures, so
//     the UI shows the banner and the prerecorded runs and futures from first
//     load.
//
// It reads PORT, MODEL_MODE, FAKE_STEP_DELAY_MS, and the optional cap-server
// knobs, serves the built UI from dist/ui (built once by the Playwright global
// setup), writes traces under a temp dir that is swept on exit, prints
// "listening on <port>" so Playwright's webServer can wait on the port, and
// stops cleanly on SIGINT/SIGTERM. It makes no live model call: modelMode
// "fake"/"demo" uses the deterministic fake model or the prerecorded fixtures,
// so the whole loop runs with no network and no API key.

import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { createServer } from "../../src/server/server.js";
import { defaultConfig } from "../../src/server/config.js";
import type { ModelMode } from "../../src/server/config.js";
import type { ModelPrice, PriceOverrides } from "../../src/server/caps.js";

const port = Number(process.env.PORT ?? "0");
const modelMode = (process.env.MODEL_MODE ?? "fake") as ModelMode;

// The fake-model per-step delay, in milliseconds. Default 1500: long enough
// that Playwright's backing-off expect poll catches the Stop button between
// live entries, short enough that the two-step record and the two-step fork
// each finish (about 3 s) well under the test's 30 s compare wait. Set
// FAKE_STEP_DELAY_MS to override.
const fakeStepDelayMs = Number(process.env.FAKE_STEP_DELAY_MS ?? "1500");

// Optional cap-server knob. When E2E_PRICE_FAKE_PER_TOKEN is set, the fake
// model is priced at that many dollars per token (both input and output) for
// this server only, as an override; MODEL_PRICES and the production defaults
// stay untouched. The fork's pre-call cap check uses an output-price-times-
// maxTokens estimate, so with a tuned E2E_SESSION_CAP_USD the first live call
// passes and the second trips a real cap (forkTrace returns a real cap hit).
// When the price is unset the server uses production pricing and the fake model
// stays free.
const priceFakePerToken = process.env.E2E_PRICE_FAKE_PER_TOKEN;
const priceOverrides: PriceOverrides =
  priceFakePerToken !== undefined
    ? ({
        fake: {
          inputUsdPerToken: Number(priceFakePerToken),
          outputUsdPerToken: Number(priceFakePerToken),
        } satisfies ModelPrice,
      } as Record<string, ModelPrice>)
    : undefined;

// Caps: the production defaults unless the cap-server knobs override them.
const caps =
  process.env.E2E_SESSION_CAP_USD !== undefined ||
  process.env.E2E_OVERALL_CAP_USD !== undefined
    ? {
        sessionLimitUsd: Number(process.env.E2E_SESSION_CAP_USD ?? "1"),
        overallLimitUsd: Number(process.env.E2E_OVERALL_CAP_USD ?? "10"),
      }
    : undefined;

// A throwaway trace root for the run; removed on exit.
const traceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chrono-e2e-"));

const config = defaultConfig({
  port,
  modelMode,
  traceRoot,
  fakeStepDelayMs,
  ...(priceOverrides ? { priceOverrides } : {}),
  ...(caps ? { caps } : {}),
  // Serve the production UI bundle. The Playwright global setup builds it once.
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
