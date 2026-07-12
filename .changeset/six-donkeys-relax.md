---
"stoic-store": patch
---

Fix several correctness edge cases:

- Overlapping calls to the same async action no longer resolve `ActionMeta` prematurely — status now stays `"pending"` until the last in-flight call settles.
- The functional form of `setState` now sees up-to-date derived values instead of a stale snapshot when called while the store is unobserved.
- A derived function that throws no longer permanently stops later recomputation of the keys it would have marked dirty; the next state change retries it.
- `batch()` no longer notifies listeners or runs `afterSetState` hooks when nothing inside the batch actually changed state.
- `persist`'s `include` option no longer overwrites initial-state defaults with `undefined` when rehydrating a payload written before that key existed.
- `persist` rehydration no longer merges keys from a stale stored payload that are no longer part of the store's state.
- The devtools plugin no longer re-enables recording as a side effect of a time-travel jump while recording is paused.

Also tightened the derived-state engine's internals (fewer allocations per recompute, cycle detection skipped when the dependency graph is unchanged) and `useStore` (selector no longer runs on every render just to seed a ref) — no behavior change.
