# Quick Start

This page builds a small shopping cart store, reads it in a component, and updates it — the whole loop in three steps.

## 1. Create a store

A store is created with state, derived values, and actions:

```ts
import { createStore } from "stoic-store";

type CartItem = {
  id: number;
  title: string;
  price: number;
};
type State = {
  items: CartItem[];
  tax: number;
}
type Derived = {
  subtotal: number;
  total: number;
}

export const cart = createStore<State, Derived>({
  state: {
    items: [
      { id: 1, title: "Keyboard", price: 100 },
      { id: 2, title: "Mouse", price: 50 },
    ],
    tax: 0.2,
  },

  derived: {
    subtotal: ({ items }) => items.reduce((sum, item) => sum + item.price, 0),
    total: ({ subtotal, tax }) => subtotal * (1 + tax),
  },
});

export const { setTax, addItem } = cart.actions({
  setTax: ({ set }, tax: number) => {
    set({ tax });
  },

  addItem: ({ set }, item: CartItem) => {
    set((s) => ({
      items: [...s.items, item],
    }));
  },
});
```

## 2. Read it in a component

The `useStore` hook subscribes a component to the store:

```tsx
import { useStore } from "stoic-store/react";

function CartSummary() {
  const total = useStore(cart, (state) => state.total);

  return <h2>Total: ${total}</h2>;
}
```

## 3. Update it

Actions are called like regular functions — no dispatch, no action types:

```tsx
setTax(0.15);

addItem({
  id: 3,
  title: "Monitor",
  price: 300,
});
```

`subtotal` and `total` recompute automatically whenever `items` or `tax` change — you never write that logic yourself.

## Where to go next

- [Core Concepts](./core-concepts.md) — the four building blocks of a store.
- [Derived State](./derived-state.md) — the feature that sets Stoic apart.
- [Actions](./actions.md) — async actions, status tracking, cancellation.
- [`examples/`](../examples) — three complete applications you can run.
