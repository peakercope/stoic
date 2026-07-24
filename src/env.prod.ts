/**
 * The production build's replacement for `./env`, substituted by an alias in
 * `tsdown.config.ts` and reached through the `production` export condition in
 * package.json.
 *
 * The real module resolves `DEV` from `process.env.NODE_ENV` behind a
 * `try/catch`, which no minifier can fold: it has to assume the read might
 * throw or return anything. Here `DEV` is a literal, so every `if (DEV)`
 * branch and the ~1 kB of warning text inside those branches folds away.
 *
 * Only the dev-gated diagnostics disappear. `persist`'s storage-failure
 * warnings are deliberately ungated and still ship — a quota error in
 * production is exactly what an app needs to see.
 */
export const DEV = false;

/** @internal Test-only, and a no-op here: the mode is a literal. */
export const refreshDevEnvForTests = (): void => {};
