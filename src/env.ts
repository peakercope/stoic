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
 *
 * This is a binding rather than the `isDevEnv()` function it replaces because
 * `if (DEV)` is the only shape a minifier can fold: no minifier inlines a call
 * to `() => false`, so the old form left every dev-only branch *and its
 * message* in production bundles. The published `production` export condition
 * resolves `./env.prod` in this module's place, where `DEV` is a literal
 * `false` and the branches below it disappear. Reading the mode once at module
 * init also drops a call — and a closure slot — from every `createStore`.
 */
// tsconfig sets `types: []`, so Node's globals aren't declared; this keeps the
// literal token visible to the type checker without pulling in @types/node.
declare const process: { env: { NODE_ENV?: string } };

// Read once: the `process.env` read goes through Node's env interceptor and
// costs ~130ns, which used to be a dominant share of store creation.
const read = (): boolean => {
  try {
    return process.env.NODE_ENV !== "production";
  } catch {
    return true;
  }
};

// `let` so the test helper can re-read the mode; importers observe the update
// through the ESM live binding. Never reassigned outside tests.
export let DEV = read();

/**
 * @internal Test-only: re-reads `process.env.NODE_ENV`. Call it *after*
 * stubbing the variable — the mode is resolved once at module init.
 */
export const refreshDevEnvForTests = (): void => {
  DEV = read();
};
