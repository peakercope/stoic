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
<a href="#batching">Batching</a> •
<a href="#plugins">Plugins</a> •
<a href="#per-instance-stores">Per-instance Stores</a> •
<a href="#testing">Testing</a> •
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

Stoic requires React 18 or later (it uses `useSyncExternalStore`). The package is published as **ESM only** — every modern bundler and Node 18+ consume it as-is, but legacy CommonJS-only toolchains are not supported.

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

You can also pass any custom `(a, b) => boolean` function instead of `shallow`. `shallow` compares plain objects and arrays one level deep and Maps/Sets by size and membership; other objects (Dates, class instances) are only equal by reference.

### Lint-friendly hook bindings

ESLint's `react-hooks` rules only recognize hooks called as plain `useXxx(...)` identifiers, so method-style calls like `cart.useStore(...)` are invisible to them. The store's hooks don't rely on `this`, so bind them once and export identifier-style hooks:

```tsx
export const useCart = cart.useStore;

// In components — now checked by rules-of-hooks:
const total = useCart((state) => state.total);
```

The same works for action meta: `export const useLoadUserMeta = loadUser.useMeta`.

---

## Actions

Actions update the store. Instead of dispatching action objects, you call a plain function:

```tsx
setTax(0.15);
```

Every action receives a context as its first argument, followed by whatever arguments you call it with. The context has two members:

* `set` — updates state. Accepts either a partial state object or an updater function that reads the current state.
* `get` — returns the current state (including derived values), useful for reading mid-action.

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

---

## Async Actions

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

### Overlapping calls and stale responses

Stoic does not cancel async work. If the same action is called again while a previous call is still in flight, **both** calls' `set`s land — the slower response can overwrite the faster one. The meta status always reflects the *most recent* call, but state writes are on you. Use `get` to drop a stale result:

```tsx
const { selectUser } = search.actions({
  selectUser: async ({ set, get }, login: string) => {
    set({ selected: login });
    const profile = await api.fetchProfile(login);

    // Another user was selected while this fetch was in flight — drop it.
    if (get().selected !== login) return;

    set({ profile });
  },
});
```

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

Derived values can depend on each other, too. Extending the cart example with a discount (note the two type parameters — `createStore<State, Derived>` — which derived stores need; see [TypeScript](#typescript) below):

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

### What dependency tracking sees

Tracking is **per top-level state key**. A derived function that reads `s.items` depends on the `items` *reference* — Stoic does not watch inside arrays or objects. Two rules follow:

1. **Update state immutably.** Mutating an array in place (`s.items.push(...)`) keeps the same reference, so nothing downstream recomputes. Every example in this README produces a new array/object instead.
2. **Read inputs as properties** (`s.count`); dependency tracking doesn't see `Object.keys(s)` or `"count" in s`.

Derived values are computed **lazily**: a derived key does its work the first time it's read after a relevant change, and the result is memoized until a dependency actually changes. Declaration order doesn't matter — a derived key can freely read another derived key declared before or after it; reads resolve recursively through the dependency graph. (The one exception to laziness: every derived key is evaluated once at store creation, so a statically cyclic configuration fails immediately.)

> Derived functions should be **pure** — no side effects, no reading clocks or randomness. An impure derived value only recomputes when its tracked dependencies change, so anything else it reads goes stale silently.

> If two derived keys end up depending on each other in a cycle, Stoic throws a `CircularDependencyError` describing the cycle — at store creation if the cycle is always present, or on the read of the cyclic value if it only appears for certain states.

---

## TypeScript

State-only stores infer everything from the config object. Stores with **derived state need both type parameters spelled out** — `createStore<State, Derived>` — because a derived function's argument includes the derived values themselves, which TypeScript cannot infer while it is still inferring them:

```tsx
type State = { count: number };
type Derived = { doubled: number };

const store = createStore<State, Derived>({
  state: { count: 1 },
  derived: { doubled: (s) => s.count * 2 },
});
```

Everything downstream — `useStore` selectors, action arguments, `get()` inside actions — is inferred from there; no further annotations are needed. The types you may want to import: `StoicStore<State, Full>` to pass a store around, `SetState`, `ActionCtx`, and `StoicPlugin` to write plugins.

---

## Batching

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

Reads made *during* a batch (e.g. `store.getState()` from inside another action) always see fully consistent state — raw and derived values agree at every point.

> `batch` is synchronous: the batch ends when the callback returns, so `async` work inside the callback isn't deferred past the first `await`. Batch each synchronous chunk of an async flow instead.

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

Every entry in the DevTools log is tagged with the name of the action that produced it (`setTax`, `addItem`, ...) and carries the arguments that action was called with, under `args`:

```jsonc
// addItem("a1", 2)
{ "type": "addItem", "args": ["a1", 2] }
```

`args` is always an array, so a no-argument action sends `[]`. A `setState` call made outside of an action shows up as `"anonymous"` with no `args` — there's no action, so there are no arguments. Arguments are sent as-is: the extension serializes them on receipt, so unserializable values (DOM events, class instances) are rendered as best it can. Time-travel (jumping to a past state, resetting, importing a state) is applied back to the store automatically. `devtools` accepts:

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
| `version` | `number` | — | Schema version of the persisted state (see below). |
| `migrate` | `(persisted, version) => Partial<T>` | — | Upgrade an older payload to the current shape. |

`include` and `exclude` are mutually exclusive. A pending debounced write is flushed immediately if the store is destroyed. If storage is unavailable (the default `localStorage` doesn't exist on a server, for example), the plugin disables itself with a single console warning instead of failing on every write.

```tsx
persist({
  key: "settings",
  exclude: ["loading", "error"], // don't persist transient fields
  debounceMs: 250,               // batch rapid updates into one write
});
```

#### Versioning and migrations

State shapes change between releases. Set `version`, and when a stored payload was written by an older version, `migrate` receives it (as deserialized) together with the version that wrote it and returns state in the current shape:

```tsx
persist<Settings>({
  key: "settings",
  version: 2,
  migrate: (persisted, version) => {
    const old = persisted as Record<string, unknown>;
    if (version < 2) {
      // v1 stored a single `name`; v2 splits it.
      const [firstName = "", lastName = ""] = String(old.name ?? "").split(" ");
      return { firstName, lastName };
    }
    return old as Partial<Settings>;
  },
});
```

With `version` set, payloads are stored as a `{ version, state }` envelope — with the default serializer, `state` is stored as a plain JSON value, so what's in storage stays human-readable; a custom `serialize`'s output is embedded as a string. A payload written before versioning was enabled is treated as version `0`. If the versions differ and no `migrate` is provided, the stored state is discarded (with a console warning) rather than hydrated into the wrong shape.

#### Derived state is never persisted

[Derived values](#derived-state) are recomputed from your raw state on every load, so `persist` never writes them, and ignores any it finds in stored data when rehydrating. You don't need to list them in `exclude` — naming one in `include` throws, since the request can't be honored.

This matters when a derived function changes. If old derived values were restored from storage, they would only be recomputed once one of their dependencies changed — so a user whose raw state hadn't moved would keep seeing values computed by the *previous* version of your code. Recomputing on load avoids that entirely.

If you want a value persisted and *not* recomputed, it isn't derived state — put it in `state`.

### Writing a plugin

A plugin is an object implementing any of the `StoicPlugin` lifecycle hooks. Hooks only observe state — they can't transform it:

* `onInit(store)` — called once when the store is created. (In development, React StrictMode double-invokes store factories, so `onInit` can also run for a store that is immediately discarded and never destroyed — side effects here should tolerate that.)
* `beforeAction(ctx)` / `afterAction(ctx)` — called around every action call, with `{ name, args, state }`. `afterAction` still runs if the action throws or rejects.
* `afterSetState(state, actionName?, actionArgs?)` — called after every update that changed something, with the full merged state. `actionName` is the name of the action whose `set` produced the change (correct even across `await`s and overlapping async actions) and `actionArgs` are the arguments it was called with; both are `undefined` for a direct `store.setState`. During a [`batch`](#batching), the hook fires once when the batch closes, reporting the action behind the last state-changing write — so `persist` writes once and `devtools` logs one combined entry per batch.
* `onDestroy()` — called when `store.destroy()` is called.

> Don't call `setState` from inside `afterSetState` or a subscriber — that's an update loop. Stoic warns in development on re-entrant updates and throws once the recursion exceeds a safety limit. If one value should follow another, express it as derived state instead.

> A subscriber or hook that throws stops later subscribers from being notified for that update, and the error propagates to whoever called `setState` (or the action's `set`). Keep subscribers exception-safe.

A plugin that needs to tell raw state apart from derived values (as `persist` does) can inspect the snapshot: derived keys are exposed as enumerable getter properties, raw keys as plain data properties — `Object.getOwnPropertyDescriptor(store.getState(), key)?.get` is set exactly for derived keys, and checking it doesn't trigger any computation.

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

## Per-instance stores

Everything above creates the store at module level — one store per JavaScript process. In the browser that's exactly right, and it's the pattern you should reach for by default.

It breaks down when **one process serves several independent trees**:

* **Server rendering.** An SSR server is long-lived and handles many users concurrently. A module-level store is shared by every request, so one user's state can leak into another user's render.
* **Repeated widgets.** Two instances of the same component that each need their own store.
* **Tests.** Each test wants a clean store, without resetting a shared one.

`createStoreContext` builds a React Context around a store factory, so each mounted `Provider` gets its own store:

```tsx
import { createStore, createStoreContext } from "stoic-store";

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

The factory returns **both** the store and its actions. Action handles close over the store they were created from, so they have to be built per instance — doing it here binds them once and keeps their identity, and their `useMeta` status, stable across renders.

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
  const { status } = loadCart.useMeta();

  if (status === "pending") return <Spinner />;
  return <button onClick={() => addItem(monitor)}>Total: ${total}</button>;
}
```

| Returned | What it is |
| --- | --- |
| `Provider` | Creates one store per mount. `init` is read on the first render only — like a `defaultValue`, changing it later won't rebuild the store. The prop is required exactly when the factory can't be called without it. |
| `useStore(selector?, equality?)` | Identical to `store.useStore`, resolved from context. |
| `useActions()` | This instance's action handles. Stable across renders. |
| `useStoreApi()` | The `StoicStore` itself, for `getState` / `subscribe` / `batch` outside of render. |

The store is destroyed when its `Provider` unmounts, so plugins get their `onDestroy` (a pending debounced `persist` write is flushed). This is StrictMode-safe: React's mount → unmount → mount cycle in development does not tear down the store.

Inside React's [`<Activity>`](https://react.dev/reference/react/Activity) (React 19.2+), hiding a subtree behaves like an unmount for the store: it is destroyed — flushing plugins — and a fresh one is created when the subtree is revealed. In-memory state does not survive a hide; pair the store with `persist` if it should.

---

## Testing

Two patterns cover most test setups.

**Reset a module-level store between tests.** A store created at module level is shared across tests in the same file. Define a reset action next to the store, and call it in your test setup:

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

**One store per test.** If your stores are behind [`createStoreContext`](#per-instance-stores), each `render` with a fresh `Provider` gets an isolated store — nothing to reset:

```tsx
render(
  <Provider init={fixtureItems}>
    <Cart />
  </Provider>,
);
```

Assertions against the store outside of components work through the plain API: `store.getState()`, `store.subscribe`, or calling actions directly — none of them need React.

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

### Can I use module-level stores with server-side rendering?

Only for request-independent data. A store created at module level is a **singleton per JavaScript process**. In the browser that's exactly what you want; on an SSR server it means every request shares the same store, so one user's state can leak into another's render.

If you render on the server and put per-user data in a store, create it per request with [`createStoreContext`](#per-instance-stores) instead.

### Does Stoic work with concurrent rendering?

Yes. `useStore` is built on `useSyncExternalStore`, React's sanctioned way to read external stores without tearing. As with every uSES-based library an external-store update de-opts that render to synchronous — the standard trade-off React makes for consistency.

### What happens if my derived values depend on each other in a cycle?

Stoic throws a `CircularDependencyError` describing the cycle, instead of recomputing forever — at store creation when the cycle is always present, or on the read of the cyclic value when it only appears for certain states.

---

## Contributing

Issues, discussions, ideas, and pull requests are always welcome.

If Stoic makes your React code simpler, consider giving the project a ⭐️ on GitHub.

---

## License

MIT
