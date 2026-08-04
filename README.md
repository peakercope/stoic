# <p align="center">Stoic</p>

<p align="center">
  <img src="./docs/assets/image.png" width="240" alt="Stoic mascot">
</p>

<p align="center">
<strong>Tiny React state manager with reactive derived state.</strong>
</p>

<p align="center">
No reducers • No dependency arrays • No boilerplate • Fully typed • Plugin-based
</p>

<p align="center">
<a href="https://www.npmjs.com/package/stoic-store"><img alt="npm version" src="https://img.shields.io/npm/v/stoic-store.svg" /></a>
<a href="https://github.com/peakercope/stoic/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/peakercope/stoic/actions/workflows/ci.yml/badge.svg" /></a>
<a href="./docs/installation.md"><img alt="2.4 kB gzipped" src="https://img.shields.io/badge/core-2.4%20kB%20gzip-blue" /></a>
<a href="./docs/typescript.md"><img alt="TypeScript types included" src="https://img.shields.io/badge/types-included-blue" /></a>
<a href="./LICENSE"><img alt="MIT license" src="https://img.shields.io/npm/l/stoic-store.svg" /></a>
</p>

<p align="center">
<a href="./docs/quick-start.md">Quick Start</a> •
<a href="./docs/core-concepts.md">Core Concepts</a> •
<a href="./docs/derived-state.md">Derived State</a> •
<a href="./docs/api-reference.md">API Reference</a> •
<a href="./docs">Documentation</a>
</p>

---

Stoic is a small state management library for React, built on `useSyncExternalStore`. You define state and actions much like you would with any store library, but Stoic also lets you declare **derived state** — values computed from other state — as part of the store itself.

The key difference from most state managers: Stoic tracks the relationships between your state automatically. When something changes, only the derived values that actually depend on it are recomputed, and only the components reading those values rerender. There are no dependency arrays to maintain.

* ⚡️ Plain function actions — no dispatch, no action types
* 🧠 Reactive derived state with automatic dependency tracking
* 🚀 First-class async actions, with built-in pending/error status and `AbortSignal` cancellation
* 🔌 A small plugin system (`persist` and `devtools` are included; write your own for the rest)
* 💙 Fully typed, with state and action arguments inferred by your editor

## Installation

```bash
npm install stoic-store
```

Requires React 18+. Published as ESM only. See [Installation](./docs/installation.md).

## Usage

```ts
import { createStore } from "stoic-store";

type State = { items: CartItem[]; tax: number };
type Derived = { subtotal: number; total: number };

export const cart = createStore<State, Derived>({
  state: {
    items: [{ id: 1, title: "Keyboard", price: 100 }],
    tax: 0.2,
  },

  derived: {
    subtotal: ({ items }) => items.reduce((sum, item) => sum + item.price, 0),
    total: ({ subtotal, tax }) => subtotal * (1 + tax),
  },
});

export const { addItem } = cart.actions({
  addItem: ({ set }, item: CartItem) => {
    set((s) => ({ items: [...s.items, item] }));
  },
});
```

Read it in a component — it only rerenders when `total` changes:

```tsx
import { useStore } from "stoic-store/react";

function CartSummary() {
  const total = useStore(cart, (state) => state.total);

  return <h2>Total: ${total}</h2>;
}
```

And update it by calling the action like a regular function:

```tsx
addItem({ id: 2, title: "Mouse", price: 50 });
```

`subtotal` and `total` recompute automatically whenever `items` or `tax` change — you never write that logic yourself.

## Why Stoic

Most React state managers give you a store and leave computed values to you — so `subtotal` ends up
as a `useMemo` in one component, a selector in another, and a hand-maintained dependency array in
both. Stoic's premise is that a value computed from state belongs *in* the store, declared once,
with the dependency graph worked out for you.

That's the whole pitch: **one store object, plain-function actions, and declared derived state with
automatic dependency tracking — in 2.4 kB gzipped, with no runtime dependencies.**

**Stoic is a good fit if** you have real computed state (totals, filtered lists, aggregate stats),
you want it typed end to end, and you'd rather have one store per domain than a graph of atoms.

**Reach for something else if** you want the smallest possible store and don't need derived state
([Zustand](https://github.com/pmndrs/zustand) is smaller); you prefer bottom-up, atom-level
granularity ([Jotai](https://github.com/pmndrs/jotai)); you want to mutate state directly
([Valtio](https://github.com/pmndrs/valtio)); or you need middleware and conventions
of a large app framework ([Redux Toolkit](https://redux-toolkit.js.org/)).

Two honest trade-offs, up front:

- **Derived stores need their types spelled out** — `createStore<State, Derived>`. This is a
  TypeScript limitation, not a temporary one; [the reasoning is
  documented](./docs/typescript.md#why-derived-cant-be-inferred).
- **Dependency tracking is per top-level key and compares by reference**, so mutating state in place
  (`state.items.push(x)`) won't recompute anything. Replace, don't mutate.

## Documentation

Full documentation lives in [`docs/`](./docs).

| | |
| --- | --- |
| **Getting started** | [Installation](./docs/installation.md) · [Quick Start](./docs/quick-start.md) · [Core Concepts](./docs/core-concepts.md) |
| **Guides** | [Reading State](./docs/reading-state.md) · [Actions](./docs/actions.md) · [Derived State](./docs/derived-state.md) · [Batching](./docs/batching.md) · [Per-instance Stores](./docs/per-instance-stores.md) · [TypeScript](./docs/typescript.md) · [Testing](./docs/testing.md) |
| **Plugins** | [Overview](./docs/plugins/README.md) · [`devtools`](./docs/plugins/devtools.md) · [`persist`](./docs/plugins/persist.md) · [Writing a plugin](./docs/plugins/writing-a-plugin.md) |
| **Reference** | [API Reference](./docs/api-reference.md) · [FAQ](./docs/faq.md) · [Versioning](./docs/versioning.md) · [Philosophy](./docs/philosophy.md) |

Runnable applications are in [`examples/`](./examples): a shopping cart, a GitHub user search, and a kanban board. Run `yarn build` at the repository root first — they resolve Stoic from `dist/`.

## Contributing

Issues, discussions, ideas, and pull requests are always welcome — open one on the [issue tracker](https://github.com/peakercope/stoic/issues).

If you're sending a pull request, [`CONTRIBUTING.md`](./CONTRIBUTING.md) covers setup, the commands, and what a change is expected to come with (tests, a changeset, and a benchmark if you touched a hot path).

If Stoic makes your React code simpler, consider giving the project a ⭐️ on GitHub.

## License

[MIT](./LICENSE) © peakercope
