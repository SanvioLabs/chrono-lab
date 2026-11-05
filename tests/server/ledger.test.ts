// tests/server/ledger.test.ts
// Task 5 (R-07): the two ledgers compose.
//
// composeLedger(session, global) reports sessionSpendUsd from the session
// ledger and overallSpendUsd from the global ledger, and add charges both. Two
// separate session ledgers that share one global ledger, each under the session
// cap, together push the global total past the overall cap, so the second
// session's check against the overall cap fails.
//
// Written before composeLedger is implemented. Until then it throws
// "not implemented" and every case fails.

import { describe, it, expect } from "vitest";
import { composeLedger } from "../../src/server/ledger.js";
import {
  createSpendLedger,
  checkCaps,
  CapExceededError,
} from "../../src/server/caps.js";
import type { CapConfig } from "../../src/server/caps.js";

describe("composeLedger (R-07)", () => {
  it("reports sessionSpendUsd from the session ledger and overallSpendUsd from the global ledger", () => {
    const session = createSpendLedger();
    const global = createSpendLedger();

    // Seed the two underlying ledgers with different totals so we can tell
    // which one each field comes from.
    session.add(0.2);
    global.add(1.5);

    const composed = composeLedger(session, global);
    const state = composed.get();

    expect(state.sessionSpendUsd).toBeCloseTo(0.2, 12);
    expect(state.overallSpendUsd).toBeCloseTo(1.5, 12);
  });

  it("add charges both the session ledger and the global ledger", () => {
    const session = createSpendLedger();
    const global = createSpendLedger();
    const composed = composeLedger(session, global);

    composed.add(0.3);

    expect(session.get().sessionSpendUsd).toBeCloseTo(0.3, 12);
    expect(global.get().overallSpendUsd).toBeCloseTo(0.3, 12);
  });

  it("two sessions sharing one global ledger hit the overall cap; the second session's overall check fails", () => {
    // Session cap is generous; overall cap is the binding one.
    const config: CapConfig = {
      sessionLimitUsd: 1.0,
      overallLimitUsd: 1.5,
    };

    const global = createSpendLedger();

    // Session A: one session ledger composed with the shared global ledger.
    const sessionA = createSpendLedger();
    const composedA = composeLedger(sessionA, global);

    // A spends 0.8: under the session cap (1.0) and under the overall cap so
    // far. Its check passes, then it charges.
    expect(() => checkCaps(config, composedA.get(), 0.8)).not.toThrow();
    composedA.add(0.8);

    // Session B: a different session ledger composed with the same global
    // ledger. B is well under its own session cap (its session total is 0).
    const sessionB = createSpendLedger();
    const composedB = composeLedger(sessionB, global);

    // B's own session total is 0, so the session cap is fine. But the overall
    // total already holds A's 0.8; 0.8 + 0.8 = 1.6 > 1.5 overall cap, so B's
    // check fails on the overall cap.
    let caught: unknown;
    try {
      checkCaps(config, composedB.get(), 0.8);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(CapExceededError);
    expect((caught as CapExceededError).reason).toBe("overall");

    // B's session ledger was never charged (the check threw first).
    expect(sessionB.get().sessionSpendUsd).toBe(0);
  });
});
