// vite.config.ts
// Build config for the lab UI. The UI source lives under src/ui; the
// production bundle is written to dist/ui, which the server serves as static
// files. No framework plugin: the UI is plain TypeScript plus hand-drawn SVG.

import { defineConfig } from "vite";
import * as path from "node:path";

// The serve port the dev proxy forwards /api to. Matches DEFAULT_PORT in
// src/server/main.ts. Override with the PORT env var when `npm run serve` runs
// on a different port, so `npm run dev` and `npm run serve` line up.
const servePort = Number(process.env.PORT ?? "3000");

export default defineConfig({
  // The UI root. index.html and its entry script live here.
  root: path.resolve(__dirname, "src/ui"),
  build: {
    // Emit the bundle to dist/ui (resolved against this config's directory,
    // not the UI root).
    outDir: path.resolve(__dirname, "dist/ui"),
    emptyOutDir: true,
  },
  server: {
    // Forward API and SSE calls to the running server so `npm run dev` (the
    // vite dev UI) plus `npm run serve` (the API) works for UI development.
    // The server binds 127.0.0.1, so the proxy targets that host.
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${servePort}`,
        changeOrigin: false,
      },
    },
  },
});
