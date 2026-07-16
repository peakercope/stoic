# Derived State

Derived state is the main thing that sets Stoic apart from other state managers. Instead of recomputing values inside components:

```tsx
const total = useMemo(() => subtotal * (1 + tax), [subtotal, tax]);
```

...you describe the relationship once, in the store:

```tsx
derived: {
  total: ({ subtotal, tax }) => subtotal * (1 + tax);
}
```

Every component that reads `total` gets the same computed value, and it's recomputed only when `subtotal` or `tax` actually change — not on every render, and not on unrelated state changes.

## Chaining derived values

Derived values can depend on each other, too. Extending the cart example with a discount (note the two type parameters — `createStore<State, Derived>` — which derived stores need; see [TypeScript](./typescript.md)):

```tsx
type State = { items: CartItem[]; tax: number; discount: number };
type Derived = { subtotal: number; total: number; finalPrice: number };

const cart = createStore<State, Derived>({
  state: {
    items: [],
    tax: 0.2,
    discount: 0.1,
  },

  derived: {
    subtotal: ({ items }) => items.reduce((sum, item) => sum + item.price, 0),
    total: ({ subtotal, tax }) => subtotal * (1 + tax),
    finalPrice: ({ total, discount }) => total * (1 - discount),
  },
});
```

Stoic builds a dependency graph from this: `items → subtotal → total → finalPrice`, with `tax` feeding into `total` and `discount` feeding into `finalPrice`. When state changes, only the derived values downstream of that change are recomputed:

| After…            | `subtotal`      | `total`         | `finalPrice`  |
| ----------------- | --------------- | --------------- | ------------- |
| `setDiscount(0.2)` | ❌ not recomputed | ❌ not recomputed | ✅ recomputed |
| `setTax(0.25)`     | ❌ not recomputed | ✅ recomputed    | ✅ recomputed |

There are no dependency arrays to maintain and nothing to memoize by hand — Stoic tracks which state each derived value reads and invalidates only what's affected.

## What dependency tracking sees

Tracking is **per top-level state key**. A derived function that reads `s.items` depends on the `items` *reference* — Stoic does not watch inside arrays or objects. Two rules follow:

1. **Update state immutably.** Mutating an array in place (`s.items.push(...)`) keeps the same reference, so nothing downstream recomputes. Every example in these docs produces a new array/object instead.
2. **Read inputs as properties** (`s.count`); dependency tracking doesn't see `Object.keys(s)` or `"count" in s`.

Derived values are computed **lazily**: a derived key does its work the first time it's read after a relevant change, and the result is memoized until a dependency actually changes. Declaration order doesn't matter — a derived key can freely read another derived key declared before or after it; reads resolve recursively through the dependency graph. (The one exception to laziness: in development builds, every derived key is evaluated once at store creation so a statically cyclic configuration fails immediately; production builds skip that pass and stay fully lazy.)

> Derived functions should be **pure** — no side effects, no reading clocks or randomness. An impure derived value only recomputes when its tracked dependencies change, so anything else it reads goes stale silently.

## Rules and errors

> If two derived keys end up depending on each other in a cycle, Stoic throws a `CircularDependencyError` describing the cycle — in development at store creation if the cycle is always present, otherwise on the read of the cyclic value.

> A key can't be both state and derived: `createStore` throws if `state` and `derived` share a key, since the derived getter would silently shadow the state value.

Derived values are also never written to storage — see [Derived state is never persisted](./plugins/persist.md#derived-state-is-never-persisted).
