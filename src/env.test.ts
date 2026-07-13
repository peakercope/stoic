import { afterEach, describe, expect, it, vi } from "vitest";
import { isDevEnv } from "./env";

describe("isDevEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is true outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isDevEnv()).toBe(true);
  });

  it("is false in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isDevEnv()).toBe(false);
  });

  it("defaults to dev behavior when no `process` exists (bare browser ESM)", () => {
    vi.stubGlobal("process", undefined);
    expect(isDevEnv()).toBe(true);
  });
});
