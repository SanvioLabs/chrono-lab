// src/replay/errors.ts
// Error types for the replay module.

// Thrown when replay detects a mismatch between a live input and the recording.
export class ReplayError extends Error {
  readonly stepId: string;

  constructor(stepId: string, detail: string) {
    super(`ReplayError at step "${stepId}": ${detail}`);
    this.name = "ReplayError";
    this.stepId = stepId;
  }
}

// Thrown when any network access is attempted during replay.
export class NetworkAccessDuringReplayError extends Error {
  readonly surface: string;

  constructor(surface: string) {
    super(
      `NetworkAccessDuringReplayError: attempted network access via "${surface}" during replay. Replay must make zero network calls.`
    );
    this.name = "NetworkAccessDuringReplayError";
    this.surface = surface;
  }
}

// Thrown when a trace file carries an unrecognised version.
// Re-exported here so callers can import all errors from one place.
export { TraceVersionError } from "../trace/version.js";
