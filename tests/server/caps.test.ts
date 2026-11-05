// tests/server/caps.test.ts
// Unit tests for the spend cap module.

import { describe, it, expect } from "vitest";
import {
  checkCaps,
  recordSpend,
  CapExceededError,
  estimateCallCostUsd,
  computeActualCostUsd,
  createSpendLedger,
  MODEL_PRICES,
} from "../../src/server/caps.js";
import type { CapConfig, CapState } from "../../src/server/caps.js";

const DEFAULT_CONFIG: CapConfig = {
  sessionLimitUsd: 1.0,
  overallLimitUsd: 10.0,
};

const ZERO_STATE: CapState = {
  sessionSpendUsd: 0,
  overallSpendUsd: 0,
};

describe("checkCaps", () => {
  it("allows a call whose estimated cost fits within both caps", () => {
    expect(() =>
      checkCaps(DEFAULT_CONFIG, ZERO_STATE, 0.5)
    ).not.toThrow();
  });

  it("throws CapExceededError with reason 'session' when session cap is exceeded", () => {
    const state: CapState = { sessionSpendUsd: 0.9, overallSpendUsd: 0.9 };
    // 0.9 + 0.2 = 1.1 > 1.0 session limit
    let caught: unknown;
    try {
      checkCaps(DEFAULT_CONFIG, state, 0.2);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CapExceededError);
    const err = caught as CapExceededError;
    expect(err.reason).toBe("session");
    expect(err.limitUsd).toBe(1.0);
    expect(err.currentUsd).toBe(0.9);
    expect(err.message).toContain("session");
  });

  it("throws CapExceededError with reason 'overall' when overall cap is exceeded but session is fine", () => {
    const config: CapConfig = { sessionLimitUsd: 100, overallLimitUsd: 1.0 };
    const state: CapState = { sessionSpendUsd: 0.1, overallSpendUsd: 0.9 };
    let caught: unknown;
    try {
      checkCaps(config, state, 0.2);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(CapExceededError);
    expect((caught as CapExceededError).reason).toBe("overall");
  });

  it("checks session cap before overall cap when both would be exceeded", () => {
    const config: CapConfig = { sessionLimitUsd: 0.5, overallLimitUsd: 0.5 };
    const state: CapState = { sessionSpendUsd: 0.4, overallSpendUsd: 0.4 };
    let caught: unknown;
    try {
      checkCaps(config, state, 0.2);
    } catch (err) {
      caught = err;
    }
    expect((caught as CapExceededError).reason).toBe("session");
  });

  it("spend is never incremented when checkCaps throws", () => {
    const state: CapState = { sessionSpendUsd: 0.9, overallSpendUsd: 0.9 };
    try {
      checkCaps(DEFAULT_CONFIG, state, 0.2);
    } catch {
      // The check threw before any spend was recorded.
    }
    // The state object passed in is not mutated (checkCaps does not mutate).
    expect(state.sessionSpendUsd).toBe(0.9);
    expect(state.overallSpendUsd).toBe(0.9);
  });
});

describe("recordSpend", () => {
  it("returns a new state with both totals incremented", () => {
    const state: CapState = { sessionSpendUsd: 0.5, overallSpendUsd: 2.0 };
    const next = recordSpend(state, 0.3);
    expect(next.sessionSpendUsd).toBeCloseTo(0.8);
    expect(next.overallSpendUsd).toBeCloseTo(2.3);
  });

  it("does not mutate the input state", () => {
    const state: CapState = { sessionSpendUsd: 0.5, overallSpendUsd: 2.0 };
    recordSpend(state, 0.3);
    expect(state.sessionSpendUsd).toBe(0.5);
    expect(state.overallSpendUsd).toBe(2.0);
  });
});

describe("estimateCallCostUsd", () => {
  it("returns 0 for stub model", () => {
    expect(estimateCallCostUsd("stub", 1000)).toBe(0);
  });

  it("uses output price times maxTokens for a known model", () => {
    const price = MODEL_PRICES["gpt-4o"];
    expect(price).toBeDefined();
    const expected = price!.outputUsdPerToken * 500;
    expect(estimateCallCostUsd("gpt-4o", 500)).toBeCloseTo(expected);
  });

  it("uses the default conservative price for an unknown model", () => {
    // Default output price is 0.00006 per token.
    const result = estimateCallCostUsd("unknown-model-xyz", 100);
    expect(result).toBeGreaterThan(0);
  });
});

describe("computeActualCostUsd", () => {
  it("returns 0 for stub model regardless of token counts", () => {
    expect(computeActualCostUsd("stub", 1000, 1000)).toBe(0);
  });

  it("is less than the estimate for a real model when tokens are low", () => {
    // estimate uses worst-case maxTokens; actual uses real counts.
    const maxTokens = 1000;
    const estimated = estimateCallCostUsd("gpt-4o", maxTokens);
    const actual = computeActualCostUsd("gpt-4o", 1, 1);
    expect(actual).toBeLessThan(estimated);
  });

  it("adds input and output costs separately", () => {
    const price = MODEL_PRICES["gpt-4o"]!;
    const result = computeActualCostUsd("gpt-4o", 10, 20);
    const expected = 10 * price.inputUsdPerToken + 20 * price.outputUsdPerToken;
    expect(result).toBeCloseTo(expected, 12);
  });
});

describe("createSpendLedger", () => {
  it("starts at zero by default", () => {
    const l = createSpendLedger();
    expect(l.get().sessionSpendUsd).toBe(0);
    expect(l.get().overallSpendUsd).toBe(0);
  });

  it("add increments both totals", () => {
    const l = createSpendLedger();
    l.add(0.5);
    expect(l.get().sessionSpendUsd).toBeCloseTo(0.5);
    expect(l.get().overallSpendUsd).toBeCloseTo(0.5);
  });

  it("get returns a snapshot; mutating it does not affect the ledger", () => {
    const l = createSpendLedger();
    l.add(0.1);
    const snap = l.get();
    // Mutate the snapshot.
    (snap as { sessionSpendUsd: number }).sessionSpendUsd = 999;
    // Ledger is unchanged.
    expect(l.get().sessionSpendUsd).toBeCloseTo(0.1);
  });

  it("accepts an initial state", () => {
    const l = createSpendLedger({ sessionSpendUsd: 1.0, overallSpendUsd: 5.0 });
    expect(l.get().sessionSpendUsd).toBe(1.0);
    expect(l.get().overallSpendUsd).toBe(5.0);
  });
});
