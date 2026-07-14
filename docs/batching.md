# Batching

Every `setState` call that changes something — whether direct or made from inside an action — notifies components immediately. Calling three actions in a row means three rerenders. Wrap them in `store.batch` to coalesce them into a single notification and a single rerender:

```tsx
const store = createStore({
  state: { name: "", age: 0, country: "" },
});

const { setName, setAge, setCountry } = store.actions({
  setName: ({ set }, name: string) => set({ name }),
  setAge: ({ set }, age: number) => set({ age }),
  setCountry: ({ set }, country: string) => set({ country }),
});

store.batch(() => {
  setName("John");
  setAge(30);
  setCountry("USA");
});
```

Everything called inside the callback — direct `setState` calls, actions, or both — updates state immediately but defers the notification until the outermost batch closes. If the callback throws, pending changes are kept and listeners are still notified once before the error propagates. A batch that changes nothing notifies no one.

## What `batch` actually buys you

React 18+ already coalesces multiple re-renders from the same event handler on its own. `batch` coalesces at the **store** level:

- Subscribers are notified once instead of N times — which also means one render for updates fired from timers, async continuations, or non-React code.
- Plugins see a single `afterSetState`, so [`persist`](./plugins/persist.md) writes storage once and [`devtools`](./plugins/devtools.md) logs one entry for the whole batch.

Reads made *during* a batch (e.g. `store.getState()` from inside another action) always see fully consistent state — raw and derived values agree at every point.

> `batch` is synchronous: the batch ends when the callback returns, so `async` work inside the callback isn't deferred past the first `await`. Batch each synchronous chunk of an async flow instead.
