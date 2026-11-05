// src/server/caps.ts
// Spend cap types and logic.

export interface ModelPrice {
  inputUsdPerToken: number;
  outputUsdPerToken: number;
}

// Price table keyed by model identifier. Values are conservative upper bounds
// (rounded up to the nearest whole cent per million tokens).
// The stand-in / fork-model identifiers are included with zero cost so tests
// never trip a cap on their own.
export const MODEL_PRICES: Record<string, ModelPrice> = {
  // OpenAI
  "gpt-4o": { inputUsdPerToken: 0.000005, outputUsdPerToken: 0.000015 },
  "gpt-4o-mini": { inputUsdPerToken: 0.00000015, outputUsdPerToken: 0.0000006 },
  "gpt-4-turbo": { inputUsdPerToken: 0.00001, outputUsdPerToken: 0.00003 },
  "gpt-3.5-turbo": { inputUsdPerToken: 0.0000005, outputUsdPerToken: 0.0000015 },
  // Anthropic
  "claude-3-5-sonnet-20241022": { inputUsdPerToken: 0.000003, outputUsdPerToken: 0.000015 },
  "claude-3-haiku-20240307": { inputUsdPerToken: 0.00000025, outputUsdPerToken: 0.00000125 },
  // Stand-in / test models
  "stub": { inputUsdPerToken: 0, outputUsdPerToken: 0 },
  "fork-model": { inputUsdPerToken: 0, outputUsdPerToken: 0 },
};

// Conservative default price: use this when the model is not in the table.
const DEFAULT_PRICE: ModelPrice = {
  inputUsdPerToken: 0.00003,
  outputUsdPerToken: 0.00006,
};

// Returns an upper-bound cost estimate for a call given the model and
// maxTokens. Uses the model's output price for all maxTokens because that is
// the worst case (output tokens are always at least as expensive as input).
export function estimateCallCostUsd(model: string, maxTokens: number): number {
  const price = MODEL_PRICES[model] ?? DEFAULT_PRICE;
  return price.outputUsdPerToken * maxTokens;
}

// Computes the actual cost of a completed call from the token counts reported
// by the model. Use this after a call returns to charge the ledger; use
// estimateCallCostUsd only for the pre-call cap check.
export function computeActualCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const price = MODEL_PRICES[model] ?? DEFAULT_PRICE;
  return (
    price.inputUsdPerToken * inputTokens +
    price.outputUsdPerToken * outputTokens
  );
}

export interface CapState {
  // Accumulated spend for this session so far.
  sessionSpendUsd: number;
  // Accumulated spend across all sessions.
  overallSpendUsd: number;
}

export interface CapConfig {
  sessionLimitUsd: number;
  overallLimitUsd: number;
}

// Thrown by checkCaps when either cap would be exceeded.
export class CapExceededError extends Error {
  readonly reason: "session" | "overall";
  readonly limitUsd: number;
  readonly currentUsd: number;

  constructor(
    reason: "session" | "overall",
    limitUsd: number,
    currentUsd: number
  ) {
    super(
      `CapExceededError: ${reason} cap of $${limitUsd} exceeded (current: $${currentUsd})`
    );
    this.name = "CapExceededError";
    this.reason = reason;
    this.limitUsd = limitUsd;
    this.currentUsd = currentUsd;
  }
}

// Throws CapExceededError if either cap would be exceeded by the estimated
// cost. Session cap is checked before overall cap.
// Returns void when the call may proceed.
export function checkCaps(
  config: CapConfig,
  state: CapState,
  estimatedCostUsd: number
): void {
  if (state.sessionSpendUsd + estimatedCostUsd > config.sessionLimitUsd) {
    throw new CapExceededError(
      "session",
      config.sessionLimitUsd,
      state.sessionSpendUsd
    );
  }
  if (state.overallSpendUsd + estimatedCostUsd > config.overallLimitUsd) {
    throw new CapExceededError(
      "overall",
      config.overallLimitUsd,
      state.overallSpendUsd
    );
  }
}

// Adds actualCostUsd to both spend totals and returns the updated state.
// Does not mutate the input.
export function recordSpend(state: CapState, actualCostUsd: number): CapState {
  return {
    sessionSpendUsd: state.sessionSpendUsd + actualCostUsd,
    overallSpendUsd: state.overallSpendUsd + actualCostUsd,
  };
}

// A shared mutable ledger that tracks spend across multiple forks in a
// session. Passed through ForkOptions so all forks in a session share one
// accumulator rather than each starting from zero.
export interface SpendLedger {
  // Returns the current accumulated spend.
  get(): CapState;
  // Adds costUsd to both session and overall totals.
  add(costUsd: number): void;
}

// Creates a new SpendLedger with an optional initial state.
export function createSpendLedger(initial?: CapState): SpendLedger {
  let state: CapState = initial ?? { sessionSpendUsd: 0, overallSpendUsd: 0 };
  return {
    get: () => ({ ...state }),
    add: (costUsd: number) => {
      state = {
        sessionSpendUsd: state.sessionSpendUsd + costUsd,
        overallSpendUsd: state.overallSpendUsd + costUsd,
      };
    },
  };
}
