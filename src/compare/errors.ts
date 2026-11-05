// src/compare/errors.ts
// Error types for the fork and compare operations.

// Thrown when the fork-point step id is not found in the parent trace,
// or when the edit is incompatible with the step kind.
export class ForkError extends Error {
  readonly forkPointStepId: string;

  constructor(forkPointStepId: string, message: string) {
    super(message);
    this.name = "ForkError";
    this.forkPointStepId = forkPointStepId;
  }
}
