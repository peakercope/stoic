/**
 * True outside production builds.
 *
 * The check is written as the literal `process.env.NODE_ENV` expression on
 * purpose: bundlers (Vite, esbuild, webpack) statically replace exactly that
 * token, which turns the comparison into a constant and lets minifiers strip
 * dev-only branches from production bundles. Do NOT refactor this into an
 * indirect access such as `globalThis.process?.env?.NODE_ENV` — replacement
 * is textual, an indirection is never rewritten, and since browsers have no
 * `process` global the check would then report "dev" in every production
 * browser bundle (shipping warnings and enabling devtools in production).
 *
 * When neither a bundler nor a Node-style `process` exists (bare browser
 * ESM), the read throws and we fall back to dev behavior, matching what such
 * unbundled setups have always seen.
 */
// tsconfig sets `types: []`, so Node's globals aren't declared; this keeps the
// literal token visible to the type checker without pulling in @types/node.
declare const process: { env: { NODE_ENV?: string } };

export const isDevEnv = (): boolean => {
  try {
    return process.env.NODE_ENV !== "production";
  } catch {
    return true;
  }
};
