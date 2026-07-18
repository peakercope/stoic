import { beforeEach } from "vitest";
import { resetDevEnvCacheForTests } from "./src/env";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// isDevEnv() memoizes the mode on first use; tests that stub NODE_ENV rely on
// the next store/plugin observing the stub, so clear the cache between tests.
beforeEach(() => {
  resetDevEnvCacheForTests();
});
