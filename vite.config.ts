// vite.config.ts
// Build config for the lab UI. The UI source lives under src/ui; the
// production bundle is written to dist/ui, which the server serves as static
// files. No framework plugin: the UI is plain TypeScript plus hand-drawn SVG.

import { defineConfig } from "vite";
import * as path from "node:path";

export default defineConfig({
  // The UI root. index.html and its entry script live here.
  root: path.resolve(__dirname, "src/ui"),
  build: {
    // Emit the bundle to dist/ui (resolved against this config's directory,
    // not the UI root).
    outDir: path.resolve(__dirname, "dist/ui"),
    emptyOutDir: true,
  },
});
