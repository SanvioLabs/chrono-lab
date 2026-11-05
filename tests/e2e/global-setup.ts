// tests/e2e/global-setup.ts
// Builds the UI bundle once before the e2e servers start (Task 12, Task 14).
//
// Three server instances run at once (full-loop, cap, demo), and all three
// serve the same dist/ui. Running `vite build` from each webServer command
// would race three concurrent builds into one output directory. Instead this
// global setup runs the build a single time before Playwright starts any
// server, so every server serves the same freshly built bundle. The server
// reads files from dist/ui per request (not at boot), so the single build
// finishing here is enough for all three.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export default async function globalSetup(): Promise<void> {
  const configDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(configDir, "..", "..");
  // Build the UI once, from the repo root, inheriting stdio so a failure is
  // visible in the Playwright output.
  execFileSync("npx", ["vite", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
}
