# CLAUDE.md

## Project overview

Stoic (`stoic-store`) is a tiny React state manager built on `useSyncExternalStore`, with
reactive derived state and automatic dependency tracking. It is a published library: every
byte shipped and every type inferred by a consumer's editor is part of the product.

## Core design principles

- Performance first, but never on faith — every optimization must be benchmarked.
- Small bundle size is a feature. Weigh bundle cost alongside runtime cost.
- Simplicity over clever abstractions. Prefer deleting code over adding code.
- Minimal API surface. New public API needs a much stronger case than new internal code.
- Predictable behaviour beats magic. No surprising implicit state or ordering.
- Zero runtime dependencies. Do not add one unless it is genuinely unavoidable.
- Plugins live outside the core. If a feature can be a plugin (`src/plugins/`), it must be.
- Question existing architecture instead of preserving it blindly — but change it with
  benchmarks and tests, not intuition.

## Commands (Yarn 4 — always `yarn`, never npm/pnpm)

- `yarn test` — Vitest (unit tests + `*.test-d.ts` type tests)
- `yarn typecheck` — `tsc --noEmit` plus example typechecking
- `yarn lint` / `yarn format` — Biome (2-space indent, double quotes, 100-col lines)
- `yarn bench` — builds, then runs `scripts/bench.mjs` against `dist/`
- `yarn build` — tsdown; dev build in `dist/`, minified prod build in `dist/prod/`

## Coding style and conventions

- Match the existing style in `src/stoic.ts`; Biome enforces formatting — don't fight it.
- Comments explain *why* (invariants, non-obvious constraints), never *what*.
- Dev-only warnings go behind `isDevEnv()` from `src/env.ts`. The prod build aliases it to
  a literal `false` so those branches fold away — keep dev-only code shaped so it strips.
- Public entry points are fixed: `index`, `react`, `plugins`, `plugins/persist`,
  `plugins/devtools`, `tools`. Adding one requires updating `tsdown.config.ts` and
  `package.json#exports` together.

## Performance philosophy

- Never assume an optimization helps — measure it. Micro-optimizations that don't show up
  in `yarn bench` are complexity, not wins; revert them.
- Avoid allocations in hot paths (set/notify/derived recompute/subscription dispatch).
  Object spreads, closures, and array methods created per-update are suspect there.
- Cold paths (store creation, plugin setup) may favor clarity over speed.
- A perf win that grows the bundle or complicates the code needs to justify both costs.

## Benchmarking expectations

- Any change touching `src/stoic.ts` hot paths must be benchmarked before and after.
- Benchmarks compare `dist/` builds: run `yarn bench -- --save base.json` on the baseline,
  apply the change, rebuild, then `yarn bench -- --base base.json`.
- Compare only within the same session — run-to-run noise is ±5–12%, so a stale saved
  baseline file will mislead. Re-save the baseline if any time has passed.
- Treat small deltas (<5%) as noise unless reproducible across repeated runs.

## API philosophy

- The API is the whole product: prefer one obvious way to do something.
- Actions are plain functions; derived state is declared, not computed in components.
  New features must fit these idioms rather than introduce parallel mechanisms.
- Everything must remain tree-shakeable: `sideEffects: false` is declared — no module-level
  side effects, no top-level mutation, keep entry points independent.
- Breaking changes go through changesets (`yarn changeset`); user-facing changes need one.

## TypeScript rules

- Config extends `@tsconfig/strictest` — keep it passing with no suppressions.
  `any`, `as` casts, and `@ts-expect-error` in `src/` need a comment justifying them.
- Excellent inference is a core feature: consumers should never write type annotations
  that Stoic can infer (state, action arguments, derived values).
- Public type changes must be covered in `src/types.test-d.ts`. If you change generics or
  overloads, add a type test showing inference still works from the consumer's side.
- Complex internal types are acceptable only when they buy simpler *external* types.

## Testing expectations

- Every behaviour change needs a test in the co-located `*.test.tsx` files; run the full
  `yarn test` suite, not just the file you touched.
- Test through the public API (`createStore`, `useStore`, plugins), not internals.
- Rerender-count assertions matter here: "only subscribers of changed derived values
  rerender" is the core promise — test it when touching subscription or dirty-tracking.
- Type-level behaviour is tested in `*.test-d.ts`; runtime tests don't cover it.

## What NOT to do

- Don't add runtime dependencies.
- Don't add features to the core that could be plugins, or plugins nobody asked for.
- Don't ship an optimization without a same-session A/B benchmark showing it helps.
- Don't widen the public API to make an internal problem easier.
- Don't weaken TypeScript strictness or inference to save implementation effort.
- Don't add module-level side effects or anything that breaks tree-shaking.
- Don't edit `dist/` — it is build output.
- Don't "improve" code you weren't asked to touch; keep diffs minimal and focused.
