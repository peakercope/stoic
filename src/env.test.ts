import { afterEach, describe, expect, it, vi } from "vitest";
import * as env from "./env";

// Imported as a namespace, not a named binding: `DEV` is a live binding that
// `refreshDevEnvForTests` reassigns, and reading it through the namespace is
// what observes the update.
describe("DEV", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    env.refreshDevEnvForTests();
  });

  it("is true outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    env.refreshDevEnvForTests();
    expect(env.DEV).toBe(true);
  });

  it("is false in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    env.refreshDevEnvForTests();
    expect(env.DEV).toBe(false);
  });

  it("defaults to dev behavior when no `process` exists (bare browser ESM)", () => {
    vi.stubGlobal("process", undefined);
    env.refreshDevEnvForTests();
    expect(env.DEV).toBe(true);
  });
});
