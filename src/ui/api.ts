// src/ui/api.ts
// The typed client for the eight server endpoints plus the SSE stream.
//
// One function per endpoint, each typed against the server's shapes. A non-2xx
// response (429, 404, 503 and the rest) resolves to a typed ApiError the
// calling screen turns into its error or cap_reached state; the client never
// throws a raw network error at a screen. openStream wraps EventSource for the
// live-step stream and resolves a `ready` promise when the connection opens, so
// a caller can open the stream before the writing call that carries the same
// streamId (the server binds the stream to the session on open, R-10a).

import type { Trace, Step } from "../trace/types.js";
import type { StepEdit } from "../compare/types.js";
import type { CompareResult } from "../compare/compare.js";
import type { ModelMode } from "../server/config.js";
import type { TraceSummary, ForkResponse, ModeResponse } from "../server/routes.js";

// A typed failure: the HTTP status and the server's plain reason text. The
// client resolves to this instead of throwing, so a screen always gets a value.
export interface ApiError {
  ok: false;
  status: number;
  message: string;
}

export type ApiResult<T> = ({ ok: true } & T) | ApiError;

// A small fetch wrapper that returns the parsed JSON on a 2xx and an ApiError
// otherwise. It reads the body as text first so a plain-text error (the server
// sends text/plain for 4xx/5xx) becomes the ApiError message.
async function requestJson<T>(
  input: string,
  init?: RequestInit
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch {
    return { ok: false, status: 0, message: "Could not reach the server." };
  }
  const raw = await res.text();
  if (!res.ok) {
    const message = raw.trim() === "" ? `Request failed (${res.status}).` : raw;
    return { ok: false, status: res.status, message };
  }
  let parsed: unknown;
  try {
    parsed = raw.trim() === "" ? {} : JSON.parse(raw);
  } catch {
    return { ok: false, status: res.status, message: "Bad response from server." };
  }
  return { ok: true, ...(parsed as T) };
}

function jsonInit(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  };
}

// GET /api/mode -> { modelMode, forkableStepIds }. The UI reads this once on
// first load so the banner shows its reason in demo mode and the edit screen
// offers only the fork points that have a prerecorded future (R-14, R-17). A
// read-only call that mints no session.
//
// The body is parsed to unknown and checked by shape: a modelMode that is one
// of the two allowed values and a forkableStepIds array of strings. A body
// missing or malforming either is a bad response, not a silent half-built ok
// result, so the ok result is built explicitly from the checked fields rather
// than spread from a wider type. isModeResponse narrows modelMode to ModelMode,
// so the built result typechecks without a cast.
export async function getMode(): Promise<ApiResult<ModeResponse>> {
  let res: Response;
  try {
    res = await fetch("/api/mode", { credentials: "same-origin" });
  } catch {
    return { ok: false, status: 0, message: "Could not reach the server." };
  }
  const raw = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, message: raw || "Request failed." };
  }
  let parsed: unknown;
  try {
    parsed = raw.trim() === "" ? {} : JSON.parse(raw);
  } catch {
    return { ok: false, status: res.status, message: "Bad response from server." };
  }
  if (!isModeResponse(parsed)) {
    return { ok: false, status: res.status, message: "Bad response from server." };
  }
  return {
    ok: true,
    modelMode: parsed.modelMode,
    forkableStepIds: parsed.forkableStepIds,
  };
}

// A body is a ModeResponse when modelMode is one of the two allowed values and
// forkableStepIds is an array of strings. Checking modelMode against the
// literals (not just typeof string) narrows it to ModelMode, so getMode can
// build its ok result without a cast and never returns a half-built result when
// the server sends an empty or malformed body.
function isModeResponse(value: unknown): value is ModeResponse {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const mode = v["modelMode"];
  if (mode !== "fake" && mode !== "demo") return false;
  const ids = v["forkableStepIds"];
  if (!Array.isArray(ids)) return false;
  return ids.every((id) => typeof id === "string");
}

// POST /api/record { task, streamId? } -> { runId }
export function record(
  task: string,
  streamId?: string
): Promise<ApiResult<{ runId: string }>> {
  return requestJson<{ runId: string }>(
    "/api/record",
    jsonInit({ task, streamId })
  );
}

// GET /api/traces -> TraceSummary[]
export async function listTraces(): Promise<ApiResult<{ traces: TraceSummary[] }>> {
  // The endpoint returns a bare array, so wrap it under `traces` for a stable
  // typed result shape.
  let res: Response;
  try {
    res = await fetch("/api/traces", { credentials: "same-origin" });
  } catch {
    return { ok: false, status: 0, message: "Could not reach the server." };
  }
  const raw = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, message: raw || "Request failed." };
  }
  try {
    const traces = raw.trim() === "" ? [] : (JSON.parse(raw) as TraceSummary[]);
    return { ok: true, traces };
  } catch {
    return { ok: false, status: res.status, message: "Bad response from server." };
  }
}

// GET /api/traces/:runId -> Trace or 404
export async function getTrace(
  runId: string
): Promise<ApiResult<{ trace: Trace }>> {
  let res: Response;
  try {
    res = await fetch(`/api/traces/${encodeURIComponent(runId)}`, {
      credentials: "same-origin",
    });
  } catch {
    return { ok: false, status: 0, message: "Could not reach the server." };
  }
  const raw = await res.text();
  if (!res.ok) {
    return { ok: false, status: res.status, message: raw || "Not found." };
  }
  try {
    return { ok: true, trace: JSON.parse(raw) as Trace };
  } catch {
    return { ok: false, status: res.status, message: "Bad response from server." };
  }
}

export interface ForkArgs {
  parentRunId: string;
  forkPointStepId: string;
  edit: StepEdit;
  streamId?: string;
  forkId?: string;
}

// POST /api/fork ForkRequest -> ForkResponse
export function fork(args: ForkArgs): Promise<ApiResult<ForkResponse>> {
  return requestJson<ForkResponse>("/api/fork", jsonInit(args));
}

// POST /api/compare { aRunId, bRunId } -> CompareResult
export function compare(
  aRunId: string,
  bRunId: string
): Promise<ApiResult<CompareResult>> {
  return requestJson<CompareResult>(
    "/api/compare",
    jsonInit({ aRunId, bRunId })
  );
}

// POST /api/stop { forkId } -> { runId }
export function stop(forkId: string): Promise<ApiResult<{ runId: string }>> {
  return requestJson<{ runId: string }>("/api/stop", jsonInit({ forkId }));
}

// --- the SSE stream ---

export interface StreamHandlers {
  onStep: (step: Step) => void;
  onDone: (runId: string) => void;
  onCap: (reason: "session" | "overall", limitUsd: number, runId: string) => void;
  onError: (message: string) => void;
}

// A handle to an open stream: a `ready` promise that resolves when the
// connection opens (so a caller can post the writing call only after the server
// has registered the stream), and `close` to end it.
export interface StreamHandle {
  ready: Promise<void>;
  close(): void;
}

// Opens GET /api/stream/:streamId and routes each event to the handlers. The
// stream must be opened before the writing call that carries the same
// streamId, so the server can bind it to the session (R-10a). A terminal event
// (done/cap/error) closes the EventSource.
export function openStream(
  streamId: string,
  handlers: StreamHandlers
): StreamHandle {
  const es = new EventSource(`/api/stream/${encodeURIComponent(streamId)}`, {
    withCredentials: true,
  });

  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  es.addEventListener("open", () => resolveReady());

  es.addEventListener("step", (ev) => {
    try {
      const step = JSON.parse((ev as MessageEvent).data) as Step;
      handlers.onStep(step);
    } catch {
      // Ignore a malformed step frame; the run still completes and saves.
    }
  });

  es.addEventListener("done", (ev) => {
    try {
      const { runId } = JSON.parse((ev as MessageEvent).data) as { runId: string };
      handlers.onDone(runId);
    } finally {
      es.close();
    }
  });

  es.addEventListener("cap", (ev) => {
    try {
      const { reason, limitUsd, runId } = JSON.parse(
        (ev as MessageEvent).data
      ) as { reason: "session" | "overall"; limitUsd: number; runId: string };
      handlers.onCap(reason, limitUsd, runId);
    } finally {
      es.close();
    }
  });

  es.addEventListener("error", (ev) => {
    // EventSource fires "error" on a network drop too; only treat a data-
    // carrying frame as a server error event. A bare drop is ignored because
    // the run still completes server-side and the UI reloads by runId.
    const data = (ev as MessageEvent).data;
    if (typeof data === "string" && data.trim() !== "") {
      try {
        const { message } = JSON.parse(data) as { message: string };
        handlers.onError(message);
      } catch {
        handlers.onError("The run failed.");
      }
      es.close();
    }
  });

  return { ready, close: () => es.close() };
}

// A short random id for a stream or a fork. Uses crypto.randomUUID in the
// browser; falls back to a timestamp-based id if it is unavailable.
export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}
