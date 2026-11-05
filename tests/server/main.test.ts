// tests/server/main.test.ts
// Task 14: the server entry's env parsing.
//
// parseEnv is pure: it reads PORT and MODEL_MODE and returns either the config
// overrides or a plain error message. These cases cover the defaults, the demo
// mode, an invalid mode, and an invalid port. Nothing here starts a server or
// touches the file system.

import { describe, it, expect } from "vitest";
import { parseEnv, DEFAULT_PORT } from "../../src/server/main.js";

describe("parseEnv (Task 14)", () => {
  it("defaults to port 3000 and fake mode when nothing is set", () => {
    const result = parseEnv({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.overrides.port).toBe(DEFAULT_PORT);
    expect(result.overrides.port).toBe(3000);
    expect(result.overrides.modelMode).toBe("fake");
  });

  it("accepts demo mode", () => {
    const result = parseEnv({ MODEL_MODE: "demo" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.overrides.modelMode).toBe("demo");
    // Port still defaults when only the mode is set.
    expect(result.overrides.port).toBe(DEFAULT_PORT);
  });

  it("accepts an explicit valid port", () => {
    const result = parseEnv({ PORT: "8080", MODEL_MODE: "fake" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.overrides.port).toBe(8080);
    expect(result.overrides.modelMode).toBe("fake");
  });

  it("rejects an invalid model mode with a plain message", () => {
    const result = parseEnv({ MODEL_MODE: "real" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("MODEL_MODE");
    expect(result.error).toContain("real");
  });

  it("rejects a non-numeric port", () => {
    const result = parseEnv({ PORT: "80abc" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("PORT");
  });

  it("rejects a non-integer port", () => {
    const result = parseEnv({ PORT: "3000.5" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("PORT");
  });

  it("rejects port 0 (this entry binds a known port, not an ephemeral one)", () => {
    const result = parseEnv({ PORT: "0" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("PORT");
  });

  it("rejects a port above the valid range", () => {
    const result = parseEnv({ PORT: "70000" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("PORT");
  });
});
