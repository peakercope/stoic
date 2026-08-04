import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text"],
      // Without an explicit `include`, v8 only reports files some test already
      // imported — so a new, entirely untested module would not appear at all
      // and the percentages would be unmoved. Naming the sources makes an
      // untested file drag the number down, which is the whole point.
      include: ["src/**"],
      // `env.prod.ts` is a build-time alias target that no test ever loads, and
      // the barrels are re-exports with nothing to execute.
      exclude: ["src/**/*.test.*", "src/**/*.test-d.ts", "src/env.prod.ts", "src/**/index.ts"],
      // Set just under the current numbers: a floor that ratchets, not a
      // tripwire that fails the next commit for rounding. Raise them when the
      // real figures move up — don't lower them to make a build pass.
      thresholds: {
        statements: 95,
        branches: 90,
        functions: 98,
        lines: 96,
      },
    },
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    typecheck: {
      enabled: true,
    },
  },
});
