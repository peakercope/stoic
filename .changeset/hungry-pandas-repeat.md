---
"stoic-store": minor
---

Core correctness and performance pass.

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
