# stoic

## 0.6.0

### Minor Changes

- 414cf1c: Devtools action payloads: entries in the Redux DevTools log now carry the arguments their action was invoked with (`{ type: "addItem", args: ["a1", 2] }`), so calls to the same action are distinguishable in the timeline. A direct `store.setState` still logs as `"anonymous"` with no `args`.

  The `afterSetState` plugin hook gains a third parameter, `actionArgs`, attributed per-write like `actionName` — so it stays correct across `await`s, overlapping async actions, and batches. This is additive; existing plugins are unaffected.

## 0.5.0

### Minor Changes

- c9829b3: Pre-1.0 API hardening.

  **New:**

  - **Actions now receive a `{ set, get }` context** as their first argument instead of a bare `setState` function: `addItem: ({ set, get }, item) => …`. `get()` returns the current state (including derived values), making read-then-write flows and stale-async guards natural.
  - `StoicPlugin.afterSetState` now receives the attributing action name as a second argument: `afterSetState(state, actionName?)`. The name is correct across `await`s and overlapping async actions; direct `setState` calls pass `undefined`.
  - `createStoreContext(factory)` builds a React Context around a store factory, so each mounted `Provider` owns an independent store — for server rendering (a module-level store is shared across requests and can leak one user's state into another's render), per-widget state, and test isolation. Returns `{ Provider, useStore, useActions, useStoreApi }`; the store is destroyed on unmount (StrictMode-safe).
  - `persist` supports `version` + `migrate` for schema migrations; payloads are written as a `{ version, state }` envelope when `version` is set, and pre-versioning payloads are treated as version 0.
  - Exported types: `StoicStore`, `SetState`, `ActionCtx`, `ActionHandle`.
  - Re-entrant updates from plugins/subscribers warn in development and throw before overflowing the stack.

  **Fixed:**

  - State keys shadowing `Object.prototype` members (e.g. `toString`) can now be set; they were previously silently ignored.
  - Redux DevTools entries for async actions are now attributed correctly, including writes after `await` and overlapping actions.
  - Derived values read from an older snapshot no longer thrash the memoization cache; each snapshot's values are cached independently (per-snapshot WeakMap).

## 0.4.3

### Patch Changes

- 27f00c8: Fix several correctness edge cases:

  - Overlapping calls to the same async action no longer resolve `ActionMeta` prematurely — status now stays `"pending"` until the last in-flight call settles.
  - The functional form of `setState` now sees up-to-date derived values instead of a stale snapshot when called while the store is unobserved.
  - A derived function that throws no longer permanently stops later recomputation of the keys it would have marked dirty; the next state change retries it.
  - `batch()` no longer notifies listeners or runs `afterSetState` hooks when nothing inside the batch actually changed state.
  - `persist`'s `include` option no longer overwrites initial-state defaults with `undefined` when rehydrating a payload written before that key existed.
  - `persist` rehydration no longer merges keys from a stale stored payload that are no longer part of the store's state.
  - The devtools plugin no longer re-enables recording as a side effect of a time-travel jump while recording is paused.

  Also tightened the derived-state engine's internals (fewer allocations per recompute, cycle detection skipped when the dependency graph is unchanged) and `useStore` (selector no longer runs on every render just to seed a ref) — no behavior change.

## 0.4.2

### Patch Changes

- 44e1351: `persist` no longer writes derived values to storage, and ignores derived keys found in existing stored data on rehydration.

  Derived values are always recomputed from raw state, so persisting them was at best wasted bytes and at worst a stale-value bug: on rehydration a persisted derived value was merged straight into state, and because derived keys are only recomputed when one of their _dependencies_ changes, a stale value survived untouched whenever the raw state it depended on was unchanged. Shipping a new version of a derived function meant users kept seeing values computed by the old one.

  Existing stored payloads self-heal — derived keys in them are now dropped on load rather than restored.

  Two things to know when upgrading:

  - Naming a derived key in `include` now throws at store creation, rather than silently persisting a value that can't be meaningfully restored.
  - A derived function with no raw-state dependencies (e.g. `sessionId: () => uuid()`) was previously restored from storage and will now be regenerated on each load. Such a value isn't derived state — move it to `state` to keep persisting it.

## 0.4.1

### Patch Changes

- 3ce7124: Fix `useStore` returning an uncached server snapshot. Object-literal selectors previously produced a fresh reference on every `getServerSnapshot` call, which made React bail out during hydration with "The result of getServerSnapshot should be cached to avoid an infinite loop". Both snapshot functions now share the same equality-checked cached read.

## 0.4.0

### Minor Changes

- d0d7fe6: Add `batch` to `stoic-store/tools`: coalesce a sequence of sync or async `setState`/action calls into a single derived recompute and a single listener notification.

## 0.3.0

### Minor Changes

- 0ef91d4: Add devtools plugin

## 0.2.0

### Minor Changes

- 7bdece6: Add lazy/mount-aware derived recomputation

## 0.1.1

### Patch Changes

- 445e807: Update peer dependencies

## 0.1.0

### Minor Changes

- 84e6c94: Flatten the repo from a yarn-workspaces monorepo into a single package: removed the `playground` dev sandbox and moved `stoic-store`'s source, config, and changelog from `packages/stoic` to the repo root. No changes to the published API or behavior.

## 0.0.2

### Patch Changes

- b0f4670: Verify npm trusted publishing and release automation after configuring the trusted publisher.

## 0.0.1

### Patch Changes

- bb7f7a8: Set up npm publish and GitHub release automation via changesets.
