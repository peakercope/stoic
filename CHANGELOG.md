# stoic

## 1.0.0

### Major Changes

- 6d30050: Stoic is 1.0.

  Nothing is removed or renamed in this release — if you are on `0.15.x`, upgrading is a version bump
  and nothing else. What changes is the commitment: from here on, **no breaking change ships in a
  minor or patch release**.

  [Versioning](https://github.com/peakercope/stoic/blob/main/docs/versioning.md) spells out exactly
  what that covers. In short, the stable surface is everything in the
  [API Reference](https://github.com/peakercope/stoic/blob/main/docs/api-reference.md) — `createStore`
  and the store's methods, the React hooks, `shallow`, `derivedKeysOf`, the built-in plugins' options
  — plus the exported types and the inference you get from them, the entry points, the plugin hook
  contract and its ordering, and the documented notification and batching semantics. A change that
  forces you to add a type annotation you didn't need before counts as breaking, even if it compiles.

  Deliberately outside the promise: dev-only warning text, exact bundle size, performance
  characteristics, and anything reachable only through internals — a `dist/` path, a `@internal` type,
  or `Object.getOwnPropertySymbols(store)`.

  Two design decisions are worth stating plainly, because 1.0 freezes both:

  - **Derived stores spell out their types** — `createStore<State, Derived>`. This is a TypeScript
    limitation rather than a temporary shortcut: a derived function's parameter includes the derived
    values, so `Derived` sits in both an inference source and an inference target at once, and there
    is no fixed-point inference in the language. Thirteen candidate signatures were measured; every
    one of them either inferred the types or kept chained derived reads typed, never both. See
    [TypeScript](https://github.com/peakercope/stoic/blob/main/docs/typescript.md#why-derived-cant-be-inferred).
  - **Plugins observe; they don't intercept.** Every hook returns `void`. There is no middleware
    chain, and installing a plugin cannot change what your store does — only what else watches it. See
    [Philosophy](https://github.com/peakercope/stoic/blob/main/docs/philosophy.md).

### Minor Changes

- 6d30050: Export `derivedKeysOf`, so third-party plugins can tell derived values from raw state.

  Derived values are getters on a shared prototype that resolve into a private field, so no reflection
  over a snapshot distinguishes them: `Object.keys`, `getOwnPropertyNames` and descriptor checks all
  report exactly the raw state keys. `derivedKeysOf(store)` returns the declared derived keys (a copy,
  in declaration order), which is what `persist` needs to keep computed values out of storage and what
  `devtools` needs to read them back in for the extension to serialize.

  It already existed and both built-in plugins already used it — it was just marked `@internal` and
  not exported, which left first-party plugins with a capability nobody else could replicate. Since
  the plugin contract is one of the things a stable release freezes, that asymmetry is worth removing
  now. Application code rarely needs this.

  ```ts
  import { derivedKeysOf, type StoicPlugin } from "stoic-store";

  export function logger(): StoicPlugin {
    let derived: readonly string[] = [];
    return {
      onInit(store) {
        derived = derivedKeysOf(store); // fixed at creation — read once, keep it
      },
    };
  }
  ```

### Patch Changes

- 6d30050: Fix `destroy()` leaving a store half torn down when a plugin's `onDestroy` hook throws.

  `destroy()` set the destroyed flag first and retired the listeners last, so a throw in between left
  the worst of both states: `setState` was ignored, but every listener was still subscribed and the
  live-listener count no longer described the list. The visible symptom was a store destroyed from
  inside a notification — the dispatch loop is holding a length it read before `destroy()` ran, and
  only the retired slots stop it from calling the listeners ordered after the one that destroyed the
  store, so those listeners ran against a destroyed store. The rest of the time it was a leak: the
  listeners, and everything their closures held, were retained for good.

  The hook loop now runs inside a `try`, with the teardown in the `finally`. The error still
  propagates — a plugin that fails to clean up is the caller's problem, matching the contract a
  throwing subscriber already has — but it can no longer strand the store on the way out.

  `destroy()` is a cold path with no benchmark case; a same-session A/B over the whole suite showed no
  movement outside noise. The core entry grew from 2.40 kB to 2.41 kB gzipped.

  Plugin hooks are still not wrapped in `try`/`catch` anywhere else, and that stays deliberate. What
  each hook does when it throws is now specified in
  [Writing a plugin](https://github.com/peakercope/stoic/blob/main/docs/plugins/writing-a-plugin.md#errors)
  and pinned by tests for all five hooks.

## 0.15.4

### Patch Changes

- 15140d8: Give `useStore`'s snapshot function a stable identity, and add benchmarks for the React binding

  - `useStore` no longer rebuilds its `getSnapshot` closure on every render. React's `useSyncExternalStore` re-runs its store-instance effect whenever `getSnapshot` differs from the previous render, and that effect calls `getSnapshot` again — so every render of every subscribed component was paying a scheduled passive effect plus a second full selector pass. The hook now keeps one record per mounted component holding the current store, selector, equality and last selection, and closes over that record instead of over the arguments, so the read is allocated once and never changes identity. A parent re-render that drags 64 `useStore` calls through a render is 11–16% faster, and an inline selector runs one fewer time per render. Behaviour is unchanged: a selector or store that changes between renders is still picked up on the next read, and the cached-selection contract `getServerSnapshot` depends on is preserved.

    Rebuilding the closure only when `[store, selector, equality]` change was measured and rejected: consumers write selectors inline, so those dependencies differ on every render anyway and the memo only adds a dependency array to the same work. It measured ~5% _slower_ than doing nothing.

  - `yarn bench` gains five cases covering the layer every consumer actually touches, which the suite previously did not measure at all. Two run without React and isolate the per-notify selector cost at ns resolution (`notify:selector-fanout-64`, `notify:selector-fanout-64-1changed`); three drive real `react-dom` renders through a DOM (`render:mount-64`, `render:update-64-1changed`, `render:rerender-parent-64`). A case opts in with `needs: "react"` and receives a second `setup` argument, so the existing cases are untouched and only React cases pay for the DOM.

    The fan-out pair records something worth knowing: a notify costs the same whether a subscriber's selection changed or not — 64 subscribers cost ~460 ns either way, about 7 ns each. Stoic's bail-out saves React render work, not selector work.

  - New `yarn size`, a zero-dependency gzipped bundle report over `dist/prod` with the same `--save`/`--base` workflow as `yarn bench`. Sizes are measured per public entry point together with every chunk it pulls in, which is what a consumer importing that specifier pays, and keeps a saved baseline comparable across builds despite the shared chunk's content hash. The core entry is unchanged at 2.40 kB gzipped; `stoic-store/react` grows 60 B.

## 0.15.3

### Patch Changes

- 38327ee: Fix a state-shape hole, make mass unsubscribe linear, and cut sync action overhead

  - `setState` now checks written keys against the live snapshot instead of the `state` object passed to `createStore`. Mutating that object after creation used to widen the store's accepted key set, putting a key on the next snapshot that the store's key list never knew about — which both the one-hidden-class-per-store invariant and the exhaustiveness of the derived dependency records rely on not happening. The store also no longer retains a reference to the caller's config object.
  - Unsubscribing is no longer O(n) per call with an O(n) compaction on top, so unmounting a subtree is linear rather than quadratic. A 256-listener mount/unmount cycle goes from 41.6 µs to 11.5 µs.
  - Sync action invocation is 11–16% faster: meta transitions are stored directly when nothing has subscribed to them, the thenable test leads with the check most likely to fail, and the runner only materializes an arguments array when a plugin hook or attribution can observe it.
  - Snapshots are frozen in development, so mutating state directly now throws instead of silently corrupting the derived dependency records and any retained snapshot's memo. Production is unaffected.
  - `setState` warns in development when an updater function writes state while it is running; the partial it returns describes a state that no longer exists.
  - Circular dependency detection is unchanged, but the dependency chain in the message is now built only in development. Production names the key the read was caught on — the same split already used for the self-enumeration hint.
  - Prod core bundle is 2415 B gzipped, down from 2459 B.

## 0.15.2

### Patch Changes

- 2e7fc30: Fix thenable handling, duplicate meta subscriptions, and a spurious setState warning

  - Actions and the persist plugin now settle on any thenable, not just native `Promise` instances. A polyfilled or lazy thenable returned from an action was previously treated as a synchronous value, so the action's meta settled immediately and the thenable itself was handed back as the result.
  - `subscribeMeta` wraps each listener, so subscribing the same function twice yields two independent subscriptions; previously the second call collapsed into the same `Set` entry and unsubscribing either one silenced both.
  - `setState` no longer warns in development when passed an older snapshot. Restoring a previous snapshot is legal, but `for…in` walks its prototype's enumerable derived getters, which produced warnings for keys the caller never wrote.
  - Micro-optimizations in the plugin hook loops and action registration (indexed iteration instead of iterators).

## 0.15.1

### Patch Changes

- b3209ef: Fix a controller leak when an action reads `ctx.signal` after it has already settled: the late read registered an `AbortController` that `settle()` had already run past and could never remove. Such a read now gets a born-aborted signal, like any other stale call.

  Fix `liveSubs` going negative when an unsubscribe runs after `destroy()` has already retired every slot; the unsubscribe is now a no-op.

  Add a dev-only hint to `CircularDependencyError` when a key reads its own value, pointing at the usual cause — `{...state}`, `Object.keys(state)` or `Object.values(state)` inside a derived function enumerating the key being computed.

## 0.15.0

### Minor Changes

- 8677516: Rebuild the derived-state engine around a shared snapshot class, and ship a
  separate production build.

  **Store creation with derived values is ~7× faster** (1.20 µs → 0.17 µs for
  three derived keys). Snapshots used to hang off a per-store intermediate
  prototype; a freshly created object promoted to prototype makes V8 build new
  prototype info and a new map transition tree, so every property store on the
  first snapshot minted a brand-new map — ~800 ns per store. Snapshots are now
  instances of a class shared by every store declaring the same derived key names.

  **Reading derived values after a write is 34–49% faster.** The per-snapshot memo
  was attached with `Object.defineProperty` (~90 ns per snapshot); it is now a
  private class field. `set:derived-read2` 230 → 140 ns, `set:selector-style`
  177 → 91 ns, `set:derived-chain` 269 → 178 ns, `fanout:8derived-1changed`
  364 → 239 ns. Writes that never read a derived value cost ~2 ns more (56.5 →
  58 ns) — the class constructor — which is the only regression.

  **New `production` export condition.** `stoic-store` now publishes a second,
  pre-minified build with every dev-only warning folded out: 5205 B minified /
  2460 B gzip against 6096 B / 2837 B for the default build. Bundlers that
  understand the condition (Vite, webpack, Next.js) pick it up automatically in
  production mode; everything else keeps resolving the default build, which still
  checks `process.env.NODE_ENV` at runtime exactly as before. `persist`'s
  storage-failure warnings are deliberately not dev-gated and still ship in both.

  Breaking changes:

  - **ES2022 is now the minimum target.** Snapshots use private class fields. A
    bundler targeting anything lower will downlevel them to a `WeakMap`, which is
    correct but slightly slower.
  - `isDevEnv()` is replaced by the `DEV` binding (internal; not part of the
    public API). It is resolved once at module init rather than memoized on first
    use, which is what lets minifiers fold it.
  - A snapshot's prototype chain is one level shorter, and its `constructor` is
    the internal snapshot class rather than `Object`. Nothing about a snapshot's
    own properties changed: `Object.keys`, spreads, `JSON.stringify` and `toEqual`
    still see exactly the raw state keys, and now no own symbols at all.

## 0.14.0

### Minor Changes

- 54b2fb2: Core correctness and performance pass.

  **Fixed:** a `setState` made from inside a listener or plugin hook re-entered the
  notification and delivered the same final state a second time to every listener
  ordered after the writer — duplicate devtools entries and duplicate persist
  writes. Each listener now sees the final state once.

  **Faster:**

  - derived reads: fan-out (8 derived, one raw key written, all read) −64%,
    derived chains −26%, two derived reads per write −25%. Resolved values are
    memoized once per snapshot in a single array instead of one
    `Object.defineProperty` per key, which measured ~80ns against ~4ns for a plain
    store.
  - action calls: −27% for a plain sync action, −25% with one argument.
  - listener dispatch: −38% at 64 subscribers, −8.5% at 8.
  - store creation with derived state built from an inline config (per-instance
    and per-request stores): −46%.

  **Behaviour changes:**

  - Derived values are lazy in development too. They were evaluated eagerly at
    store creation in dev only, which made dev and production disagree about when
    and how often derived functions run, and cost 3.1× store creation time. A
    cyclic derived config now throws `CircularDependencyError` on the read that
    walks into the cycle rather than at `createStore`.
  - A derived value is not an own property of the state object until it is read,
    so `expect(store.getState()).toEqual({ …, derivedKey: x })` no longer matches.
    Assert the value instead: `expect(store.getState().derivedKey).toBe(x)`.
    `Object.keys`, spreads and `JSON.stringify` see raw state keys.
  - State objects must not be frozen — reading a derived value stores its memo on
    the object.
  - A listener subscribed during a notification now starts with the next change
    rather than the one in flight. Unsubscribing during a notification still takes
    effect immediately.
  - Subscribing the same function twice registers it twice; each unsubscribes
    independently.

## 0.13.0

### Minor Changes

- 55cc61b: Second performance overhaul of the core hot paths, with two breaking changes.

  Measured on the bundled output, isolated single-case runs, `NODE_ENV=production`:

  - `setState` on derived stores (values not re-read): **127 → 58 ns/op (+120%)**. The `READ_DERIVED` slot moved off snapshots onto a per-store intermediate prototype, eliminating a non-enumerable `defineProperty` on every write, and writes now build the next snapshot in a single pass — the separate raw copy is gone.
  - `setState` + read of 2 derived: 606 → 463 ns/op (+31%); derived chain recompute 607 → 541 ns/op (+12%). Dependency tracking is now a compiled per-key accessor object instead of a Proxy (possible because the state shape is fixed, see below).
  - Store creation (state-only): **213 → 78 ns/op (+172%)** — `isDevEnv()` is memoized per module load (the `process.env` interceptor read cost ~130ns per store), and derived-only structures are no longer allocated.
  - Sync action invocation: 68 → 59 ns/op (+16%): `settle` became a context method and idle/pending/success metas are shared frozen singletons.
  - Store creation with derived state costs ~0.7µs more than 0.12 (fresh per-store snapshot prototype); the trade pays for itself within about a dozen writes.

  **BREAKING — fixed state shape:** the state's key set is fixed by `state` at creation. `setState` ignores keys that were not in the initial state (dev warning), like it already ignored derived keys. Snapshots keep one hidden class for the store's lifetime and dependency records stay exhaustive.

  **BREAKING (minor) — dev/prod mode is resolved once per module load** (first store creation), not per store. Bundled builds already behaved this way via `NODE_ENV` inlining.

  Also: action `getMeta()` may return reference-shared frozen meta objects (compare by value, as before), and `setState` no longer filters inherited enumerable keys off partial objects — the fixed-shape check subsumes it.

## 0.12.0

### Minor Changes

- 055d501: Performance overhaul of the core hot paths. Store creation with derived state is ~5× faster, `setState` on derived stores ~3×, sync action invocation ~3.7×, and reads on snapshots with memoized derived values ~2.4× (snapshots now stay in V8 fast-properties mode instead of falling into dictionary mode when a derived value memoizes).

  How: derived getters moved from per-snapshot `defineProperties` onto a shared prototype (cached per `derived` config, so factory-created stores reuse one hidden-class tree); memoization now _adds_ an own data property instead of redefining the getter; dependency tracking reuses one proxy per store with a flat, deduped dep record; plugin hooks and action events are skipped/not allocated when no plugin implements them; state-only stores skip the snapshot copy entirely.

  Breaking behavior change: a derived key is an own enumerable property of a snapshot only **after** it has been read on that snapshot. Before that it lives on the snapshot's prototype — still readable and visible to `in`, but absent from `Object.keys`, spreads, and `JSON.stringify`. (In development the eager cycle check reads every derived key at creation, so the initial snapshot is fully materialized there; don't rely on that in production.) Also, state-only stores now hand out their internal state object directly — treat snapshots as immutable, as documented.

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
