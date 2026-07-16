# Core Concepts

A Stoic store is made of four building blocks. Everything else in Stoic is built on top of them.

## State

Your application data — the `state` object you pass to `createStore`. It is a plain object; Stoic does not wrap it in proxies, classes, or observables.

```ts
const cart = createStore({
  state: { items: [], tax: 0.2 },
});
```

State is updated by [actions](./actions.md), or directly with `store.setState(partial)`. Updates **merge**: a partial only replaces the keys it names.

## Derived state

Values computed from state, kept up to date automatically. You declare the relationship once, in the store, instead of recomputing it in every component that needs it.

```ts
derived: {
  subtotal: ({ items }) => items.reduce((sum, item) => sum + item.price, 0),
  total: ({ subtotal, tax }) => subtotal * (1 + tax),
}
```

Stoic tracks which state each derived function reads, so when something changes only the derived values downstream of that change are recomputed. There are no dependency arrays. See [Derived State](./derived-state.md).

## Actions

Functions that update state, sync or async. They are plain functions — you call them directly rather than dispatching an object.

```ts
export const { setTax } = cart.actions({
  setTax: ({ set }, tax: number) => set({ tax }),
});

setTax(0.15);
```

Each action receives a context (`set`, `get`, `signal`) as its first argument, and its handle carries the status of its most recent call. See [Actions](./actions.md).

## Plugins

Optional lifecycle hooks for things the core deliberately leaves out — persistence, devtools, logging. Plugins observe the store; they cannot transform its state.

```ts
createStore({
  state: { theme: "light" },
  plugins: [persist({ key: "settings" })],
});
```

`persist` and `devtools` ship with the library, and the same interface is available to you. See [Plugins](./plugins/README.md).

## The state snapshot

`store.getState()` returns a snapshot: a single object containing both your raw state and its derived values. Selectors, action `get()`, subscribers, and plugin hooks all see that same shape, so there is no separate place to look up a computed value.

Two properties of the snapshot are worth knowing:

- **Derived keys start as enumerable getters and memoize themselves into plain data properties on first read.** Reading a derived key computes it on demand; repeat reads on the same snapshot are ordinary property accesses. Either way the key is own and enumerable, so spreads, `Object.keys`, and `JSON.stringify` see derived values alongside raw state — but property descriptors are *not* a way to tell the two apart (see [Telling derived keys apart](./plugins/writing-a-plugin.md#telling-derived-keys-apart)).
- **Snapshots are replaced, not mutated.** An update that changes nothing keeps the same snapshot reference, so subscribers are not notified. This is what lets `useStore` skip rerenders, and it is why you should [update state immutably](./derived-state.md#what-dependency-tracking-sees).

## Where to go next

- [Reading State](./reading-state.md) — getting values out of a store, efficiently.
- [Derived State](./derived-state.md) — how dependency tracking works.
- [Actions](./actions.md) — the full action lifecycle.
- [Batching](./batching.md) — coalescing several updates into one rerender.
