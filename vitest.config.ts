import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The Playwright end-to-end test lives under tests/e2e and is run by
    // Playwright, not Vitest. It uses *.spec.ts and its own config, so Vitest
    // must not pick it up. (Vitest has no browser or layout engine.)
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
    watch: false,
  },
});
