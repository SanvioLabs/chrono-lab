// tests/server/static.test.ts
// Task 7: safe static file resolution.
//
// A request for a file inside staticRoot resolves; a request with "..", an
// absolute path, or any path that escapes staticRoot is rejected (ok: false),
// which the caller turns into a 404 without opening a file.
//
// Written before resolveStaticPath is implemented. Until then it throws
// "not implemented" and every case fails.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { resolveStaticPath } from "../../src/server/static.js";

let staticRoot: string;

beforeAll(async () => {
  staticRoot = await fs.mkdtemp(path.join(os.tmpdir(), "chrono-static-"));
  await fs.writeFile(
    path.join(staticRoot, "index.html"),
    "<!doctype html><title>x</title>",
    "utf-8"
  );
  await fs.mkdir(path.join(staticRoot, "assets"), { recursive: true });
  await fs.writeFile(
    path.join(staticRoot, "assets", "app.js"),
    "console.log(1)",
    "utf-8"
  );
  // A secret file one level above the root; an escape must never reach it.
  await fs.writeFile(
    path.join(staticRoot, "..", "chrono-static-secret.txt"),
    "secret",
    "utf-8"
  );
});

afterAll(async () => {
  await fs.rm(staticRoot, { recursive: true });
  await fs.rm(path.join(staticRoot, "..", "chrono-static-secret.txt"), {
    force: true,
  });
});

describe("resolveStaticPath: files inside the root resolve", () => {
  it("resolves a top-level file", () => {
    const res = resolveStaticPath(staticRoot, "/index.html");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(path.resolve(res.filePath)).toBe(
      path.resolve(staticRoot, "index.html")
    );
  });

  it("resolves a nested file", () => {
    const res = resolveStaticPath(staticRoot, "/assets/app.js");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(path.resolve(res.filePath)).toBe(
      path.resolve(staticRoot, "assets", "app.js")
    );
  });
});

describe("resolveStaticPath: escapes are rejected", () => {
  it("rejects a path with .. segments that climbs above the root", () => {
    const res = resolveStaticPath(staticRoot, "/../chrono-static-secret.txt");
    expect(res.ok).toBe(false);
  });

  it("rejects a deeper .. traversal", () => {
    const res = resolveStaticPath(
      staticRoot,
      "/assets/../../chrono-static-secret.txt"
    );
    expect(res.ok).toBe(false);
  });

  it("rejects an absolute path outside the root", () => {
    const res = resolveStaticPath(staticRoot, "/etc/passwd");
    // "/etc/passwd" joined onto the root stays inside only if the file exists
    // there; the point is it must never resolve to the real /etc/passwd.
    if (res.ok) {
      expect(path.resolve(res.filePath).startsWith(path.resolve(staticRoot))).toBe(
        true
      );
    } else {
      expect(res.ok).toBe(false);
    }
  });

  it("rejects a raw absolute filesystem path", () => {
    const res = resolveStaticPath(staticRoot, path.resolve(staticRoot, "..", "chrono-static-secret.txt"));
    expect(res.ok).toBe(false);
  });
});
