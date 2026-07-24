import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

// Absolute: an alias target is resolved relative to the *importer*, so a
// relative one would look for `src/src/env.prod.ts` from `src/stoic.ts`.
const envProd = fileURLToPath(new URL("./src/env.prod.ts", import.meta.url));

const entry = {
  index: "./src/index.ts",
  react: "./src/react.ts",
  plugins: "./src/plugins/index.ts",
  "plugins/persist": "./src/plugins/persist.ts",
  "plugins/devtools": "./src/plugins/devtools.ts",
  tools: "./src/tools/index.ts",
};

// Published subpath → entry name, used to rewrite the generated `exports` map
// into one with a `production` condition per entry.
const subpaths: Record<string, string> = {
  ".": "index",
  "./react": "react",
  "./plugins": "plugins",
  "./plugins/persist": "plugins/persist",
  "./plugins/devtools": "plugins/devtools",
  "./tools": "tools",
};

export default defineConfig([
  // Development build — the default, and what any resolver that doesn't
  // understand the `production` condition gets. Keeps the warnings.
  {
    entry,
    platform: "neutral",
    exports: {
      customExports(exports) {
        for (const [subpath, name] of Object.entries(subpaths)) {
          exports[subpath] = {
            types: `./dist/${name}.d.ts`,
            production: `./dist/prod/${name}.js`,
            default: `./dist/${name}.js`,
          };
        }
        return exports;
      },
    },
  },
  // Production build — the same sources with `./env` aliased to a module whose
  // `isDevEnv()` is a literal `false`, so every dev-only branch and the message
  // it carries folds away. Minified here rather than left to the consumer, the
  // way React ships a pre-built `.production.js`: it makes the strip verifiable
  // in the published artifact instead of dependent on the app's toolchain.
  {
    entry,
    platform: "neutral",
    outDir: "./dist/prod",
    alias: { "./env": envProd, "../env": envProd },
    minify: true,
    dts: false,
    exports: false,
  },
]);
