// src/trace/version.ts
// Version registry and migration for the trace format.

import { TRACE_VERSION } from "./types.js";
import type { Trace } from "./types.js";

// Single authority on which versions can be loaded.
// Adding a new version means adding it here and writing a migration.
export const KNOWN_VERSIONS: readonly string[] = [
  "1.0.0",
  "1.1.0",
] as const;

// Thrown when a trace file carries a version this code cannot handle.
export class TraceVersionError extends Error {
  readonly version: string;

  constructor(version: string) {
    super(
      `TraceVersionError: unknown trace version "${version}"; cannot load this file.`
    );
    this.name = "TraceVersionError";
    this.version = version;
  }
}

// Local alias for the v1.0.0 step shape: no live or edited fields.
// Used only inside the migration arm below.
type BaseStep_1_0_0 = {
  id: string;
  runId: string;
  parentId: string | null;
  durationMs: number;
  branch: string;
  forkPointId: string | null;
};

type Step_1_0_0 = BaseStep_1_0_0 & Record<string, unknown>;

type Trace_1_0_0 = {
  version: string;
  runId: string;
  createdAt: string;
  steps: Step_1_0_0[];
};

// Migrate a raw parsed object from an older known version to the current schema.
export function migrateTrace(raw: unknown, fromVersion: string): Trace {
  switch (fromVersion) {
    case "1.0.0": {
      const migrated = raw as Trace_1_0_0;
      // Add live and edited to every step. Do not write parentRunId or
      // forkPointStepId: omitting them keeps the in-memory and serialised
      // forms strictly equal on root runs.
      return {
        version: TRACE_VERSION,
        runId: migrated.runId,
        createdAt: migrated.createdAt,
        steps: migrated.steps.map((s) => ({
          ...s,
          live: false,
          edited: false,
        })),
      } as Trace;
    }
    case "1.1.0":
      // Current version: no migration needed.
      return raw as Trace;
    default:
      throw new TraceVersionError(fromVersion);
  }
}
