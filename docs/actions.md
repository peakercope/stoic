# Actions

Actions update the store. Instead of dispatching action objects, you call a plain function:

```tsx
setTax(0.15);
```

## Defining actions

`store.actions(map)` turns a map of functions into callable **action handles**:

```tsx
const { addItem, removeItem, clearCart } = cart.actions({
  addItem: ({ set }, item: CartItem) => {
    set((s) => ({ items: [...s.items, item] }));
  },
  removeItem: ({ set }, id: number) => {
    set((s) => ({ items: s.items.filter((item) => item.id !== id) }));
  },
  clearCart: ({ set }) => {
    set({ items: [] });
  },
});
```

Action arguments and store state are both fully typed, so your editor infers them without extra annotations.

Register a given action name once per store, at module (or factory) level. Each `actions()` call builds new handles with fresh, independent status meta, so re-registering a name — say, inside a component — would silently reset its tracked status; Stoic warns in development when that happens.

An action's return value is passed through to the caller — handy for returning a created id or a computed result:

```tsx
const { addItem } = cart.actions({
  addItem: ({ set }, title: string) => {
    const id = crypto.randomUUID();
    set((s) => ({ items: [...s.items, { id, title }] }));
    return id;
  },
});

const newId = addItem("Monitor"); // string
```

Async actions resolve with their return value the same way.

## The action context

Every action receives a context as its first argument, followed by whatever arguments you call it with. The context has three members:

- `set` — updates state. Accepts either a partial state object or an updater function that reads the current state.
- `get` — returns the current state (including derived values), useful for reading mid-action.
- `signal` — an `AbortSignal` that is aborted when a newer call of the same action starts, or when the store is destroyed. See [Overlapping calls and cancellation](#overlapping-calls-and-cancellation).

## Async actions

An action can be asynchronous — just make the function `async` and call `set` whenever you have new data:

```tsx
type User = { id: number; name: string };

const users = createStore<{ user: User | null }>({
  state: {
    user: null,
  },
});

const { loadUser } = users.actions({
  loadUser: async ({ set }, id: number) => {
    const user = await fetch(`/api/users/${id}`).then((r) => r.json());

    set({ user });
  },
});
```

Call it exactly like a synchronous action — it also returns a promise you can `await`:

```tsx
await loadUser(42);
```

## Tracking status

Every action handle carries the status of its most recent call. Subscribe to it in a component with `useActionMeta`, so you can render loading and error states without tracking them in your own state:

```tsx
import { useActionMeta } from "stoic-store/react";

const { status, error } = useActionMeta(loadUser);

if (status === "pending") {
  return <Spinner />;
}

if (status === "error") {
  return <ErrorMessage error={error} />;
}
```

`status` is one of `"idle" | "pending" | "success" | "error"`. Outside React, `loadUser.getMeta()` returns the current meta and `loadUser.subscribeMeta(listener)` watches it.

## Overlapping calls and cancellation

If the same action is called again while a previous call is still in flight, **both** calls' `set`s land — the slower response can overwrite the faster one. The meta status always reflects the *most recent* call, but state writes are on you.

For work that is abortable, the fix is `ctx.signal`: each call's signal is aborted the moment a newer call of the same action starts (and when the store is destroyed, e.g. its [`Provider`](./per-instance-stores.md) unmounts). Pass it to `fetch` and the stale request is cancelled on the wire — it rejects instead of landing:

```tsx
const { selectUser } = search.actions({
  selectUser: async ({ set, signal }, login: string) => {
    set({ selected: login });
    const profile = await api.fetchProfile(login, signal);

    set({ profile }); // never reached if a newer call aborted this one
  },
});
```

The signal is created lazily — actions that don't read it pay nothing, and their overlapping calls are unaffected. An aborted call's promise rejects with an `AbortError`, like any other failing async action; the existing latest-call-wins rule means that rejection never touches the newer call's meta, so `useActionMeta` won't flash an error. If you `await` an action that can be aborted, be ready to catch it.

For async work that *can't* be aborted, use `get` to drop the stale result after the fact:

```tsx
const { selectUser } = search.actions({
  selectUser: async ({ set, get }, login: string) => {
    set({ selected: login });
    const profile = await legacyFetchProfile(login); // not abortable

    // Another user was selected while this was in flight — drop it.
    if (get().selected !== login) return;

    set({ profile });
  },
});
```

## Related

- [Batching](./batching.md) — calling several actions with a single rerender.
- [Derived State](./derived-state.md) — why `set` must produce new references.
- [API Reference](./api-reference.md#stoic-store) — exact signatures for `actions`, `ActionCtx`, and `ActionMeta`.
