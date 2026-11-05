// src/server/static.ts
// Safe static file serving.
//
// Resolves a requested URL path to a file by stripping leading slashes (so the
// path is read as root-relative), joining it onto staticRoot, resolving the
// absolute path, and checking the result is still inside staticRoot. Any path
// that escapes ("..", an absolute path pointing out of the root, a symlink
// target outside the root) is rejected before the file is served. Only files
// that exist under dist/ui are ever served.

import * as fs from "node:fs";
import * as path from "node:path";

// The outcome of resolving a requested path against the static root.
export type StaticResolution =
  // The path is safe and resolves to a file inside the root.
  | { ok: true; filePath: string }
  // The path escapes the root (or is otherwise unsafe); serve a 404.
  | { ok: false };

// Returns true when candidate resolves to a path inside root (or root itself).
function isInside(root: string, candidate: string): boolean {
  if (candidate === root) {
    return true;
  }
  return candidate.startsWith(root + path.sep);
}

// realpathSync the path when it exists, else return the resolved path as given.
// Used so the symlink check compares like with like (both real paths), which
// matters where the temp root itself sits under a symlink (e.g. macOS /var).
function realOrSelf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

// Resolves urlPath inside staticRoot. Returns { ok: false } for any path that
// escapes the root or does not resolve to an existing file; the caller serves a
// 404 without opening the file.
export function resolveStaticPath(
  staticRoot: string,
  urlPath: string
): StaticResolution {
  const resolvedRoot = path.resolve(staticRoot);

  // Decode percent-escapes, drop a query string, and read the path as
  // root-relative by stripping leading slashes. Stripping the leading slash is
  // what keeps an absolute-looking request (e.g. "/etc/passwd") from resetting
  // the resolve to the real filesystem root.
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0] ?? "");
  } catch {
    return { ok: false };
  }
  const relative = decoded.replace(/^[/\\]+/, "");

  const resolved = path.resolve(resolvedRoot, relative);

  // Containment check: the resolved path must stay inside the root. A ".."
  // traversal resolves outside and is rejected here.
  if (!isInside(resolvedRoot, resolved)) {
    return { ok: false };
  }

  // The path must point at an existing regular file. A missing path or a
  // directory is a 404; stat does not open the file.
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { ok: false };
  }
  if (!stat.isFile()) {
    return { ok: false };
  }

  // Defend against a symlink whose real target escapes the root. Compare real
  // paths on both sides so a symlinked root (macOS /var -> /private/var) does
  // not trip the check.
  const realRoot = realOrSelf(resolvedRoot);
  const realFile = realOrSelf(resolved);
  if (!isInside(realRoot, realFile)) {
    return { ok: false };
  }

  return { ok: true, filePath: resolved };
}
