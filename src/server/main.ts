// src/server/main.ts
// The real server entry (Task 14).
//
// src/server/server.ts exports createServer but never listens, so `npm run
// serve` needs a small top-level entry that reads the environment, starts a
// server, serves the built UI from dist/ui, writes traces under a trace root,
// and keeps the process alive until a signal stops it. This is that entry.
//
// It makes no live model call: MODEL_MODE is "fake" (the deterministic fake
// model) or "demo" (the committed demo/ fixtures), so the whole loop runs with
// no network and no API key. The key is never read here.
//
// Env parsing is a pure function (parseEnv) so the unit test can check the
// defaults, the demo mode, an invalid mode and an invalid port without starting
// a server or touching the file system.

import * as fs from "node:fs";
import * as path from "node:path";
import { createServer } from "./server.js";
import { defaultConfig } from "./config.js";
import type { ModelMode, ServerConfig } from "./config.js";

// The default port when PORT is unset. The vite dev proxy points here too, so
// changing this means changing vite.config.ts's proxy target.
export const DEFAULT_PORT = 3000;

// The result of parsing the environment: either the config overrides to hand to
// defaultConfig, or a plain error message to print before exiting non-zero. No
// throw: the caller decides what to do with an error.
export type ParseEnvResult =
  | { ok: true; overrides: Partial<ServerConfig> }
  | { ok: false; error: string };

// The environment this entry reads. A plain object so the unit test can pass a
// fixture instead of process.env. The index signature matches NodeJS.ProcessEnv,
// which has only an index signature, so parseEnv(process.env) type-checks with
// no cast at the call site; PORT and MODEL_MODE are named for the reader. Every
// value is `string | undefined`: an unset key reads back as undefined.
export interface EnvInput {
  PORT?: string;
  MODEL_MODE?: string;
  [key: string]: string | undefined;
}

// Parses PORT and MODEL_MODE into config overrides, or returns a plain error.
//
//   PORT        defaults to DEFAULT_PORT (3000). Must be an integer in
//               1..65535. 0 is rejected here: this entry serves real users, so
//               it binds a known port rather than an OS-chosen ephemeral one.
//   MODEL_MODE  defaults to "fake". "demo" is allowed. Anything else is an
//               error, so a typo exits with a message rather than silently
//               falling back.
//
// The trace root, demo dir and static root are left to defaultConfig, which
// resolves them from the current working directory (the repo root), so a bare
// `npm run serve` from the root writes traces to .traces, serves demo/ and
// serves dist/ui.
export function parseEnv(env: EnvInput): ParseEnvResult {
  const rawMode = env.MODEL_MODE ?? "fake";
  if (rawMode !== "fake" && rawMode !== "demo") {
    return {
      ok: false,
      error: `MODEL_MODE must be "fake" or "demo", got "${rawMode}".`,
    };
  }
  const modelMode: ModelMode = rawMode;

  const rawPort = env.PORT;
  let port = DEFAULT_PORT;
  if (rawPort !== undefined && rawPort !== "") {
    // Number() so "3000.5", "12x" and "" are caught; a trailing-garbage value
    // like "80abc" becomes NaN and is rejected rather than silently truncated.
    const parsed = Number(rawPort);
    if (
      !Number.isInteger(parsed) ||
      parsed < 1 ||
      parsed > 65535
    ) {
      return {
        ok: false,
        error: `PORT must be an integer between 1 and 65535, got "${rawPort}".`,
      };
    }
    port = parsed;
  }

  return { ok: true, overrides: { port, modelMode } };
}

// Starts the server from the parsed overrides, binds 127.0.0.1 only (createServer
// already binds that host), prints the address, and wires a clean shutdown on
// SIGINT/SIGTERM. Returns once listening; the registered signal handlers keep
// the process alive.
async function run(config: ServerConfig): Promise<void> {
  // Refuse to serve a blank page: if the built UI is missing, say what to run.
  const indexHtml = path.join(config.staticRoot, "index.html");
  if (!fs.existsSync(indexHtml)) {
    console.error(
      `The built UI is missing at ${config.staticRoot}.\n` +
        `Run \`npm run build:ui\` first, then \`npm run serve\`.`
    );
    process.exit(1);
  }

  const server = createServer(config);
  await server.start();
  const addr = server.address();
  console.log(`Chrono-Lab running at http://127.0.0.1:${addr.port}`);

  let stopping = false;
  const shutdown = (): void => {
    if (stopping) return;
    stopping = true;
    server
      .stop()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Entry: parse the environment, build the config, start. On a bad environment,
// print the plain message and exit non-zero without starting anything.
async function main(): Promise<void> {
  const parsed = parseEnv(process.env);
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exit(1);
  }
  const config = defaultConfig(parsed.overrides);
  await run(config);
}

// Run only when executed as the entry, not when imported by the unit test.
// import.meta.url resolves to this file; process.argv[1] is the started script.
// tsx runs the .ts path, so compare the resolved file paths.
const invokedPath = process.argv[1]
  ? path.resolve(process.argv[1])
  : "";
const thisPath = path.resolve(new URL(import.meta.url).pathname);
if (invokedPath === thisPath) {
  main().catch((err) => {
    console.error("Chrono-Lab failed to start:", err);
    process.exit(1);
  });
}
