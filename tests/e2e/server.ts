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

// A throwaway trace root for the run; removed on exit.
const traceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chrono-e2e-"));

const config = defaultConfig({
  port,
  modelMode,
  traceRoot,
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
