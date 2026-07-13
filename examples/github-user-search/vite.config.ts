import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The examples import Stoic by its published name ("stoic-store"), so the
// code is copy-pasteable into a real app. These aliases point the specifiers
// at this repository's `src/`, so library changes still show up immediately.
const lib = (path: string) => new URL(`../../src/${path}`, import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "stoic-store/react", replacement: lib("react.ts") },
      { find: "stoic-store/plugins", replacement: lib("plugins/index.ts") },
      { find: "stoic-store/tools", replacement: lib("tools/index.ts") },
      { find: "stoic-store", replacement: lib("index.ts") },
    ],
  },
});
