# Stoic

Tiny React state manager with reactive derived state.

No reducers • No dependency arrays • No boilerplate • Fully typed • Plugin-based

Stoic is a small state management library for React, built on `useSyncExternalStore`. You define state and actions much like you would with any store library, but Stoic also lets you declare **derived state** — values computed from other state — as part of the store itself. Only the derived values and components that actually depend on a change are recomputed and rerendered.

## Installation

```bash
npm install stoic-store
```

Stoic requires React 18 or later.

## Quick Start

```ts
import { createStore } from "stoic-store";

export const cart = createStore({
  state: {
    items: [{ id: 1, title: "Keyboard", price: 100 }],
    tax: 0.2,
  },

  derived: {
    subtotal: ({ items }) => items.reduce((sum, item) => sum + item.price, 0),
    total: ({ subtotal, tax }) => subtotal * (1 + tax),
  },
});

export const { setTax } = cart.actions({
  setTax: (setState, tax: number) => setState({ tax }),
});
```

```tsx
function CartSummary() {
  const total = cart.useStore((state) => state.total);

  return <h2>Total: ${total}</h2>;
}
```

## Documentation

Full docs, including derived state, async actions, and plugins (`persist` and writing your own), are in the [project README](https://github.com/peakercope/stoic#readme).

## License

MIT
