# Reading State

`useStore` (from `stoic-store/react`) subscribes a component to a store.

## The whole state

Call it with just the store to read everything:

```tsx
function Cart() {
  const { items } = useStore(cart);

  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>{item.title}</li>
      ))}
    </ul>
  );
}
```

## Selectors

Pass a selector to subscribe to a single value — the component only rerenders when that value changes, not on every store update:

```tsx
const total = useStore(cart, (state) => state.total);
```

The selector receives the full snapshot, so derived values are read exactly like raw state.

## Equality functions

When a selector returns an object or array, it's a new reference on every render, so pass an equality function as the third argument to avoid rerendering when the contents haven't actually changed. Stoic ships a `shallow` helper for this:

```tsx
import { shallow } from "stoic-store/tools";

const { subtotal, total } = useStore(
  cart,
  (state) => ({ subtotal: state.subtotal, total: state.total }),
  shallow,
);
```

You can also pass any custom `(a, b) => boolean` function instead of `shallow`. `shallow` compares plain objects and arrays one level deep and Maps/Sets by size and membership; other objects (Dates, class instances) are only equal by reference.

Without an equality function, `useStore` compares with `Object.is`.

## Store-specific wrapper hooks

`useStore` is a plain hook, so ESLint's `react-hooks` rules understand it out of the box. If passing the store everywhere gets repetitive, wrap it once and export a store-specific hook:

```tsx
export const useCart = <U,>(selector: (state: CartFull) => U, equality?: (a: U, b: U) => boolean) =>
  useStore(cart, selector, equality);

// In components:
const total = useCart((state) => state.total);
```

The same works for action meta: `export const useLoadUserMeta = () => useActionMeta(loadUser)`.

> If your stores are created per mount rather than at module level, [`createStoreContext`](./per-instance-stores.md) hands you an equivalent `useStore` with the store already resolved from context.

## Reading outside React

`store.getState()` returns the current snapshot and `store.subscribe(listener)` watches it — neither needs React. See the [API Reference](./api-reference.md#stoic-store).
