# API Reference

- [`stoic-store`](#stoic-store)
- [`stoic-store/react`](#stoic-storereact)
- [`stoic-store/plugins`](#stoic-storeplugins)
- [`stoic-store/tools`](#stoic-storetools)
- [Types](#types)

## `stoic-store`

The core entry. **React-free** — safe to import anywhere, including React Server Components.

### `createStore(config)`

```ts
function createStore<T extends object>(config: {
  state: T;
  plugins?: StoicPlugin<T, T>[];
}): StoicStore<T, T>;

function createStore<T extends object, D extends object>(config: {
  state: T;
  derived: { [K in keyof D]: (state: T & D) => D[K] };
  plugins?: StoicPlugin<T, T & D>[];
}): StoicStore<T, T & D>;
```

Builds a store. Stores with derived state need both type parameters spelled out — see [TypeScript](./typescript.md).

Throws if `state` and `derived` share a key, or if the derived config is cyclic (see [`CircularDependencyError`](#circulardependencyerror)).

### The store

| Member | What it does |
| --- | --- |
| `getState()` | Returns the current state, including derived values. |
| `setState(partial)` | Merges a partial state — or the result of an updater `(state) => partial` — and notifies subscribers. Derived keys are ignored with a dev warning. |
| `subscribe(listener)` | Calls `listener(state)` after every change; returns an unsubscribe function. |
| `actions(map)` | Turns a map of `(ctx, ...args)` functions into callable [action handles](./actions.md). |
| `batch(fn)` | Runs `fn`, coalescing all notifications into one (see [Batching](./batching.md)). |
| `destroy()` | Aborts in-flight action signals, runs plugin `onDestroy` hooks, and drops all listeners. |

After `destroy()`, `setState` and `subscribe` are no-ops with a development warning.

### Action handles

`store.actions(map)` returns one handle per entry. A handle is the callable function itself, plus:

| Member | What it does |
| --- | --- |
| `getMeta()` | The current [`ActionMeta`](#types) — the status of the most recent call. |
| `subscribeMeta(listener)` | Calls `listener(meta)` when the meta changes; returns an unsubscribe function. |

### `CircularDependencyError`

Thrown when derived values depend on each other in a cycle, with a message describing the cycle — at store creation if the cycle is always present, or on the read of the cyclic value if it only appears for certain states.

## `stoic-store/react`

### `useStore(store, selector?, equality?)`

```ts
function useStore<Full extends object, U = Full>(
  store: { getState: () => Full; subscribe: (l: (s: Full) => void) => () => void },
  selector?: (state: Full) => U,
  equality?: (a: U, b: U) => boolean,
): U;
```

Subscribes the component to `store`. Without a selector it returns the full state; with one, only changes to the selected value rerender. `equality` defaults to `Object.is`. See [Reading State](./reading-state.md).

### `useActionMeta(action)`

```ts
function useActionMeta(action: {
  getMeta: () => ActionMeta;
  subscribeMeta: (l: (meta: ActionMeta) => void) => () => void;
}): ActionMeta;
```

Subscribes the component to an action handle's status. See [Tracking status](./actions.md#tracking-status).

### `createStoreContext(factory)`

```ts
function createStoreContext<T extends object, Full extends object, A, P = void>(
  factory: (init: P) => { store: StoicStore<T, Full>; actions: A },
): {
  Provider: (props: { children?: ReactNode; init?: P }) => ReactElement;
  useStore: <U = Full>(selector?: (state: Full) => U, equality?: (a: U, b: U) => boolean) => U;
  useActions: () => A;
  useStoreApi: () => StoicStore<T, Full>;
};
```

One store per mounted `Provider`. The `init` prop is required exactly when the factory's parameter cannot be `undefined`. See [Per-instance Stores](./per-instance-stores.md).

## `stoic-store/plugins`

| Export | Signature |
| --- | --- |
| [`persist`](./plugins/persist.md) | `persist<T>(options): PersistPlugin<T>` — saves state to storage and restores it on load. |
| [`devtools`](./plugins/devtools.md) | `devtools<T, Full>(options?): StoicPlugin<T, Full>` — Redux DevTools integration. |
| `webStorage` | `webStorage(getStorage?: () => Storage): PersistDriver` — the default driver; `localStorage` unless you pass another `Storage`. |

Types: `PersistDriver`, `PersistPlugin`.

`PersistPlugin<T>` is a `StoicPlugin<T, T>` plus `rehydrate(): void`, which reads storage and merges the stored state into the store now (for [`skipHydration`](./plugins/persist.md#server-rendering-and-manual-hydration) setups).

```ts
interface PersistDriver {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): unknown | Promise<unknown>;
  subscribe?(key: string, onChange: (value: string | null) => void): () => void;
}
```

Full option tables: [`persist`](./plugins/persist.md#options), [`devtools`](./plugins/devtools.md#options).

## `stoic-store/tools`

### `shallow(a, b)`

```ts
function shallow<T>(a: T, b: T): boolean;
```

The one-level-deep equality helper for object-returning selectors. Compares plain objects and arrays one level deep and Maps/Sets by size and membership; other objects (Dates, RegExps, class instances) are only equal by reference. See [Equality functions](./reading-state.md#equality-functions).

## Types

All exported from `stoic-store`.

```ts
type Listener<T> = (state: T) => void;

type SetState<T, Full = T> = (partial: Partial<T> | ((state: Full) => Partial<T>)) => void;

type ActionStatus = "idle" | "pending" | "success" | "error";

type ActionMeta = { status: ActionStatus; error: unknown };

/** The context an action receives as its first argument. */
type ActionCtx<T, Full = T> = {
  set: SetState<T, Full>;
  get: () => Full;
  signal: AbortSignal;
};

/** What plugin `beforeAction` / `afterAction` hooks receive. */
type ActionContext<Full = unknown> = {
  name: string;
  args: unknown[];
  state: Full;
};

type ActionHandle<A extends unknown[], R> = ((...args: A) => R) & {
  getMeta: () => ActionMeta;
  subscribeMeta: (listener: (meta: ActionMeta) => void) => () => void;
};

type StoicStore<T, Full = T> = {
  getState: () => Full;
  setState: SetState<T, Full>;
  subscribe: (listener: Listener<Full>) => () => void;
  actions: (map) => /* action handles */;
  batch: <R>(fn: () => R) => R;
  destroy: () => void;
};

interface StoicPlugin<T extends object = object, Full extends object = T> {
  onInit?(store: StoicStore<T, Full>): void;
  beforeAction?(ctx: ActionContext<Full>): void;
  afterAction?(ctx: ActionContext<Full>): void;
  afterSetState?(state: Full, actionName?: string, actionArgs?: readonly unknown[]): void;
  onDestroy?(): void;
}
```

`Full` is state **and** derived values; `T` is the raw state alone. See [Writing a plugin](./plugins/writing-a-plugin.md) for the hooks in detail.
