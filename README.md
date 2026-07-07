# <p align="center">Stoic</p>

<p align="center">
  <img src="./docs/image.png" width="240" alt="Stoic mascot">
</p>

<p align="center">
<strong>Tiny React state manager with reactive derived state.</strong>
</p>

<p align="center">
No reducers • No dependency arrays • No boilerplate • Fully typed • Plugin-based
</p>

<p align="center">
<img src="https://badgen.net/bundlephobia/minzip/stoic-store" />
<img src="https://badgen.net/github/license/peakercope/stoic" />
</p>

<p align="center">
<a href="#quick-start">Quick Start</a> •
<a href="#core-concepts">Core Concepts</a> •
<a href="#derived-state">Derived State</a> •
<a href="#plugins">Plugins</a> •
<a href="#faq">FAQ</a>
</p>

---

Stoic is a small state management library for React, built on `useSyncExternalStore`. You define state and actions much like you would with any store library, but Stoic also lets you declare **derived state** — values computed from other state — as part of the store itself.

The key difference from most state managers: Stoic tracks the relationships between your state automatically. When something changes, only the derived values that actually depend on it are recomputed, and only the components reading those values rerender. There are no dependency arrays to maintain.

* ⚡️ Plain function actions — no dispatch, no action types
* 🧠 Reactive derived state with automatic dependency tracking
* 🚀 First-class async actions, with built-in pending/error status
* 🔌 A small plugin system (`persist` and `devtools` are included; write your own for the rest)
* 💙 Fully typed, with state and action arguments inferred by your editor

---

## Installation

```bash
npm install stoic-store
# or
yarn add stoic-store
```

Stoic requires React 18 or later (it uses `useSyncExternalStore`).

---

## Quick Start

Create a store with state, derived values, and actions:

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
  setTax: (setState, tax: number) => {
    setState({ tax });
  },

  addItem: (setState, item: CartItem) => {
    setState((s) => ({
      items: [...s.items, item],
    }));
  },
});
```

Read from it in a component with `useStore`:

```tsx
function CartSummary() {
  const total = cart.useStore((state) => state.total);

  return <h2>Total: ${total}</h2>;
}
```

And update it by calling actions like regular functions:

```tsx
setTax(0.15);

addItem({
  id: 3,
  title: "Monitor",
  price: 300,
});
```

`subtotal` and `total` recompute automatically whenever `items` or `tax` change — you never write that logic yourself.

---

## Core Concepts

A Stoic store is made of four building blocks:

* **State** — your application data (`items`, `tax` above).
* **Derived state** — values computed from state, kept up to date automatically (`subtotal`, `total`).
* **Actions** — functions that update state, sync or async (`setTax`, `addItem`).
* **Plugins** — optional lifecycle hooks for things like persistence.

Everything else in Stoic is built on top of these four concepts.

---

## Reading State

`useStore()` subscribes a component to the store. Call it with no arguments to read the whole state:

```tsx
function Cart() {
  const { items } = cart.useStore();

  return (
    <ul>
      {items.map((item) => (
        <li key={item.id}>{item.title}</li>
      ))}
    </ul>
  );
}
```

Pass a selector to subscribe to a single value — the component only rerenders when that value changes, not on every store update:

```tsx
const total = cart.useStore((state) => state.total);
```

When a selector returns an object or array, it's a new reference on every render, so pass an equality function as the second argument to avoid rerendering when the contents haven't actually changed. Stoic ships a `shallow` helper for this:

```tsx
import { shallow } from "stoic-store/tools";

const { subtotal, total } = cart.useStore(
  (state) => ({ subtotal: state.subtotal, total: state.total }),
  shallow,
);
```

You can also pass any custom `(a, b) => boolean` function instead of `shallow`.

---

## Actions

Actions update the store. Instead of dispatching action objects, you call a plain function:

```tsx
setTax(0.15);
```

Every action receives `setState` as its first argument, followed by whatever arguments you call it with. `setState` accepts either a partial state object or an updater function that reads the current state:

```tsx
const { increment, removeItem } = cart.actions({
  increment: (setState) => {
    setState((s) => ({ tax: s.tax + 0.01 }));
  },
  removeItem: (setState, id: number) => {
    setState((s) => ({ items: s.items.filter((item) => item.id !== id) }));
  },
});
```

Action arguments and store state are both fully typed, so your editor infers them without extra annotations.

---

## Async Actions

An action can be asynchronous — just make the function `async` and call `setState` whenever you have new data:

```tsx
const users = createStore({
  state: {
    user: null as { id: number; name: string } | null,
  },
});

const { loadUser } = users.actions({
  loadUser: async (setState, id: number) => {
    const user = await fetch(`/api/users/${id}`).then((r) => r.json());

    setState({ user });
  },
});
```

Call it exactly like a synchronous action — it also returns a promise you can `await`:

```tsx
await loadUser(42);
```

### Tracking status

Every action exposes its current status through `.useMeta()`, so you can render loading and error states without tracking them in your own state:

```tsx
const { status, error } = loadUser.useMeta();

if (status === "pending") {
  return <Spinner />;
}

if (status === "error") {
  return <ErrorMessage error={error} />;
}
```

`status` is one of `"idle" | "pending" | "success" | "error"`.

---

## Derived State

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

Derived values can depend on each other, too. Extending the cart example with a discount:

```tsx
const cart = createStore({
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

| setDiscount(0.2) || setTax(0.25) |
| :---: |:-:| :---: |
| ❌ || ❌ |
| *subtotal* (unchanged) || *subtotal* (unchanged) |
| ❌ || ✅ |
| *total* (unchanged) || *total* (recomputed) |
| ✅ || ✅ |
| *finalPrice* (recomputed) || *finalPrice* (recomputed) |


There are no dependency arrays to maintain and nothing to memoize by hand — Stoic tracks which state each derived value reads and invalidates only what's affected.

> Derived values are recomputed in declaration order, in a single pass — not resolved as a dependency graph at runtime. If a derived key reads another derived key, it must be declared *after* it (as `total` is declared after `subtotal` above), or it will see a stale value. 

> If two derived keys end up depending on each other in a cycle, Stoic throws a `CircularDependencyError` rather than looping forever.

---

## Plugins

The core of Stoic only handles state, derived state, and actions. Everything else — persistence, logging, devtools — is a plugin, so you only pay for what you use.

### Built-in: `devtools`

`devtools` connects a store to the [Redux DevTools](https://github.com/reduxjs/redux-devtools) browser extension, so you can inspect state, see every action as it fires, and time-travel through history:

```tsx
import { createStore } from "stoic-store";
import { devtools } from "stoic-store/plugins";

const cart = createStore({
  state: {
    items: [],
    tax: 0.2,
  },

  plugins: [devtools({ name: "cart" })],
});
```

Every entry in the DevTools log is tagged with the name of the action that produced it (`setTax`, `addItem`, ...); a `setState` call made outside of an action shows up as `"anonymous"`. Time-travel (jumping to a past state, resetting, importing a state) is applied back to the store automatically. `devtools` accepts:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `string` | an auto-generated, unique per-store name | Instance name shown in the DevTools dropdown. |
| `enabled` | `boolean` | `true` outside of `NODE_ENV=production` | Whether to connect to the extension at all. |
| `anonymousActionType` | `string` | `"anonymous"` | Label used for `setState` calls made outside of an action. |

If the Redux DevTools extension isn't installed, `devtools` is a no-op — your store behaves exactly as if the plugin weren't there.

### Built-in: `persist`

`persist` saves your store to storage and restores it on load:

```tsx
import { createStore } from "stoic-store";
import { persist } from "stoic-store/plugins";

const settings = createStore({
  state: {
    theme: "light",
    language: "en",
  },

  plugins: [persist({ key: "settings" })],
});
```

Refresh the page and `settings` is restored automatically. `persist` accepts:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `key` | `string` | *(required)* | Storage key the state is saved under. |
| `storage` | `() => Storage` | `() => localStorage` | Storage backend, e.g. `() => sessionStorage`. |
| `include` | `(keyof T)[]` | — | Persist only these fields. |
| `exclude` | `(keyof T)[]` | — | Persist everything except these fields. |
| `serialize` | `(state) => string` | `JSON.stringify` | Custom serialization. |
| `deserialize` | `(raw) => Partial<T>` | `JSON.parse` | Custom deserialization. |
| `debounceMs` | `number` | — | Delay writes, resetting the timer on each change. |
| `throttleMs` | `number` | — | Limit writes to at most once per interval. |

`include` and `exclude` are mutually exclusive, as are `debounceMs` and `throttleMs`. Pending debounced or throttled writes are flushed immediately if the store is destroyed.

```tsx
persist({
  key: "settings",
  exclude: ["loading", "error"], // don't persist transient fields
  debounceMs: 250,               // batch rapid updates into one write
});
```

### Writing a plugin

A plugin is an object implementing any of the `StoicPlugin` lifecycle hooks. Hooks only observe state — they can't transform it:

* `onInit(store)` — called once when the store is created.
* `beforeAction(ctx)` / `afterAction(ctx)` — called around every action call, with `{ name, args, state }`. `afterAction` still runs if the action throws or rejects.
* `beforeSetState(partial)` / `afterSetState(state)` — called around every `setState`, with the raw partial update and the full merged state respectively.
* `onDestroy()` — called when `store.destroy()` is called.

```tsx
const logger = (): StoicPlugin => ({
  afterSetState(state) {
    console.log(state);
  },
});

const store = createStore({
  state: { count: 0 },
  plugins: [logger()],
});
```

> **Note:** Define hooks with method shorthand (`afterSetState(state) { ... }`), not as arrow-function properties (`afterSetState: (state) => { ... }`). Both run the same way, but method shorthand is required for the hook to type-check correctly against stores with derived state.

---

## Philosophy

### No complexity

There are no reducers, action types, decorators, or code generation. If you know JavaScript, you already know most of Stoic.

### Derived state is a first-class concept

Computed values belong in your store, not scattered across components as `useMemo` calls. Describe how values relate to each other once, and Stoic keeps them up to date.

### Keep the core small

The core only handles state, derived state, and actions. Persistence, logging, devtools, and history belong in plugins.

### Optimize by default

Dependency tracking, memoized derived values, and selective rerendering all happen automatically — you shouldn't need to think about performance for common use cases.

---

## FAQ

### Can I have multiple stores?

Yes. Create as many independent stores as your application needs:

```tsx
export const auth = createStore(/* ... */);
export const cart = createStore(/* ... */);
export const settings = createStore(/* ... */);
```

### Does Stoic work with Server Components?

Yes, but `useStore` relies on `useSyncExternalStore`, a hook — so any component that calls it needs the `"use client"` directive, the same requirement as every other React state library.

### What happens if my derived values depend on each other in a cycle?

Stoic throws a `CircularDependencyError` describing the cycle, instead of recomputing forever. See [Derived State](#derived-state) for the declaration-order rule that avoids this in the first place.

---

## Contributing

Issues, discussions, ideas, and pull requests are always welcome.

If Stoic makes your React code simpler, consider giving the project a ⭐️ on GitHub.

---

## License

MIT
