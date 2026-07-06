import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    index: "./src/index.ts",
    plugins: "./src/plugins/index.ts",
    tools: "./src/tools/index.ts",
  },
  platform: "neutral",
  sourcemap: true,
  exports: true,
});
