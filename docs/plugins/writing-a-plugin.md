# Writing a plugin

A plugin is an object implementing any of the `StoicPlugin` lifecycle hooks. Hooks only observe state — they can't transform it.

```tsx
import type { StoicPlugin } from "stoic-store";
import { createStore } from "stoic-store";

const logger = (): StoicPlugin => ({
  afterSetState(state) {
    console.log(state);
  },
});

const store = createStore({
  state: { count: 0 },
  plugins: [logger()],
});
```

> **Note:** Define hooks with method shorthand (`afterSetState(state) { ... }`), not as arrow-function properties (`afterSetState: (state) => { ... }`). Both run the same way, but method shorthand is required for the hook to type-check correctly against stores with derived state.

## The hooks

### `onInit(store)`

Called once when the store is created.

In development, React StrictMode double-invokes store factories, so `onInit` can also run for a store that is immediately discarded and never destroyed — side effects here should tolerate that.

### `beforeAction(ctx)` / `afterAction(ctx)`

Called around every action call, with `{ name, args, state }` (the `ActionEvent` type). `afterAction` still runs if the action throws or rejects — but not if it settles after the store was destroyed, since `onDestroy` has already run by then.

### `afterSetState(state, actionName?, actionArgs?)`

Called after every update that changed something, with the full merged state.

`actionName` is the name of the action whose `set` produced the change (correct even across `await`s and overlapping async actions) and `actionArgs` are the arguments it was called with; both are `undefined` for a direct `store.setState`.

During a [`batch`](../batching.md), the hook fires once when the batch closes, reporting the action behind the last state-changing write — so `persist` writes once and `devtools` logs one combined entry per batch.

### `onDestroy()`

Called when `store.destroy()` is called.

## Rules

> Don't call `setState` from inside `afterSetState` or a subscriber — that's an update loop. Stoic warns in development on re-entrant updates and throws once the recursion exceeds a safety limit. If one value should follow another, express it as [derived state](../derived-state.md) instead. Note also what a re-entrant write does to ordering: the nested update notifies everyone immediately, and the interrupted notification then resumes with the *newest* snapshot — so later listeners can receive the same state twice and never observe the intermediate one.

## Errors

Stoic does **not** wrap plugin hooks in `try`/`catch`. A hook that throws propagates to whoever
triggered it and stops the hooks and subscribers ordered after it — the same contract a throwing
subscriber has. Hooks are on the critical path of every update, so keep them exception-safe: catch
your own errors, and never let a logging or devtools plugin take an application down with it.

What each hook does when it throws:

| Hook | Where the error surfaces | What is skipped |
| --- | --- | --- |
| `onInit` | out of `createStore` — no store handle is returned | later plugins' `onInit` |
| `beforeAction` | out of the action call | the action body, and everything after it |
| `afterAction` | out of the action call, or as a rejection of its promise | later `afterAction` hooks; the action's meta never settles and stays `"pending"` |
| `afterSetState` | out of `setState` (or the action's `set`, or `batch`) | later `afterSetState` hooks and **every subscriber** — React components will not re-render for that update |
| `onDestroy` | out of `store.destroy()` | later `onDestroy` hooks |

The state itself is never left inconsistent: by the time `afterSetState` runs the new snapshot is
already the current one, so a throw cuts the announcement short, not the write.

`destroy()` is the one hook that cannot leave the store half-torn-down. Even when an `onDestroy`
hook throws, listeners are still retired and the store is fully destroyed before the error escapes —
otherwise a failing plugin would strand a store that ignores writes but never releases its
subscribers.

## Telling derived keys apart

Snapshot property descriptors can't distinguish raw state from derived values. A derived key is a
getter on the snapshot's shared prototype — never an own property — and it resolves into a private
field, which no amount of reflection will show you. So `Object.keys`, `Object.getOwnPropertyNames`
and descriptor checks all report exactly the raw state keys, whether or not a derived value has
been read.

Use `derivedKeysOf` instead:

```ts
import { derivedKeysOf, type StoicPlugin } from "stoic-store";

export function logger(): StoicPlugin {
  let derived: readonly string[] = [];

  return {
    onInit(store) {
      derived = derivedKeysOf(store); // declaration order; empty without derived state
    },
    afterSetState(state, actionName) {
      const raw = { ...state }; // own keys only — already excludes derived values
      console.log(actionName ?? "setState", raw);
    },
  };
}
```

It returns a copy, so holding on to it can't disturb the store. Two things worth knowing:

- **A spread already excludes derived values.** `{ ...state }` copies own enumerable properties, and
  derived values aren't own properties. You need `derivedKeysOf` when you want the opposite — to
  *include* them (as [`devtools`](./devtools.md) does, reading each one explicitly so the extension
  can serialize it), or to reject them from input (as [`persist`](./persist.md) does when validating
  its `include` option).
- **Read it in `onInit` and keep it.** The derived key set is fixed when the store is created and
  never changes, so there is no reason to call it on every update.
