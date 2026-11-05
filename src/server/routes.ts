// src/server/routes.ts
// The JSON route handlers and the SSE stream (Task 8).
//
// Eight endpoints:
//   GET  /api/mode            none                -> { modelMode, forkableStepIds }
//   POST /api/record          { task }            -> { runId }
//   GET  /api/traces          none                -> TraceSummary[]
//   GET  /api/traces/:runId   none                -> Trace or 404
//   POST /api/fork            ForkRequest         -> ForkResponse
//   POST /api/compare         { aRunId, bRunId }  -> CompareResult
//   POST /api/stop            { forkId }          -> { runId }
//   GET  /api/stream/:id      SSE                 -> step events then done/cap/error
//
// POST /api/record and POST /api/fork mint a session when the caller has none;
// the read-only GETs and the static files do not. All string inputs are data
// (R-10), escaped by the UI on display. The composed ledger (Task 5) is passed
// into every forkTrace; the per-forkId AbortController backs /api/stop; a
// stream is bound to the session that opened it (R-10a). In demo mode a fork
// returns the prerecorded future for the chosen fork point, or is refused with
// a plain message when the step has no future (R-14, R-17). GET /api/mode lets
// the UI learn, on first load, whether it is in demo mode and which fork points
// have a prerecorded future, so the banner shows and only those fork points are
// offered (R-14, R-17).

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Trace, Step, ModelCallStep } from "../trace/types.js";
import type { StepEdit } from "../compare/types.js";
import { loadTrace } from "../trace/save.js";
import { TraceVersionError } from "../trace/version.js";
import { Recorder } from "../recorder/recorder.js";
import { forkTrace } from "../compare/fork.js";
import type { ForkOptions } from "../compare/fork.js";
import { compareBranches } from "../compare/compare.js";
import { makeFakeModel } from "../agent/fake-model.js";
import type { ServerConfig, ModelMode } from "./config.js";
import type { SessionStore, Session } from "./sessions.js";
import { SessionCapFull } from "./sessions.js";
import type { RateLimiter } from "./rateLimit.js";
import type { SpendLedger } from "./caps.js";
import { composeLedger } from "./ledger.js";

// A one-line summary of a run for the trace list and the branch tree.
export interface TraceSummary {
  runId: string;
  parentRunId?: string;
  forkPointStepId?: string;
  createdAt: string;
  stepCount: number;
  // Last model_call output content, or null.
  finalOutput: string | null;
}

export interface ForkRequest {
  parentRunId: string;
  forkPointStepId: string;
  // Exactly one edit, from src/compare/types.ts.
  edit: StepEdit;
  // The stream the UI opened first, so live steps route to it.
  streamId?: string;
  // The id the UI uses to stop this fork (R-08).
  forkId?: string;
}

export type ForkResponse =
  | { status: "ok"; runId: string; demoMode?: boolean }
  | {
      status: "cap_hit";
      reason: "session" | "overall";
      limitUsd: number;
      runId: string;
    };

// The record request body.
export interface RecordRequest {
  task: string;
  streamId?: string;
}

// GET /api/mode response: the server's model mode and, in demo mode, the fork
// points that have a prerecorded future. The UI reads this on first load so the
// banner shows its reason and the edit screen offers only those fork points
// (R-14, R-17). In fake mode forkableStepIds is empty and is unused.
export interface ModeResponse {
  modelMode: ModelMode;
  forkableStepIds: string[];
}

// The dependencies the router needs, wired once at server start.
export interface RouterDeps {
  config: ServerConfig;
  sessions: SessionStore;
  rateLimiter: RateLimiter;
  // The one global ledger for the overall cap (Task 5).
  globalLedger: SpendLedger;
}

// A router that dispatches one request to the matching handler. Returns true
// when it handled the request (JSON endpoint or SSE stream), false when the
// path is not an API path so the caller falls through to static serving.
export interface Router {
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
}

// An open SSE stream: the response to write events to, and the session that
// owns it. ownerSessionId is undefined when the stream was opened before any
// session existed; it is bound to a session by the first writing call that
// carries the same streamId (bindStream). A writing call looks the stream up
// by id and writes one "step" event per live step, then a terminal event.
interface OpenStream {
  res: ServerResponse;
  ownerSessionId: string | undefined;
}

// A running fork the server can stop (R-08). The controller aborts the fork's
// signal; done resolves with the saved partial-branch runId once forkTrace
// returns, so /api/stop can report the runId. ownerSessionId gates a stop from
// another session (a 404).
interface RunningFork {
  controller: AbortController;
  ownerSessionId: string;
  done: Promise<string>;
}

// Builds the router from its dependencies.
export function createRouter(deps: RouterDeps): Router {
  const { config, sessions, rateLimiter, globalLedger } = deps;

  // Open SSE streams, keyed by the streamId the UI generated.
  const openStreams = new Map<string, OpenStream>();
  // Running forks, keyed by the forkId the UI generated (R-08).
  const runningForks = new Map<string, RunningFork>();

  // Demo fixtures, loaded once at first use when modelMode is "demo".
  let demoIndex: DemoIndex | null = null;
  const demo = async (): Promise<DemoIndex> => {
    if (demoIndex === null) {
      demoIndex = await loadDemoIndex(config.demoDir);
    }
    return demoIndex;
  };

  // Resolve the stream a writing call should write to, binding it to the
  // call's session when it was opened before any session existed (R-10a). A
  // stream opened with no session is claimed by the first writing call that
  // carries its streamId; from then on it belongs to that session. Returns
  // undefined when there is no open stream for the id, or when the stream is
  // already bound to a different session (so a writing call cannot steal
  // another session's stream).
  const bindStream = (
    streamId: string | undefined,
    session: Session
  ): OpenStream | undefined => {
    if (streamId === undefined) return undefined;
    const stream = openStreams.get(streamId);
    if (stream === undefined) return undefined;
    if (stream.ownerSessionId === undefined) {
      // Opened before any session existed: bind it to this session now.
      stream.ownerSessionId = session.id;
      return stream;
    }
    if (stream.ownerSessionId !== session.id) {
      // Already bound to another session: this call does not own it.
      return undefined;
    }
    return stream;
  };

  const handle = async (
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<boolean> => {
    const url = req.url ?? "";
    const pathname = url.split("?")[0] ?? "";

    if (!pathname.startsWith("/api/")) {
      return false;
    }

    const method = (req.method ?? "GET").toUpperCase();

    try {
      if (method === "GET" && pathname === "/api/mode") {
        await handleMode(req, res);
        return true;
      }
      if (method === "POST" && pathname === "/api/record") {
        await handleRecord(req, res);
        return true;
      }
      if (method === "GET" && pathname === "/api/traces") {
        await handleListTraces(req, res);
        return true;
      }
      if (method === "GET" && pathname.startsWith("/api/traces/")) {
        const runId = decodeURIComponent(pathname.slice("/api/traces/".length));
        await handleGetTrace(req, res, runId);
        return true;
      }
      if (method === "POST" && pathname === "/api/fork") {
        await handleFork(req, res);
        return true;
      }
      if (method === "POST" && pathname === "/api/compare") {
        await handleCompare(req, res);
        return true;
      }
      if (method === "POST" && pathname === "/api/stop") {
        await handleStop(req, res);
        return true;
      }
      if (method === "GET" && pathname.startsWith("/api/stream/")) {
        const streamId = decodeURIComponent(
          pathname.slice("/api/stream/".length)
        );
        await handleStream(req, res, streamId);
        return true;
      }
    } catch (err) {
      // A plain 500 with no stack and no key. The reason stays generic.
      if (!res.headersSent) {
        sendText(res, 500, "The server could not complete this request.");
      } else {
        res.end();
      }
      return true;
    }

    sendText(res, 404, "Not found.");
    return true;
  };

  // GET /api/mode -> { modelMode, forkableStepIds }. A read-only call that
  // mints no session. In demo mode forkableStepIds lists the fork points that
  // have a prerecorded future; in fake mode it is empty.
  async function handleMode(
    _req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    let forkableStepIds: string[] = [];
    if (config.modelMode === "demo") {
      const index = await demo();
      forkableStepIds = index.forkableStepIds;
    }
    const response: ModeResponse = {
      modelMode: config.modelMode,
      forkableStepIds,
    };
    sendJson(res, 200, response);
  }

  // POST /api/record { task, streamId? } -> { runId }
  async function handleRecord(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const body = await readJson<RecordRequest>(req);
    const task = typeof body?.task === "string" ? body.task : "";
    const streamId =
      typeof body?.streamId === "string" ? body.streamId : undefined;

    // Mint (or reuse) a session for this writing call.
    let session: Session;
    try {
      session = sessions.create(req);
    } catch (err) {
      if (err instanceof SessionCapFull) {
        sendText(
          res,
          503,
          "No session slots are free right now. Please try again shortly."
        );
        return;
      }
      throw err;
    }

    // Rate limit the record action (per session, per IP, global).
    const rl = rateLimiter.check(
      { action: "record", ip: clientIp(req), sessionId: session.id },
      Date.now()
    );
    if (!rl.allowed) {
      setSessionCookie(res, session);
      sendText(res, 429, rl.reason);
      return;
    }

    // Bind the stream to this session (R-10a). A stream opened before any
    // session existed is claimed here; a stream already bound to another
    // session is not written to.
    const stream = bindStream(streamId, session);
    // The fake model's per-step delay comes from config: 0 in a local run and
    // the unit tests, a small value in the e2e run so the UI can show the Stop
    // button and measure its box while live steps still arrive (R-08, R-11).
    const fake = makeFakeModel({ stepDelayMs: config.fakeStepDelayMs });
    const recorder = new Recorder({
      modelAdapter: fake.modelAdapter,
      toolRegistry: fake.toolRegistry,
      traceDir: session.traceDir,
      modelName: "fake",
      onStep: (step) => writeStepEvent(stream, step),
    });

    let trace: Trace;
    try {
      trace = await recorder.run(task);
    } catch (err) {
      finishStream(stream, { kind: "error", message: "The run failed." });
      if (streamId) openStreams.delete(streamId);
      throw err;
    }

    finishStream(stream, { kind: "done", runId: trace.runId });
    if (streamId) openStreams.delete(streamId);

    setSessionCookie(res, session);
    sendJson(res, 200, { runId: trace.runId });
  }

  // GET /api/traces -> TraceSummary[]
  async function handleListTraces(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    if (config.modelMode === "demo") {
      const index = await demo();
      sendJson(res, 200, index.traces.map(summarise));
      return;
    }

    const session = sessions.get(req);
    if (session === undefined) {
      // A read-only call with no session gets an empty list, never a session.
      sendJson(res, 200, []);
      return;
    }
    const traces = await loadSessionTraces(session.traceDir);
    sendJson(res, 200, traces.map(summarise));
  }

  // GET /api/traces/:runId -> Trace or 404
  async function handleGetTrace(
    req: IncomingMessage,
    res: ServerResponse,
    runId: string
  ): Promise<void> {
    const trace = await findTrace(req, runId);
    if (trace === undefined) {
      sendText(res, 404, "No trace with that id.");
      return;
    }
    sendJson(res, 200, trace);
  }

  // POST /api/fork ForkRequest -> ForkResponse
  async function handleFork(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const body = await readJson<ForkRequest>(req);
    if (
      !body ||
      typeof body.parentRunId !== "string" ||
      typeof body.forkPointStepId !== "string" ||
      typeof body.edit !== "object" ||
      body.edit === null
    ) {
      sendText(res, 400, "A fork needs a parent run, a fork point and an edit.");
      return;
    }
    const streamId =
      typeof body.streamId === "string" ? body.streamId : undefined;
    const forkId = typeof body.forkId === "string" ? body.forkId : undefined;

    let session: Session;
    try {
      session = sessions.create(req);
    } catch (err) {
      if (err instanceof SessionCapFull) {
        sendText(
          res,
          503,
          "No session slots are free right now. Please try again shortly."
        );
        return;
      }
      throw err;
    }

    const rl = rateLimiter.check(
      { action: "fork", ip: clientIp(req), sessionId: session.id },
      Date.now()
    );
    if (!rl.allowed) {
      setSessionCookie(res, session);
      sendText(res, 429, rl.reason);
      return;
    }

    // Bind the stream to this session (R-10a), claiming one opened before any
    // session existed and refusing to write to one owned by another session.
    const stream = bindStream(streamId, session);

    // Demo mode: return the prerecorded future for the chosen fork point, or
    // refuse a step with no future with a plain message (R-14, R-17).
    if (config.modelMode === "demo") {
      const index = await demo();
      const future = index.futureFor(body.parentRunId, body.forkPointStepId);
      if (future === undefined) {
        setSessionCookie(res, session);
        sendText(
          res,
          400,
          "This step has no prerecorded future in demo mode. Pick a step that does."
        );
        return;
      }
      // Replay the future's steps to the open stream so the UI streams the
      // same way as a live fork.
      for (const step of future.steps) {
        writeStepEvent(stream, step);
      }
      finishStream(stream, { kind: "done", runId: future.runId });
      if (streamId) openStreams.delete(streamId);
      setSessionCookie(res, session);
      const response: ForkResponse = {
        status: "ok",
        runId: future.runId,
        demoMode: true,
      };
      sendJson(res, 200, response);
      return;
    }

    // Live (fake-model) fork.
    const parentTrace = await loadSessionTrace(session.traceDir, body.parentRunId);
    if (parentTrace === undefined) {
      setSessionCookie(res, session);
      sendText(res, 404, "No parent run with that id.");
      return;
    }

    const controller = new AbortController();
    // The same per-step delay the record path uses, so the live phase does not
    // finish in the tick it starts and the Stop button can be observed and
    // measured (R-08, R-11). 0 outside the e2e run, so nothing else changes.
    const fake = makeFakeModel({ stepDelayMs: config.fakeStepDelayMs });
    const ledger = composeLedger(session.ledger, globalLedger);
    const options: ForkOptions = {
      parentTrace,
      forkEdit: { forkPointStepId: body.forkPointStepId, edit: body.edit },
      modelAdapter: fake.modelAdapter,
      toolRegistry: fake.toolRegistry,
      traceDir: session.traceDir,
      capConfig: config.caps,
      spendLedger: ledger,
      // Pass the server's optional price overrides so the e2e cap server can
      // price the fake model and trip a cap through the real path. Undefined
      // in production, so pricing is unchanged.
      priceOverrides: config.priceOverrides,
      signal: controller.signal,
      onStep: (step) => writeStepEvent(stream, step),
    };

    // Run the fork and expose its saved runId as a promise, so /api/stop can
    // report the partial branch's runId once the save completes (R-08).
    const forkPromise = forkTrace(options);
    if (forkId) {
      runningForks.set(forkId, {
        controller,
        ownerSessionId: session.id,
        done: forkPromise.then((r) =>
          r.status === "ok" ? r.branch.runId : r.partialBranch.runId
        ),
      });
    }

    try {
      const result = await forkPromise;
      if (forkId) runningForks.delete(forkId);

      if (result.status === "cap_hit") {
        finishStream(stream, {
          kind: "cap",
          reason: result.reason,
          limitUsd: result.limitUsd,
          runId: result.partialBranch.runId,
        });
        if (streamId) openStreams.delete(streamId);
        setSessionCookie(res, session);
        const response: ForkResponse = {
          status: "cap_hit",
          reason: result.reason,
          limitUsd: result.limitUsd,
          runId: result.partialBranch.runId,
        };
        sendJson(res, 200, response);
        return;
      }

      finishStream(stream, { kind: "done", runId: result.branch.runId });
      if (streamId) openStreams.delete(streamId);
      setSessionCookie(res, session);
      const response: ForkResponse = { status: "ok", runId: result.branch.runId };
      sendJson(res, 200, response);
    } catch (err) {
      if (forkId) runningForks.delete(forkId);
      finishStream(stream, { kind: "error", message: "The fork failed." });
      if (streamId) openStreams.delete(streamId);
      throw err;
    }
  }

  // POST /api/compare { aRunId, bRunId } -> CompareResult
  async function handleCompare(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const body = await readJson<{ aRunId?: string; bRunId?: string }>(req);
    const aRunId = typeof body?.aRunId === "string" ? body.aRunId : "";
    const bRunId = typeof body?.bRunId === "string" ? body.bRunId : "";

    const a = await findTrace(req, aRunId);
    const b = await findTrace(req, bRunId);
    if (a === undefined || b === undefined) {
      sendText(res, 404, "One of the runs to compare was not found.");
      return;
    }
    sendJson(res, 200, compareBranches(a, b));
  }

  // POST /api/stop { forkId } -> { runId }. Aborts the running fork's signal;
  // forkTrace stops after the current step and saves the partial branch. Stop
  // waits for that save and returns the partial branch's runId. A stop for an
  // unknown forkId, or from a session that does not own the fork, is a 404.
  async function handleStop(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const body = await readJson<{ forkId?: string }>(req);
    const forkId = typeof body?.forkId === "string" ? body.forkId : "";
    const session = sessions.get(req);
    const running = runningForks.get(forkId);
    if (running === undefined || running.ownerSessionId !== session?.id) {
      sendText(res, 404, "No running fork with that id.");
      return;
    }
    running.controller.abort();
    const runId = await running.done;
    sendJson(res, 200, { runId });
  }

  // GET /api/stream/:streamId (SSE). Binds the stream to the opening session
  // (R-10a). A stream id already open is owned by its opener: a second open of
  // the same id by a different session, or by a no-session caller when the
  // stream is bound, gets a 404. A stream opened with no session (before the
  // first writing call mints one) is left unbound; the writing call that
  // carries the same streamId claims it (bindStream). A second open of an
  // unbound stream is still refused, so only one caller holds it.
  async function handleStream(
    req: IncomingMessage,
    res: ServerResponse,
    streamId: string
  ): Promise<void> {
    const session = sessions.get(req);
    const ownerId = session?.id;

    const existing = openStreams.get(streamId);
    if (existing !== undefined) {
      // A stream id is held by exactly one opener. Only the same bound session
      // may re-open it; anyone else (a different session, or any caller while
      // the stream is still unbound) gets a 404.
      if (
        existing.ownerSessionId === undefined ||
        existing.ownerSessionId !== ownerId
      ) {
        sendText(res, 404, "No such stream.");
        return;
      }
    }

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    // A first comment flushes the headers so the client sees a 200 at once.
    res.write(": open\n\n");

    openStreams.set(streamId, { res, ownerSessionId: ownerId });

    // Resolve when the response ends (the writing call finishes the stream) or
    // the client disconnects.
    await new Promise<void>((resolve) => {
      res.on("close", () => {
        openStreams.delete(streamId);
        resolve();
      });
    });
  }

  // Finds a trace by id for the caller: demo fixtures in demo mode, else the
  // caller's session dir.
  async function findTrace(
    req: IncomingMessage,
    runId: string
  ): Promise<Trace | undefined> {
    if (config.modelMode === "demo") {
      const index = await demo();
      return index.byId.get(runId);
    }
    const session = sessions.get(req);
    if (session === undefined) {
      return undefined;
    }
    return loadSessionTrace(session.traceDir, runId);
  }

  return { handle };
}

// Builds a TraceSummary from a full trace.
export function summarise(trace: Trace): TraceSummary {
  let finalOutput: string | null = null;
  for (const step of trace.steps) {
    if (step.kind === "model_call") {
      finalOutput = (step as ModelCallStep).output.message.content;
    }
  }
  const summary: TraceSummary = {
    runId: trace.runId,
    createdAt: trace.createdAt,
    stepCount: trace.steps.length,
    finalOutput,
  };
  if (trace.parentRunId !== undefined) summary.parentRunId = trace.parentRunId;
  if (trace.forkPointStepId !== undefined) {
    summary.forkPointStepId = trace.forkPointStepId;
  }
  return summary;
}

// --- demo fixtures ---

interface DemoIndex {
  traces: Trace[];
  byId: Map<string, Trace>;
  // Fork-point step ids that have a prerecorded future.
  forkableStepIds: string[];
  // Returns the future for a (parentRunId, forkPointStepId) pair, or undefined.
  futureFor(parentRunId: string, forkPointStepId: string): Trace | undefined;
}

async function loadDemoIndex(demoDir: string): Promise<DemoIndex> {
  const traces: Trace[] = [];
  let entries: string[] = [];
  try {
    entries = await fs.readdir(demoDir);
  } catch {
    entries = [];
  }
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      traces.push(await loadTrace(path.join(demoDir, name)));
    } catch {
      // Skip a file that is not a valid trace (e.g. a README).
    }
  }

  const byId = new Map<string, Trace>();
  for (const t of traces) byId.set(t.runId, t);

  const futures = traces.filter(
    (t) => t.parentRunId !== undefined && t.forkPointStepId !== undefined
  );
  const forkableStepIds = Array.from(
    new Set(futures.map((t) => t.forkPointStepId as string))
  );

  const futureFor = (
    parentRunId: string,
    forkPointStepId: string
  ): Trace | undefined =>
    futures.find(
      (t) =>
        t.parentRunId === parentRunId && t.forkPointStepId === forkPointStepId
    );

  return { traces, byId, forkableStepIds, futureFor };
}

// --- session trace files ---

async function loadSessionTraces(traceDir: string): Promise<Trace[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(traceDir);
  } catch {
    return [];
  }
  const traces: Trace[] = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      traces.push(await loadTrace(path.join(traceDir, name)));
    } catch {
      // Skip an unreadable or stale file.
    }
  }
  return traces;
}

async function loadSessionTrace(
  traceDir: string,
  runId: string
): Promise<Trace | undefined> {
  // runId is used as a file name; reject anything with a path separator so a
  // crafted id cannot escape the session dir.
  if (runId.includes("/") || runId.includes("\\") || runId.includes("..")) {
    return undefined;
  }
  try {
    return await loadTrace(path.join(traceDir, `${runId}.json`));
  } catch (err) {
    if (err instanceof TraceVersionError) throw err;
    return undefined;
  }
}

// --- SSE events ---

type TerminalEvent =
  | { kind: "done"; runId: string }
  | { kind: "cap"; reason: "session" | "overall"; limitUsd: number; runId: string }
  | { kind: "error"; message: string };

// Writes one "step" SSE event to the open stream, if any. The data is the step
// as JSON, so the UI reads the same id and payload the saved branch holds.
function writeStepEvent(stream: OpenStream | undefined, step: Step): void {
  if (stream === undefined) return;
  stream.res.write(`event: step\ndata: ${JSON.stringify(step)}\n\n`);
}

// Writes the terminal event and ends the stream response, if any.
function finishStream(
  stream: OpenStream | undefined,
  event: TerminalEvent
): void {
  if (stream === undefined) return;
  const { res } = stream;
  if (event.kind === "done") {
    res.write(`event: done\ndata: ${JSON.stringify({ runId: event.runId })}\n\n`);
  } else if (event.kind === "cap") {
    res.write(
      `event: cap\ndata: ${JSON.stringify({
        reason: event.reason,
        limitUsd: event.limitUsd,
        runId: event.runId,
      })}\n\n`
    );
  } else {
    res.write(
      `event: error\ndata: ${JSON.stringify({ message: event.message })}\n\n`
    );
  }
  res.end();
}

// --- request/response helpers ---

// Reads and parses a JSON request body. Returns undefined on an empty or
// invalid body, so a handler can reply with a plain 400.
async function readJson<T>(req: IncomingMessage): Promise<T | undefined> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (raw.trim() === "") return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  res.end(json);
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

// The client IP for the per-IP rate limit. The raw socket address is enough on
// the public URL; there is no trusted proxy header to read here.
function clientIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? "unknown";
}

// Sets the HttpOnly session cookie for a minted or reused session.
function setSessionCookie(res: ServerResponse, session: Session): void {
  res.setHeader(
    "set-cookie",
    `sessionId=${session.id}; HttpOnly; Path=/; SameSite=Strict`
  );
}
