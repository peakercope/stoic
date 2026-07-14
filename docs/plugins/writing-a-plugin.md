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

Called around every action call, with `{ name, args, state }`. `afterAction` still runs if the action throws or rejects.

### `afterSetState(state, actionName?, actionArgs?)`

Called after every update that changed something, with the full merged state.

`actionName` is the name of the action whose `set` produced the change (correct even across `await`s and overlapping async actions) and `actionArgs` are the arguments it was called with; both are `undefined` for a direct `store.setState`.

During a [`batch`](../batching.md), the hook fires once when the batch closes, reporting the action behind the last state-changing write — so `persist` writes once and `devtools` logs one combined entry per batch.

### `onDestroy()`

Called when `store.destroy()` is called.

## Rules

> Don't call `setState` from inside `afterSetState` or a subscriber — that's an update loop. Stoic warns in development on re-entrant updates and throws once the recursion exceeds a safety limit. If one value should follow another, express it as [derived state](../derived-state.md) instead.

> A subscriber or hook that throws stops later subscribers from being notified for that update, and the error propagates to whoever called `setState` (or the action's `set`). Keep subscribers exception-safe.

## Telling derived keys apart

A plugin that needs to tell raw state apart from derived values (as [`persist`](./persist.md) does) can inspect the snapshot: derived keys are exposed as enumerable getter properties, raw keys as plain data properties — `Object.getOwnPropertyDescriptor(store.getState(), key)?.get` is set exactly for derived keys, and checking it doesn't trigger any computation.
