import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The examples import Stoic by its published name ("stoic-store"), so the code is copy-pasteable into a real app.
const lib = (path: string) => new URL(`../../dist/prod/${path}`, import.meta.url).pathname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "stoic-store/react", replacement: lib("react.js") },
      { find: "stoic-store/plugins", replacement: lib("plugins.js") },
      { find: "stoic-store/tools", replacement: lib("tools.js") },
      { find: "stoic-store", replacement: lib("index.js") },
    ],
  },
});
