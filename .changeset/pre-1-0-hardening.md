---
"stoic-store": minor
---

Type-level fixes, `shallow` semantics, persist storage format, and `<Activity>` support.

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
