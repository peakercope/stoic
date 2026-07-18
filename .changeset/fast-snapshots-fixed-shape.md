---
"stoic-store": minor
---

Second performance overhaul of the core hot paths, with two breaking changes.

Measured on the bundled output, isolated single-case runs, `NODE_ENV=production`:

- `setState` on derived stores (values not re-read): **127 → 58 ns/op (+120%)**. The `READ_DERIVED` slot moved off snapshots onto a per-store intermediate prototype, eliminating a non-enumerable `defineProperty` on every write, and writes now build the next snapshot in a single pass — the separate raw copy is gone.
- `setState` + read of 2 derived: 606 → 463 ns/op (+31%); derived chain recompute 607 → 541 ns/op (+12%). Dependency tracking is now a compiled per-key accessor object instead of a Proxy (possible because the state shape is fixed, see below).
- Store creation (state-only): **213 → 78 ns/op (+172%)** — `isDevEnv()` is memoized per module load (the `process.env` interceptor read cost ~130ns per store), and derived-only structures are no longer allocated.
- Sync action invocation: 68 → 59 ns/op (+16%): `settle` became a context method and idle/pending/success metas are shared frozen singletons.
- Store creation with derived state costs ~0.7µs more than 0.12 (fresh per-store snapshot prototype); the trade pays for itself within about a dozen writes.

**BREAKING — fixed state shape:** the state's key set is fixed by `state` at creation. `setState` ignores keys that were not in the initial state (dev warning), like it already ignored derived keys. Snapshots keep one hidden class for the store's lifetime and dependency records stay exhaustive.

**BREAKING (minor) — dev/prod mode is resolved once per module load** (first store creation), not per store. Bundled builds already behaved this way via `NODE_ENV` inlining.

Also: action `getMeta()` may return reference-shared frozen meta objects (compare by value, as before), and `setState` no longer filters inherited enumerable keys off partial objects — the fixed-shape check subsumes it.
