# Stoic Documentation

Stoic is a small state management library for React, built on `useSyncExternalStore`. You define state and actions much like you would with any store library, but Stoic also lets you declare **derived state** — values computed from other state — as part of the store itself.

New here? Read [Installation](./installation.md), then [Quick Start](./quick-start.md), then [Core Concepts](./core-concepts.md).

## Getting started

| Page | What it covers |
| --- | --- |
| [Installation](./installation.md) | Installing the package, requirements, and the four entry points. |
| [Quick Start](./quick-start.md) | Build your first store, read it in a component, update it with actions. |
| [Core Concepts](./core-concepts.md) | The four building blocks and the snapshot model behind them. |

## Guides

| Page | What it covers |
| --- | --- |
| [Reading State](./reading-state.md) | `useStore`, selectors, equality functions, `shallow`, wrapper hooks. |
| [Actions](./actions.md) | Sync and async actions, the action context, status tracking, cancellation. |
| [Derived State](./derived-state.md) | Declaring derived values, dependency tracking, and circular dependencies. |
| [Batching](./batching.md) | Coalescing several updates into a single notification with `store.batch`. |
| [Per-instance Stores](./per-instance-stores.md) | `createStoreContext` for SSR, repeated widgets, and tests. |
| [TypeScript](./typescript.md) | Type inference, when to spell out type parameters, exported types. |
| [Testing](./testing.md) | Resetting a module-level store, one store per test, asserting outside React. |

## Plugins

| Page | What it covers |
| --- | --- |
| [Plugins overview](./plugins/README.md) | What a plugin is and what it can do. |
| [`devtools`](./plugins/devtools.md) | Redux DevTools integration and time travel. |
| [`persist`](./plugins/persist.md) | Storage, drivers, cross-tab sync, SSR hydration, migrations. |
| [Writing a plugin](./plugins/writing-a-plugin.md) | The `StoicPlugin` lifecycle hooks. |

## Reference

| Page | What it covers |
| --- | --- |
| [API Reference](./api-reference.md) | Every export of every entry point, with signatures. |
| [FAQ](./faq.md) | Multiple stores, Server Components, SSR, concurrent rendering. |
| [Philosophy](./philosophy.md) | The principles behind the library's design. |

Runnable examples live in [`examples/`](../examples).
