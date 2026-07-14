# Per-instance Stores

Most of these docs create the store at module level — one store per JavaScript process. In the browser that's exactly right, and it's the pattern you should reach for by default.

It breaks down when **one process serves several independent trees**:

- **Server rendering.** An SSR server is long-lived and handles many users concurrently. A module-level store is shared by every request, so one user's state can leak into another user's render.
- **Repeated widgets.** Two instances of the same component that each need their own store.
- **Tests.** Each test wants a clean store, without resetting a shared one.

## `createStoreContext`

`createStoreContext` builds a React Context around a store factory, so each mounted `Provider` gets its own store:

```tsx
import { createStore } from "stoic-store";
import { createStoreContext } from "stoic-store/react";

export const { Provider, useStore, useActions, useStoreApi } = createStoreContext(
  (initialItems: CartItem[] = []) => {
    const store = createStore<CartState, CartDerived>({
      state: { items: initialItems, tax: 0.2 },
      derived: {
        subtotal: ({ items }) => items.reduce((sum, item) => sum + item.price, 0),
        total: ({ subtotal, tax }) => subtotal * (1 + tax),
      },
    });

    const actions = store.actions({
      addItem: ({ set }, item: CartItem) => set((s) => ({ items: [...s.items, item] })),
      loadCart: async ({ set }) => set({ items: await fetchCart() }),
    });

    return { store, actions };
  },
);
```

The factory returns **both** the store and its actions. Action handles close over the store they were created from, so they have to be built per instance — doing it here binds them once and keeps their identity, and their `useActionMeta` status, stable across renders.

## Providing and consuming

Wrap the tree in the `Provider`, optionally seeding it with `init`:

```tsx
<Provider init={itemsFetchedOnTheServer}>
  <Cart />
</Provider>
```

Components then read and act through the returned hooks, with the same ergonomics as the singleton API:

```tsx
function CartSummary() {
  const total = useStore((state) => state.total);
  const { addItem, loadCart } = useActions();
  const { status } = useActionMeta(loadCart);

  if (status === "pending") return <Spinner />;
  return <button onClick={() => addItem(monitor)}>Total: ${total}</button>;
}
```

| Returned | What it is |
| --- | --- |
| `Provider` | Creates one store per mount. `init` is read on the first render only — like a `defaultValue`, changing it later won't rebuild the store. The prop is required exactly when the factory can't be called without it. |
| `useStore(selector?, equality?)` | Like the plain [`useStore`](./reading-state.md) hook, with the store resolved from context. |
| `useActions()` | This instance's action handles. Stable across renders. |
| `useStoreApi()` | The `StoicStore` itself, for `getState` / `subscribe` / `batch` outside of render. |

## Lifecycle

The store is destroyed when its `Provider` unmounts, so plugins get their `onDestroy` (a pending debounced [`persist`](./plugins/persist.md) write is flushed). This is StrictMode-safe: React's mount → unmount → mount cycle in development does not tear down the store.

Inside React's [`<Activity>`](https://react.dev/reference/react/Activity) (React 19.2+), hiding a subtree behaves like an unmount for the store: it is destroyed — flushing plugins — and a fresh one is created when the subtree is revealed. In-memory state does not survive a hide; pair the store with `persist` if it should.
