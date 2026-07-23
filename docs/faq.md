# FAQ

## Can I have multiple stores?

Yes. Create as many independent stores as your application needs:

```tsx
export const auth = createStore(/* ... */);
export const cart = createStore(/* ... */);
export const settings = createStore(/* ... */);
```

## Does Stoic work with Server Components?

Yes. The core entry (`stoic-store`) is React-free, so a store module can be imported from a Server Component without pulling client-side React in — reading `getState()` or calling actions there just works. The hooks live in `stoic-store/react`, and any component that calls them needs the `"use client"` directive, the same requirement as every other React state library. (For per-user data on the server, see the next question.)

## Can I use module-level stores with server-side rendering?

Only for request-independent data. A store created at module level is a **singleton per JavaScript process**. In the browser that's exactly what you want; on an SSR server it means every request shares the same store, so one user's state can leak into another's render.

If you render on the server and put per-user data in a store, create it per request with [`createStoreContext`](./per-instance-stores.md) instead.

## Does Stoic work with concurrent rendering?

Yes. `useStore` is built on `useSyncExternalStore`, React's sanctioned way to read external stores without tearing. As with every uSES-based library an external-store update de-opts that render to synchronous — the standard trade-off React makes for consistency.

## What happens if my derived values depend on each other in a cycle?

Stoic throws a `CircularDependencyError` describing the cycle, instead of recomputing forever. Derived values are lazy, so the error surfaces on the read that walks into the cycle rather than at `createStore`.

## Why isn't my derived value recomputing?

Most likely the state it depends on was mutated in place rather than replaced. Dependency tracking is per top-level key and compares by reference, so `s.items.push(item)` leaves `items` pointing at the same array and nothing downstream recomputes. Produce a new array or object instead — see [What dependency tracking sees](./derived-state.md#what-dependency-tracking-sees).
