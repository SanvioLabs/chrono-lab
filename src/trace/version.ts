// src/trace/version.ts
// Version registry and migration stubs for the trace format.

import { TRACE_VERSION } from "./types.js";
import type { Trace } from "./types.js";

// Single authority on which versions can be loaded.
// Adding a new version means adding it here and writing a migration.
export const KNOWN_VERSIONS: readonly string[] = [TRACE_VERSION] as const;

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

// Migrate a raw parsed object from an older known version to the current schema.
// For v1.0.0 there are no migrations; this is a stub for future use.
export function migrateTrace(raw: unknown, fromVersion: string): Trace {
  if (fromVersion === "1.0.0") {
    // No migration needed for the initial version.
    return raw as Trace;
  }
  throw new TraceVersionError(fromVersion);
}
