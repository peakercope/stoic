# Testing

Two patterns cover most test setups.

## Reset a module-level store between tests

A store created at module level is shared across tests in the same file. Define a reset action next to the store, and call it in your test setup:

```tsx
const initialState = { items: [], tax: 0.2 };
export const cart = createStore<State, Derived>({ state: initialState, /* derived, ... */ });

export const { reset } = cart.actions({
  reset: ({ set }) => set(initialState),
});
```

```tsx
beforeEach(() => reset());
```

Note that `setState` merges, so `set(initialState)` restores every key it names — list all of them (spreading a captured `initialState` object does exactly that).

## One store per test

If your stores are behind [`createStoreContext`](./per-instance-stores.md), each `render` with a fresh `Provider` gets an isolated store — nothing to reset:

```tsx
render(
  <Provider init={fixtureItems}>
    <Cart />
  </Provider>,
);
```

## Asserting outside React

Assertions against the store outside of components work through the plain API: `store.getState()`, `store.subscribe`, or calling actions directly — none of them need React.
