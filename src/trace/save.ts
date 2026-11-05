// src/trace/save.ts
// Save, load, and scrub for trace files.

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Trace } from "./types.js";
import { KNOWN_VERSIONS, TraceVersionError, migrateTrace } from "./version.js";

// The three API key patterns to redact.
// Generic 32-character hex is intentionally excluded: step ids and runIds are
// hex-like and must not be corrupted.
const KEY_PATTERNS: RegExp[] = [
  // Anthropic-specific prefix (checked before the generic sk- pattern)
  /sk-ant-[A-Za-z0-9_\-]{20,}/g,
  // OpenAI and generic bearer tokens
  /sk-[A-Za-z0-9_\-]{20,}/g,
  // AWS-style access key
  /AKIA[0-9A-Z]{16}/g,
];

// Replace every matching substring with "[REDACTED]".
export function scrubString(s: string): string {
  let result = s;
  for (const pattern of KEY_PATTERNS) {
    // Reset lastIndex because we reuse compiled patterns.
    pattern.lastIndex = 0;
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

// Walk every value in an object tree and apply scrubString to all strings.
// Returns a deep clone with all keys preserved.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scrubValue(value: unknown): unknown {
  if (typeof value === "string") {
    return scrubString(value);
  }
  if (Array.isArray(value)) {
    return value.map(scrubValue);
  }
  if (value !== null && typeof value === "object") {
    // Cast is necessary: we are walking an arbitrary JSON tree.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      result[key] = scrubValue(obj[key]);
    }
    return result;
  }
  return value;
}

// Deep-clone the trace and replace all API key patterns in string values.
export function scrubTrace(trace: Trace): Trace {
  return scrubValue(trace) as Trace;
}

// Serialise a (scrubbed) trace to JSON with two-space indentation.
// Serialisation is deterministic: JSON.stringify with the same input always
// produces the same bytes.
function serialise(trace: Trace): string {
  return JSON.stringify(trace, null, 2);
}

// Write trace to disk atomically: scrub, write to <path>.tmp, rename.
export async function saveTrace(
  trace: Trace,
  filePath: string
): Promise<void> {
  const scrubbed = scrubTrace(trace);
  const json = serialise(scrubbed);
  const tmpPath = `${filePath}.tmp`;

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tmpPath, json, "utf-8");
  await fs.rename(tmpPath, filePath);
}

// Load a trace from disk. Throws TraceVersionError for unknown versions.
export async function loadTrace(filePath: string): Promise<Trace> {
  const raw = await fs.readFile(filePath, "utf-8");
  // JSON.parse result is unknown; we verify version before trusting it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parsed = JSON.parse(raw) as { version?: unknown; [key: string]: unknown };

  const version = parsed["version"];
  if (typeof version !== "string" || !KNOWN_VERSIONS.includes(version)) {
    throw new TraceVersionError(typeof version === "string" ? version : String(version));
  }

  // Run the migration chain (no-op for 1.0.0).
  return migrateTrace(parsed, version);
}
