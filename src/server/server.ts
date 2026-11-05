// src/server/server.ts
// The HTTP server: routing, static files, start/stop, CSP (Task 8).
//
// One plain Node http server. It serves static files from dist/ui (safe path
// resolution, Task 7), the seven API endpoints and the SSE stream (routes.ts),
// mints a session only on a writing call (sessions.ts), passes the composed
// ledger into every forkTrace (ledger.ts), holds the per-forkId AbortController
// for /api/stop, binds a stream to the session that opened it, and runs the
// rate limiter on every writing call. Every HTML response carries a
// same-origin-only Content-Security-Policy (R-01a). The live phase runs outside
// withNetworkGuard.

import * as http from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AddressInfo } from "node:net";
import type { ServerConfig } from "./config.js";
import { createSessionStore } from "./sessions.js";
import { createRateLimiter } from "./rateLimit.js";
import { createSpendLedger } from "./caps.js";
import { createRouter } from "./routes.js";
import { resolveStaticPath } from "./static.js";

// A running server. start resolves once it is listening; stop resolves once it
// has closed. address reports the bound host and port, so a test that passes
// port 0 can read the ephemeral port the OS chose.
export interface ServerHandle {
  // Starts listening. Resolves when the socket is bound.
  start(): Promise<void>;
  // Closes the server and its sweeper timer. Resolves when fully closed.
  stop(): Promise<void>;
  // The bound address, available after start resolves.
  address(): { host: string; port: number };
}

// The same-origin-only Content-Security-Policy on every HTML response (R-01a).
// The UI ships no inline scripts, so 'self'-only holds without relaxing it.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'self'";

// A small content-type table for the static files the UI ships.
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".map": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

// Builds a ServerHandle from the given config. Does not start listening until
// start is called. Each server owns its own session store, rate limiter and
// global ledger, so two servers in one process (the route test starts several)
// never share state.
export function createServer(config: ServerConfig): ServerHandle {
  const sessions = createSessionStore({
    traceRoot: config.traceRoot,
    sessionTtlMs: config.sessionTtlMs,
    maxLiveSessions: config.maxLiveSessions,
  });
  const rateLimiter = createRateLimiter(config.rateLimit);
  // One global ledger per server instance for the overall cap (R-07).
  const globalLedger = createSpendLedger();
  const router = createRouter({ config, sessions, rateLimiter, globalLedger });

  const httpServer = http.createServer((req, res) => {
    void handleRequest(req, res);
  });

  // ReturnType<typeof setInterval> rather than NodeJS.Timeout so the type
  // matches whichever setInterval overload (Node or DOM) the compiler picks.
  let sweepTimer: ReturnType<typeof setInterval> | null = null;

  async function handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    try {
      // API routes first. The router returns true when it handled the request.
      const handled = await router.handle(req, res);
      if (handled) return;

      // Otherwise serve a static file from dist/ui (safe resolution, Task 7).
      serveStatic(req, res);
    } catch {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end("The server could not complete this request.");
      } else {
        res.end();
      }
    }
  }

  function serveStatic(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    const method = (req.method ?? "GET").toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found.");
      return;
    }

    // Map "/" to index.html so the app root serves the single page.
    let urlPath = (req.url ?? "/").split("?")[0] ?? "/";
    if (urlPath === "/" || urlPath === "") {
      urlPath = "/index.html";
    }

    const resolution = resolveStaticPath(config.staticRoot, urlPath);
    if (!resolution.ok) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found.");
      return;
    }

    const contentType = contentTypeFor(resolution.filePath);
    const headers: Record<string, string> = { "content-type": contentType };
    // Every HTML response carries the same-origin-only CSP (R-01a).
    if (contentType.startsWith("text/html")) {
      headers["content-security-policy"] = CSP;
    }

    let data: Buffer;
    try {
      data = fs.readFileSync(resolution.filePath);
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found.");
      return;
    }

    res.writeHead(200, headers);
    if (method === "HEAD") {
      res.end();
    } else {
      res.end(data);
    }
  }

  const start = (): Promise<void> =>
    new Promise((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(config.port, "127.0.0.1", () => {
        httpServer.off("error", reject);
        // Sweep expired sessions on a timer.
        sweepTimer = setInterval(() => {
          sessions.sweepExpired(Date.now());
        }, Math.max(1000, Math.min(config.sessionTtlMs, 60_000)));
        // unref so the timer never keeps the process alive on its own. Access
        // through a minimal shape so this holds whether setInterval is typed as
        // Node's Timeout or the DOM's number.
        const timer = sweepTimer as unknown as { unref?: () => void };
        timer.unref?.();
        resolve();
      });
    });

  const stop = (): Promise<void> =>
    new Promise((resolve, reject) => {
      if (sweepTimer) {
        clearInterval(sweepTimer);
        sweepTimer = null;
      }
      httpServer.close((err) => {
        if (err) reject(err);
        else resolve();
      });
      // Drop keep-alive sockets so close resolves promptly even with an open
      // SSE connection the test left hanging.
      const closable = httpServer as unknown as {
        closeAllConnections?: () => void;
      };
      closable.closeAllConnections?.();
    });

  const address = (): { host: string; port: number } => {
    const addr = httpServer.address() as AddressInfo | null;
    if (addr === null || typeof addr === "string") {
      return { host: "127.0.0.1", port: config.port };
    }
    return { host: addr.address, port: addr.port };
  };

  return { start, stop, address };
}
