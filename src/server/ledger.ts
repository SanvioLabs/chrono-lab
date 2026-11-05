// src/server/ledger.ts
// The two ledgers compose (R-07).
//
// The overall cap is a property of the whole server, so one global SpendLedger
// holds the only overall total that matters. Each session holds its own session
// SpendLedger. composeLedger joins a session ledger and the global ledger into
// one SpendLedger view: get() reports sessionSpendUsd from the session ledger
// and overallSpendUsd from the global ledger, and add(cost) charges both. The
// server passes this composed view into forkTrace, so caps.ts is unchanged
// beyond the Task 1 "fake" price entry.

import type { SpendLedger } from "./caps.js";
import { createSpendLedger } from "./caps.js";

// The one global SpendLedger for the server. The overall total lives in one
// shared place, so opening many sessions cannot spend past the overall cap:
// every session's live call adds to this same total and is checked against it.
const GLOBAL_LEDGER: SpendLedger = createSpendLedger();

// Returns the one global SpendLedger for the server.
export function getGlobalLedger(): SpendLedger {
  return GLOBAL_LEDGER;
}

// Composes a session ledger and the global ledger into one SpendLedger view.
// get() reports sessionSpendUsd from the session ledger and overallSpendUsd
// from the global ledger; add(cost) charges both.
export function composeLedger(
  session: SpendLedger,
  global: SpendLedger
): SpendLedger {
  return {
    get: () => ({
      sessionSpendUsd: session.get().sessionSpendUsd,
      overallSpendUsd: global.get().overallSpendUsd,
    }),
    add: (costUsd: number) => {
      session.add(costUsd);
      global.add(costUsd);
    },
  };
}
