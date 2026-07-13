---
"stoic-store": minor
---

Pre-1.0 API hardening.

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
