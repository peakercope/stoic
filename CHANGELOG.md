# stoic

## 0.11.1

### Patch Changes

- 436eb1b: Stale ctx.signal fix, plugin hooks fire after onDestroy, docs updated

## 0.11.0

### Minor Changes

- 1368f42: Rename `ActionContext` to `ActionEvent`, self-memoizing snapshots, and persist/react fixes.

  **Core:**

  - `ActionContext` type is renamed to `ActionEvent` — plugin `beforeAction`/`afterAction` hooks now receive an `ActionEvent`. `afterAction` is no longer called for actions that settle after the store was destroyed.
  - Derived snapshot getters now self-memoize: on first read the getter is replaced with a plain data property on that snapshot, so repeat reads are plain property accesses.
  - Eager cycle detection for derived config now runs in dev only; in production derived values stay lazy and a cycle still throws on first read.
  - Dev-only warnings and the duplicate-action-name registry are now fully gated behind the dev-env check, so production skips the bookkeeping.

  **Persist plugin:**

  - Fixed debounced writes clobbering newer state applied by `sync` or `rehydrate()` while the timer was pending — the write now reads the store's state at fire time.
  - Fixed versioned envelopes with a custom `serialize`/`deserialize` codec: the embedded state is now decoded with the custom codec instead of being misparsed.
  - A state coalesced behind an in-flight async write is no longer dropped on `destroy`.

  **React:**

  - `createStoreContext`'s provider pins `init` to its first-render value, so an unstable inline `init` prop no longer re-runs the teardown effect on every render.

  **Packaging:** new subpath exports `stoic-store/plugins/persist` and `stoic-store/plugins/devtools`.

## 0.10.0

### Minor Changes

- 3d26dc5: Actions receive an `AbortSignal` as `ctx.signal`, aborted when a newer call of the same action starts or when the store is destroyed. Pass it to `fetch` to cancel superseded requests. The signal is created lazily, so actions that never read it are unaffected.

## 0.9.0

### Minor Changes

- e987f8d: `persist` now stores state through a `driver` instead of a hard-wired web `Storage`, and can sync across tabs.

  A driver is `getItem`/`setItem`, with return types widened to allow promises — so web `Storage` and React Native's `AsyncStorage` both satisfy it directly, with no adapter: `persist({ key, driver: AsyncStorage })`. IndexedDB, MMKV, SQLite or an encrypted store is an object with those two methods. Synchronous drivers stay synchronous, so the default `localStorage` still hydrates before the first render. Async drivers hydrate a tick later; the new `onHydrate` option fires once the read settles so a splash screen can wait on it, concurrent writes coalesce to the newest state, and a write made while the initial read is in flight is no longer clobbered by the stored payload.

  `sync: true` applies state written by another tab, via a driver's optional `subscribe` (the default `localStorage` driver implements it with the `storage` event). Applying a synced payload doesn't re-persist it, so tabs can't write back and forth at each other.

  **Breaking:** the `storage` option is replaced by `driver`. It took a thunk returning a `Storage`; `driver` takes the storage itself.

  ```diff
  - persist({ key: "settings", storage: () => sessionStorage })
  + persist({ key: "settings", driver: sessionStorage })
  ```

## 0.8.1

### Patch Changes

- 40fb6d9: `persist` throws when given only one of `serialize`/`deserialize`. Previously the mismatch misbehaved silently: with `version` set, a custom `deserialize` without a custom `serialize` was never called (the envelope's state round-trips as a plain JSON value), and a custom `serialize` without `deserialize` fed its opaque string to `JSON.parse`. Pass both or neither.

## 0.8.0

### Minor Changes

- 26a2138: React hooks move to `stoic-store/react`, production-build fixes, and persist SSR support.

  **Breaking:**

  - **React hooks now live in the `stoic-store/react` entry.** The core entry is React-free, so store modules can be imported from React Server Components (for `getState()` or actions) without pulling client-side React in.
    - `store.useStore(selector?, equality?)` → `useStore(store, selector?, equality?)` from `stoic-store/react`.
    - `action.useMeta()` → `useActionMeta(action)` from `stoic-store/react`.
    - `createStoreContext` moved from `stoic-store` to `stoic-store/react` (unchanged otherwise).
    - Store-specific hooks are now plain wrappers: `const useCart = (sel) => useStore(cart, sel)`.
  - **`createStore` throws when a key is declared in both `state` and `derived`.** Previously the derived getter silently shadowed the state key, making it unreachable and unwritable.
  - Published files no longer include sourcemap comments pointing at unshipped `.map` files.

  **Fixed:**

  - **Dev-mode detection is now bundler-strippable.** The `NODE_ENV` check was read through `globalThis.process`, which bundler define-replacement does not rewrite — so in production browser bundles (where no `process` global exists) the `devtools` plugin defaulted to **enabled** and dev warnings shipped active. The check is now the literal `process.env.NODE_ENV` expression; Vite/esbuild/webpack replace it and production builds correctly disable devtools and warnings.
  - The persist plugin's "storage unavailable" warning is development-only, so SSR servers no longer log it per store per request.

  **New:**

  - **`persist` supports `skipHydration` + `rehydrate()`** for server rendering: skip the synchronous hydration at store creation (which causes a server/client hydration mismatch) and call `rehydrate()` on the plugin instance from an effect after React has hydrated.
  - `actions()` warns in development when a second call reuses an action name, which would silently create a handle with fresh, independent status meta.
  - README: API reference tables for every entry point, a section on what `batch` buys over React's own render batching, and persist SSR guidance.
  - Examples import Stoic by its published name (`stoic-store`, aliased to the repo's `src/`), so their code is copy-pasteable into real apps.

## 0.7.0

### Minor Changes

- 51ad3ea: Type-level fixes, `shallow` semantics, persist storage format, and `<Activity>` support.

  **Fixed:**

  - **Actions now return their value in the types.** The runtime always passed an action's return value through to the caller, but handles were typed `void`. `const id = createTask("title")` is now typed as whatever the action returns; async actions resolve with their return value.
  - **`shallow` no longer reports two different Maps, Sets, Dates, or class instances as equal.** These have no own enumerable keys, so the previous key comparison called any two of them equal — selectors returning them never re-rendered. Maps and Sets are now compared by size and membership; other non-plain objects are only equal by reference. (Breaking if you relied on key-comparison of class instances.)
  - **`persist` versioned envelopes store the state as a plain JSON value** (`{ "version": 2, "state": { … } }`) instead of double-serializing it into an escaped string. Payloads written by older versions are read transparently; the custom-`serialize` path still embeds the serializer's string output.
  - **`persist` disables itself with a single warning when storage is unavailable** (e.g. the default `localStorage` on a server) instead of warning on every write.
  - **`createStoreContext` survives React `<Activity>`.** Hiding a subtree destroys the store (flushing plugins, e.g. a pending `persist` write); revealing it builds a fresh store instead of handing back the destroyed one, which previously froze the subtree.
  - **`Provider`'s `init` prop is now required when the store factory can't be called without it.** Previously it was always optional and an omitted `init` silently passed `undefined` to the factory.

  **Improved:**

  - JSDoc on the entire public API (store members, plugin hooks, `persist`/`devtools` options).
  - Documented lint-friendly hook bindings (`const useCart = cart.useStore`), pinned by tests: the hooks never rely on `this`.
  - README: new Testing section, ESM-only and subscriber-exception notes, StrictMode `onInit` caveat for plugin authors.
  - Dependency records of derived values are deduplicated, so a derived function reading the same key in a loop no longer bloats freshness checks.
  - A type-level test suite (`expectTypeOf`) now pins the public type surface, and CI runs Biome.

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
