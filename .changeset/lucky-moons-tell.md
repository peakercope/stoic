---
"stoic-store": minor
---

Rename `ActionContext` to `ActionEvent`, self-memoizing snapshots, and persist/react fixes.

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
