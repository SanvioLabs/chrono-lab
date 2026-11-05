// tests/ui/contrast.test.ts
// Task 11 (R-23): the palette contrast test, written before tokens.css holds
// any values.
//
// What it does: reads src/ui/theme/tokens.css, pulls the custom-property values
// out of the dark (default) block and the light block, and computes the WCAG
// contrast ratio for every token the UI relies on against both backgrounds
// (--bg and --surface). It then asserts:
//   - every text token's pairs are at least 4.5:1, and
//   - the --line and --focus pairs are at least 3:1 (the graphical-object
//     threshold for a meaning-carrying line and the focus ring), and
//   - every computed figure matches the palette table in design.md (to two
//     decimals), so a later token edit that shifts a ratio fails the build.
//
// Until tokens.css carries values, parseThemeBlocks finds no colours and the
// first assertion (that both blocks parsed) fails. The failure is on missing
// values, not a missing file: tokens.css exists as a placeholder.
//
// The ratio maths is WCAG 2.1: relative luminance from sRGB with the standard
// gamma expansion, then (L_lighter + 0.05) / (L_darker + 0.05). No browser and
// no layout engine are needed, so this is a plain Vitest unit test.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const tokensPath = fileURLToPath(
  new URL("../../src/ui/theme/tokens.css", import.meta.url)
);

// ---- the palette table from design.md, as the source of truth for figures ----
// Each token lists its expected measured contrast against --bg and --surface in
// each theme, to two decimals. Text tokens are held to 4.5:1; --line and
// --focus to 3:1. --bg and --surface are the background references and are not
// measured against themselves.

type ThemeName = "dark" | "light";
type Threshold = 4.5 | 3;

interface TokenExpectation {
  token: string;
  threshold: Threshold;
  // expected ratios: [against --bg, against --surface] per theme
  dark: [number, number];
  light: [number, number];
}

const EXPECTATIONS: TokenExpectation[] = [
  { token: "--ink", threshold: 4.5, dark: [16.0, 14.48], light: [16.09, 17.39] },
  { token: "--ink-dim", threshold: 4.5, dark: [7.74, 7.01], light: [5.81, 6.29] },
  { token: "--past", threshold: 4.5, dark: [7.22, 6.53], light: [4.51, 4.88] },
  { token: "--future", threshold: 4.5, dark: [10.57, 9.56], light: [5.24, 5.67] },
  { token: "--fork", threshold: 4.5, dark: [8.1, 7.33], light: [6.12, 6.62] },
  { token: "--diff", threshold: 4.5, dark: [6.88, 6.23], light: [5.49, 5.94] },
  { token: "--line", threshold: 3, dark: [3.86, 3.49], light: [3.47, 3.75] },
  { token: "--focus", threshold: 3, dark: [13.7, 12.4], light: [5.38, 5.81] },
  { token: "--danger", threshold: 4.5, dark: [6.88, 6.23], light: [5.49, 5.94] },
];

const BACKGROUND_TOKENS = ["--bg", "--surface"];

// ---- WCAG contrast maths ----

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  const digits = m?.[1];
  if (digits === undefined) {
    throw new Error(`not a 6-digit hex colour: "${hex}"`);
  }
  const n = parseInt(digits, 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function channelLuminance(c8: number): number {
  const c = c8 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---- parse the dark and light blocks out of tokens.css ----
//
// The dark set is the default, in `:root`. The light set is in a block the UI
// opts into; this parser accepts the two shapes Task 11 may use:
//   [data-theme="light"] { ... }   (an explicit switch), or
//   @media (prefers-color-scheme: light) { :root { ... } }
// Whichever carries the light values, the parser returns the colours keyed by
// token name. A block that defines none of the palette tokens is treated as not
// found, so the test fails clearly while tokens.css is still a placeholder.

function extractDeclarations(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    const name = m[1];
    const value = m[2];
    if (name === undefined || value === undefined) continue;
    out[name.trim()] = value.trim();
  }
  return out;
}

// Find the body of the first `:root { ... }` that is not inside a
// prefers-color-scheme: light media query. That is the dark (default) set.
function findDarkBlock(css: string): Record<string, string> {
  // Remove any prefers-color-scheme: light media block so its inner :root does
  // not get picked as the default.
  const withoutLightMedia = stripLightMedia(css);
  const m = /:root\s*\{([^}]*)\}/.exec(withoutLightMedia);
  const body = m?.[1];
  if (body === undefined) return {};
  return extractDeclarations(body);
}

function stripLightMedia(css: string): string {
  // Match @media (...light...) { ... } with one level of nested braces.
  const re =
    /@media[^{]*prefers-color-scheme:\s*light[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/gi;
  return css.replace(re, "");
}

function findLightBlock(css: string): Record<string, string> {
  // Shape 1: an explicit [data-theme="light"] selector.
  const sel = /\[data-theme=["']?light["']?\]\s*\{([^}]*)\}/.exec(css);
  const selBody = sel?.[1];
  if (selBody !== undefined) {
    const decls = extractDeclarations(selBody);
    if (hasPaletteTokens(decls)) return decls;
  }
  // Shape 2: @media (prefers-color-scheme: light) { :root { ... } }
  const media =
    /@media[^{]*prefers-color-scheme:\s*light[^{]*\{\s*:root\s*\{([^}]*)\}/i.exec(
      css
    );
  const mediaBody = media?.[1];
  if (mediaBody !== undefined) {
    const decls = extractDeclarations(mediaBody);
    if (hasPaletteTokens(decls)) return decls;
  }
  return {};
}

function hasPaletteTokens(decls: Record<string, string>): boolean {
  return (
    decls["--bg"] !== undefined &&
    decls["--surface"] !== undefined &&
    decls["--ink"] !== undefined
  );
}

const css = readFileSync(tokensPath, "utf8");
const themes: Record<ThemeName, Record<string, string>> = {
  dark: findDarkBlock(css),
  light: findLightBlock(css),
};

// Read a token's value, throwing a clear message when it is missing. The throw
// surfaces as a failing test (on a missing value, not a missing file) while
// tokens.css is still the placeholder. With noUncheckedIndexedAccess on, this
// also narrows the value from `string | undefined` to `string`.
function requireToken(theme: ThemeName, token: string): string {
  const value = themes[theme][token];
  if (value === undefined) {
    throw new Error(
      `${token} is not defined in the ${theme} block of tokens.css`
    );
  }
  return value;
}

describe("palette contrast (R-23): tokens.css carries both theme blocks", () => {
  it("parses a dark (default) block with the palette tokens", () => {
    expect(
      hasPaletteTokens(themes.dark),
      "tokens.css must define --bg, --surface, --ink and the rest in :root (dark default)"
    ).toBe(true);
  });

  it("parses a light block with the palette tokens", () => {
    expect(
      hasPaletteTokens(themes.light),
      'tokens.css must define a light set via [data-theme="light"] or a prefers-color-scheme: light media block'
    ).toBe(true);
  });

  it("defines every token the UI relies on in both themes", () => {
    const needed = [...BACKGROUND_TOKENS, ...EXPECTATIONS.map((e) => e.token)];
    for (const theme of ["dark", "light"] as ThemeName[]) {
      for (const token of needed) {
        expect(
          themes[theme][token],
          `${token} missing from the ${theme} block`
        ).toBeDefined();
      }
    }
  });
});

describe("palette contrast (R-23): every token clears its threshold against both backgrounds", () => {
  for (const theme of ["dark", "light"] as ThemeName[]) {
    for (const exp of EXPECTATIONS) {
      it(`${theme}: ${exp.token} meets ${exp.threshold}:1 on --bg and --surface`, () => {
        const value = requireToken(theme, exp.token);
        const bg = requireToken(theme, "--bg");
        const surface = requireToken(theme, "--surface");

        const onBg = contrastRatio(value, bg);
        const onSurface = contrastRatio(value, surface);

        expect(
          onBg,
          `${theme} ${exp.token} on --bg is ${round2(onBg)}:1, below ${exp.threshold}:1`
        ).toBeGreaterThanOrEqual(exp.threshold);
        expect(
          onSurface,
          `${theme} ${exp.token} on --surface is ${round2(onSurface)}:1, below ${exp.threshold}:1`
        ).toBeGreaterThanOrEqual(exp.threshold);
      });
    }
  }
});

describe("palette contrast (R-23): computed figures match the design.md table", () => {
  for (const theme of ["dark", "light"] as ThemeName[]) {
    for (const exp of EXPECTATIONS) {
      it(`${theme}: ${exp.token} measures the figures the table records`, () => {
        const value = requireToken(theme, exp.token);
        const bg = requireToken(theme, "--bg");
        const surface = requireToken(theme, "--surface");
        const onBg = round2(contrastRatio(value, bg));
        const onSurface = round2(contrastRatio(value, surface));
        const [expBg, expSurface] = exp[theme];
        expect(
          onBg,
          `${theme} ${exp.token} on --bg: table says ${expBg}, measured ${onBg}`
        ).toBeCloseTo(expBg, 2);
        expect(
          onSurface,
          `${theme} ${exp.token} on --surface: table says ${expSurface}, measured ${onSurface}`
        ).toBeCloseTo(expSurface, 2);
      });
    }
  }
});
