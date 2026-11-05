// tests/trace/scrub.test.ts
// Unit tests for scrubString and saveTrace/loadTrace error paths.

import { describe, it, expect } from "vitest";
import { scrubString } from "../../src/trace/save.js";
import { loadTrace, saveTrace } from "../../src/trace/save.js";
import { TraceVersionError } from "../../src/trace/version.js";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import type { Trace } from "../../src/trace/types.js";

describe("scrubString", () => {
  it("redacts an OpenAI-style sk- token", () => {
    const input = "Bearer sk-abcdefghijklmnopqrstuvwxyz1234";
    expect(scrubString(input)).toBe("Bearer [REDACTED]");
  });

  it("redacts an Anthropic sk-ant- token", () => {
    const input = "key: sk-ant-abcdefghijklmnopqrstuvwxyz";
    expect(scrubString(input)).toBe("key: [REDACTED]");
  });

  it("redacts an AWS AKIA access key", () => {
    const input = "AKIAIOSFODNN7EXAMPLE";
    expect(scrubString(input)).toBe("[REDACTED]");
  });

  it("does not redact a safe plain string", () => {
    expect(scrubString("hello world")).toBe("hello world");
  });

  it("does not redact a step id like a1b2c3d4-0", () => {
    expect(scrubString("a1b2c3d4-0")).toBe("a1b2c3d4-0");
  });

  it("does not redact a UUID-style runId", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(scrubString(id)).toBe(id);
  });

  it("does not redact a short hex string that looks like an id", () => {
    // 32 hex chars, no sk- prefix, no AKIA prefix
    const id = "deadbeefdeadbeefdeadbeefdeadbeef";
    expect(scrubString(id)).toBe(id);
  });
});

describe("loadTrace", () => {
  it("throws TraceVersionError for an unrecognised version", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-ver-"));
    const filePath = path.join(tmpDir, "bad-version.json");

    const badTrace: Trace = {
      version: "99.0.0",
      runId: "abc123",
      createdAt: new Date(0).toISOString(),
      steps: [],
    };
    await fs.writeFile(filePath, JSON.stringify(badTrace), "utf-8");

    await expect(loadTrace(filePath)).rejects.toThrow(TraceVersionError);
    await expect(loadTrace(filePath)).rejects.toThrow("99.0.0");

    await fs.rm(tmpDir, { recursive: true });
  });

  it("saves and loads an empty trace without error", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-save-"));
    const filePath = path.join(tmpDir, "empty.json");

    // Use the current version so loadTrace returns it unchanged (no migration).
    const trace: Trace = {
      version: "1.1.0",
      runId: "abc123",
      createdAt: new Date(0).toISOString(),
      steps: [],
    };
    await saveTrace(trace, filePath);
    const loaded = await loadTrace(filePath);
    expect(loaded).toEqual(trace);

    await fs.rm(tmpDir, { recursive: true });
  });
});
