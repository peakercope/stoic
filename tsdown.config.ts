import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "./src/index.ts",
    react: "./src/react.ts",
    plugins: "./src/plugins/index.ts",
    "plugins/persist": "./src/plugins/persist.ts",
    "plugins/devtools": "./src/plugins/devtools.ts",
    tools: "./src/tools/index.ts",
  },
  platform: "neutral",
  exports: true,
});
