// src/server/sessions.ts
// Session store (R-01, R-07a).
//
// No accounts, and no session on every request. A static-file request or a
// read-only API call carries no session and mints none. The server mints a
// session only on the first writing call (record or fork). On minting it sets
// an opaque session id in an HttpOnly cookie and creates a session record with
// its own trace dir and its own session SpendLedger, so spend accumulates
// across forks. The live session count is capped; a TTL sweep deletes expired
// sessions and their trace dirs, refusing any path that resolves outside
// config.traceRoot.

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { SpendLedger } from "./caps.js";
import { createSpendLedger } from "./caps.js";

export interface Session {
  id: string;
  // <config.traceRoot>/<id>, created on first write.
  traceDir: string;
  // The session ledger, from createSpendLedger().
  ledger: SpendLedger;
  // epoch ms
  createdAt: number;
  // epoch ms, bumped on each request
  lastSeenAt: number;
}

// The config slice the session store needs.
export interface SessionStoreConfig {
  // Parent dir for per-session trace dirs.
  traceRoot: string;
  // A session expires this many ms after lastSeenAt.
  sessionTtlMs: number;
  // The session cap (R-07a).
  maxLiveSessions: number;
}

export interface SessionStore {
  // Returns the caller's session, or undefined for a read-only / static call.
  get(req: IncomingMessage): Session | undefined;
  // Mints a session for a writing call. Throws SessionCapFull when the live
  // session count is at config.maxLiveSessions.
  create(req: IncomingMessage): Session;
  // Deletes expired sessions and their trace dirs.
  sweepExpired(nowMs: number): void;
  liveCount(): number;
}

// Thrown by create when the live session count is at maxLiveSessions. The route
// turns this into a 503 with a plain reason (R-07a).
export class SessionCapFull extends Error {
  constructor() {
    super("SessionCapFull: no free session slot");
    this.name = "SessionCapFull";
  }
}

// Reads the sessionId value from a request's cookie header, if present.
function readSessionCookie(req: IncomingMessage): string | undefined {
  const cookie = req.headers?.cookie;
  if (typeof cookie !== "string") {
    return undefined;
  }
  for (const part of cookie.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const name = trimmed.slice(0, eq).trim();
    if (name === "sessionId") {
      return trimmed.slice(eq + 1).trim();
    }
  }
  return undefined;
}

// Returns true when dir resolves to a path inside root (or root itself). Used
// before removing a session's trace dir, so a sweep never removes a path that
// resolves outside traceRoot.
function isInside(root: string, dir: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedDir = path.resolve(dir);
  if (resolvedDir === resolvedRoot) {
    return true;
  }
  return resolvedDir.startsWith(resolvedRoot + path.sep);
}

// Creates a SessionStore bound to the given config.
export function createSessionStore(config: SessionStoreConfig): SessionStore {
  const sessions = new Map<string, Session>();

  const isExpired = (session: Session, nowMs: number): boolean =>
    nowMs - session.lastSeenAt > config.sessionTtlMs;

  const get = (req: IncomingMessage): Session | undefined => {
    const id = readSessionCookie(req);
    if (id === undefined) {
      return undefined;
    }
    const session = sessions.get(id);
    if (session === undefined) {
      return undefined;
    }
    const now = Date.now();
    if (isExpired(session, now)) {
      sessions.delete(id);
      return undefined;
    }
    // Bump lastSeenAt so an active session does not expire under it.
    session.lastSeenAt = now;
    return session;
  };

  const create = (req: IncomingMessage): Session => {
    // A writing call that already carries a valid session reuses it, so spend
    // accumulates across forks rather than resetting.
    const existing = get(req);
    if (existing !== undefined) {
      return existing;
    }

    if (sessions.size >= config.maxLiveSessions) {
      throw new SessionCapFull();
    }

    const id = randomUUID();
    const now = Date.now();
    const session: Session = {
      id,
      traceDir: path.join(config.traceRoot, id),
      ledger: createSpendLedger(),
      createdAt: now,
      lastSeenAt: now,
    };
    sessions.set(id, session);
    return session;
  };

  const sweepExpired = (nowMs: number): void => {
    for (const [id, session] of sessions) {
      if (!isExpired(session, nowMs)) {
        continue;
      }
      // Remove the trace dir only when it resolves inside traceRoot. A dir that
      // resolves outside is left untouched: the sweep never removes it.
      if (isInside(config.traceRoot, session.traceDir)) {
        fs.rmSync(session.traceDir, { recursive: true, force: true });
      }
      sessions.delete(id);
    }
  };

  const liveCount = (): number => sessions.size;

  return { get, create, sweepExpired, liveCount };
}
