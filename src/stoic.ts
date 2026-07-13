import { useRef, useSyncExternalStore } from "react";

type Listener<T> = (state: T) => void;

type DerivedConfig<T, D> = {
  [K in keyof D]: (state: T & D) => D[K];
};

/**
 * Thrown when derived values depend on each other in a cycle — at store
 * creation when the cycle is always present, or on the read of the cyclic
 * value when it only appears for certain states. The message spells out the
 * dependency chain.
 */
export class CircularDependencyError extends Error {
  constructor(cycle: string[]) {
    super(`Circular dependency detected:\n${cycle.join(" → ")}`);
    this.name = "CircularDependencyError";
  }
}

const warn = (message: string) => {
  const nodeProcess = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process;
  if (nodeProcess?.env?.NODE_ENV !== "production") console.warn(message);
};

/**
 * Merges a partial state — or the result of an updater that receives the
 * current state, derived values included — into the store. Only raw state
 * keys can be written; derived keys are computed and ignored with a warning.
 */
export type SetState<T, Full = T> = (partial: Partial<T> | ((s: Full) => Partial<T>)) => void;

/** The first argument every action receives. */
export type ActionCtx<T, Full = T> = {
  /** Updates state, attributing the write to this action (also across `await`s). */
  set: SetState<T, Full>;
  /** Returns the current state, including derived values. */
  get: () => Full;
};
type ActionFn<T, Full, A extends unknown[], R> = (ctx: ActionCtx<T, Full>, ...args: A) => R;

export type ActionStatus = "idle" | "pending" | "success" | "error";

/**
 * Lifecycle of an action's most recent invocation. `error` is set only while
 * `status` is `"error"`. When calls overlap, the meta always reflects the
 * newest call — a stale call settling later never overwrites it.
 */
export type ActionMeta = { status: ActionStatus; error: unknown };

/**
 * A callable action, as returned by `store.actions`. Call it like the
 * function it wraps (minus the context argument); the extra members expose
 * its {@link ActionMeta} status.
 */
export type ActionHandle<A extends unknown[], R> = ((...args: A) => R) & {
  /** The meta of the most recent invocation. */
  getMeta: () => ActionMeta;
  /** Subscribes to meta changes; returns an unsubscribe function. */
  subscribeMeta: (listener: (meta: ActionMeta) => void) => () => void;
  /** React hook: subscribes the component to this action's meta. */
  useMeta: () => ActionMeta;
};

// biome-ignore lint/suspicious/noExplicitAny: args are inferred per entry; any is the only sound constraint for heterogeneous tuples
type ActionMap<T, Full> = Record<string, ActionFn<T, Full, any, unknown>>;

// biome-ignore lint/suspicious/noExplicitAny: `get` makes ActionMap invariant in Full; any keeps the constraint satisfiable for every store type
type ActionHandlesFor<M extends ActionMap<any, any>, T, Full> = {
  [K in keyof M]: M[K] extends ActionFn<T, Full, infer A, infer R> ? ActionHandle<A, R> : never;
};

export type StoicStore<T, Full = T> = {
  /** Returns the current state, including derived values. */
  getState: () => Full;
  /** Merges a partial state (or an updater's result) and notifies listeners. */
  setState: SetState<T, Full>;
  /**
   * Calls `listener` with the new state after every change; returns an
   * unsubscribe function. A listener that throws stops later listeners from
   * being notified and the error propagates to the `setState` caller.
   */
  subscribe: (listener: Listener<Full>) => () => void;
  /**
   * Turns a map of `(ctx, ...args)` functions into callable
   * {@link ActionHandle}s. Create handles once at module (or factory) level —
   * each call builds new handles with fresh, independent meta.
   */
  actions<M extends ActionMap<T, Full>>(map: M): ActionHandlesFor<M, T, Full>;
  /**
   * Runs `fn`, deferring listener notifications until it returns, so several
   * writes coalesce into one notification. Synchronous only: an `await`
   * inside the callback escapes the batch.
   */
  batch: <R>(fn: () => R) => R;
  /**
   * Runs plugin `onDestroy` hooks and drops all listeners. Afterwards
   * `setState` and `subscribe` are ignored (with a dev warning).
   */
  destroy: () => void;
  /**
   * React hook: subscribes the component to the store. Without arguments it
   * returns the full state (re-rendering on every change); with a `selector`
   * only changes to the selected value re-render, compared by `equality`
   * (default `Object.is` — pass `shallow` from `stoic-store/tools` for
   * object-literal selectors). Detachable: `const useCart = cart.useStore`
   * gives lint-friendly identifier-style hooks.
   */
  useStore: <U = Full>(selector?: (state: Full) => U, equality?: (a: U, b: U) => boolean) => U;
};

/** What `beforeAction`/`afterAction` hooks receive about the running action. */
export type ActionContext<Full = unknown> = {
  name: string;
  args: unknown[];
  state: Full;
};

/**
 * Lifecycle hooks observing a store; pass instances via `createStore`'s
 * `plugins`. Hooks observe state — they cannot transform it. Define hooks
 * with method shorthand (`afterSetState(state) {}`), not arrow-function
 * properties, so they type-check against stores with derived state.
 */
export interface StoicPlugin<T extends object = object, Full extends object = T> {
  /**
   * Called once when the store is created. Note that React StrictMode
   * double-invokes store factories in development, so `onInit` can run for a
   * store that is immediately discarded and never destroyed.
   */
  onInit?(store: StoicStore<T, Full>): void;
  /** Called before every action invocation. */
  beforeAction?(ctx: ActionContext<Full>): void;
  /** Called after every action settles — also when it throws or rejects. */
  afterAction?(ctx: ActionContext<Full>): void;
  /**
   * `actionName` is the action whose `ctx.set` produced the change (also
   * across `await`s), or `undefined` for a direct `store.setState`. For a
   * batch it is the action behind the last state-changing write.
   * `actionArgs` are the arguments that action was invoked with, attributed
   * the same way; `undefined` for a direct `store.setState`.
   */
  afterSetState?(state: Full, actionName?: string, actionArgs?: readonly unknown[]): void;
  /** Called when `store.destroy()` runs. */
  onDestroy?(): void;
}

const UNSET = Symbol("stoic.unset");

// One memoization cell per derived key, shared across snapshots. `deps` records
// (key, value-at-compute-time) pairs from the most recent compute; that compute
// is fresh for a snapshot when every recorded dep value is still `Object.is`-
// equal on that snapshot (reading a derived dep recurses through its own
// getter, so invalidation is transitive). `cache` pins the resolved value per
// snapshot, so code holding an older snapshot reads a stable, correct value
// without thrashing the shared dep record.
type Cell = {
  value: unknown;
  deps: [key: string, value: unknown][] | null;
  cache: WeakMap<object, unknown>;
  computing: boolean;
};

/**
 * Creates a store from initial `state`, optional `derived` values, and
 * optional `plugins`. State-only stores infer everything from the config.
 */
export function createStore<T extends object>(config: {
  state: T;
  derived?: undefined;
  plugins?: StoicPlugin<T, T>[];
}): StoicStore<T, T>;
/**
 * Creates a store with derived state. Spell out both type parameters —
 * `createStore<State, Derived>` — because a derived function's argument
 * includes the derived values themselves, which TypeScript cannot infer
 * while it is still inferring them. Derived functions must be pure; each is
 * recomputed only when a top-level state key it read actually changes.
 */
export function createStore<T extends object, D extends object>(config: {
  state: T;
  derived: DerivedConfig<T, D>;
  plugins?: StoicPlugin<T, T & D>[];
}): StoicStore<T, T & D>;
export function createStore<T extends object, D extends object = Record<never, never>>(config: {
  state: T;
  derived?: DerivedConfig<T, D> | undefined;
  plugins?: StoicPlugin<T, T & D>[] | undefined;
}) {
  type Full = T & D;

  const derivedFns = (config.derived ?? {}) as Record<string, (s: Full) => unknown>;
  const derivedKeys = Object.keys(derivedFns);
  const plugins = config.plugins ?? [];
  const listeners = new Set<Listener<Full>>();

  const runHooks = <K extends keyof StoicPlugin<T, Full>>(
    hook: K,
    ...args: Parameters<NonNullable<StoicPlugin<T, Full>[K]>>
  ) => {
    for (const p of plugins) {
      (p[hook] as ((...a: typeof args) => void) | undefined)?.(...args);
    }
  };

  const cells: Record<string, Cell> = {};
  for (const key of derivedKeys) {
    cells[key] = {
      value: undefined,
      deps: null,
      cache: new WeakMap(),
      computing: false,
    };
  }
  // Path of derived keys currently being computed, for cycle error messages.
  const computeStack: string[] = [];

  const readDerived = (key: string, snap: Full): unknown => {
    const cell = cells[key] as Cell;
    if (cell.cache.has(snap)) return cell.cache.get(snap);
    if (cell.computing) {
      throw new CircularDependencyError([...computeStack.slice(computeStack.indexOf(key)), key]);
    }
    // The guard covers revalidation too: reading a derived dep below recurses
    // into its getter, and a conditional flip can only form a cycle through a
    // recompute, which lands back here.
    cell.computing = true;
    computeStack.push(key);
    try {
      if (cell.deps !== null) {
        let fresh = true;
        for (const [depKey, depValue] of cell.deps) {
          if (!Object.is(depValue, (snap as Record<string, unknown>)[depKey])) {
            fresh = false;
            break;
          }
        }
        if (fresh) {
          cell.cache.set(snap, cell.value);
          return cell.value;
        }
      }

      const deps: [string, unknown][] = [];
      // Deduped: a derived fn that reads the same key in a loop must not bloat
      // the dep record (every entry is re-read on each freshness check). The
      // snapshot is immutable, so repeat reads see the same value anyway.
      const seen = new Set<string>();
      const tracked = new Proxy(snap as object, {
        get(target, prop) {
          // Receiver must be the snapshot (not the proxy) so a derived dep's
          // getter memoizes against the snapshot and its own transitive reads
          // are not recorded as this cell's deps.
          const value = Reflect.get(target, prop, target);
          if (typeof prop === "string" && !seen.has(prop)) {
            seen.add(prop);
            deps.push([prop, value]);
          }
          return value;
        },
      });
      cell.value = (derivedFns[key] as (s: Full) => unknown)(tracked as Full);
      cell.deps = deps;
      cell.cache.set(snap, cell.value);
      return cell.value;
    } finally {
      cell.computing = false;
      computeStack.pop();
    }
  };

  // Shared descriptors: the getter resolves against `this`, so one map serves
  // every snapshot.
  const descriptors: PropertyDescriptorMap = {};
  for (const key of derivedKeys) {
    descriptors[key] = {
      enumerable: true,
      configurable: true,
      get(this: Full) {
        return readDerived(key, this);
      },
    };
  }

  const makeSnapshot = (raw: T): Full => {
    const snap = { ...raw } as Full;
    if (derivedKeys.length > 0) Object.defineProperties(snap, descriptors);
    return snap;
  };

  let raw = { ...config.state };
  let snapshot = makeSnapshot(raw);
  let destroyed = false;

  // Evaluate every derived key once so a statically cyclic config fails at
  // creation instead of on first read.
  for (const key of derivedKeys) readDerived(key, snapshot);

  const getState = () => snapshot;

  let batchDepth = 0;
  let batchChanged = false;
  // Action attribution: set synchronously around each `ctx.set` call, so a
  // write is credited to its action even after an `await` or when actions
  // overlap. `batchActionName` carries it across a deferred batch flush.
  let currentActionName: string | undefined;
  let currentActionArgs: readonly unknown[] | undefined;
  let batchActionName: string | undefined;
  let batchActionArgs: readonly unknown[] | undefined;

  // Guards against a plugin or subscriber calling setState from inside a
  // notification: one level of re-entrancy is legal but warned about (it
  // usually means derived state would express the relationship better);
  // unbounded recursion is cut off before it overflows the stack.
  const MAX_NOTIFY_DEPTH = 25;
  let notifyDepth = 0;

  const notify = (actionName?: string, actionArgs?: readonly unknown[]) => {
    if (notifyDepth > 0) {
      warn(
        "stoic: re-entrant setState detected — a plugin or subscriber updated state while a " +
          "notification was in progress. Prefer derived state or batching over update loops.",
      );
    }
    if (notifyDepth >= MAX_NOTIFY_DEPTH) {
      throw new Error(
        "stoic: maximum update depth exceeded. A plugin or subscriber calls setState on every " +
          "state change, creating an infinite update loop.",
      );
    }
    notifyDepth++;
    try {
      runHooks("afterSetState", snapshot, actionName, actionArgs);
      listeners.forEach((l) => {
        l(snapshot);
      });
    } finally {
      notifyDepth--;
    }
  };

  const setState: SetState<T, Full> = (partial) => {
    if (destroyed) {
      warn("stoic: setState called on a destroyed store; ignored");
      return;
    }
    const next = typeof partial === "function" ? partial(snapshot) : partial;

    let nextRaw: T | null = null;
    for (const key of Object.keys(next)) {
      if (Object.hasOwn(cells, key)) {
        warn(`stoic: setState ignored derived key "${key}"; derived values are computed`);
        continue;
      }
      const value = (next as Record<string, unknown>)[key];
      if (!Object.is((raw as Record<string, unknown>)[key], value)) {
        if (nextRaw === null) nextRaw = { ...raw };
        (nextRaw as Record<string, unknown>)[key] = value;
      }
    }
    if (nextRaw === null) return;

    raw = nextRaw;
    snapshot = makeSnapshot(raw);

    if (batchDepth > 0) {
      batchChanged = true;
      batchActionName = currentActionName;
      batchActionArgs = currentActionArgs;
      return;
    }
    notify(currentActionName, currentActionArgs);
  };

  const batch = <R>(fn: () => R): R => {
    batchDepth++;
    try {
      return fn();
    } finally {
      if (--batchDepth === 0 && batchChanged) {
        batchChanged = false;
        const actionName = batchActionName;
        const actionArgs = batchActionArgs;
        batchActionName = undefined;
        batchActionArgs = undefined;
        notify(actionName, actionArgs);
      }
    }
  };

  const subscribe = (listener: Listener<Full>) => {
    if (destroyed) {
      warn("stoic: subscribe called on a destroyed store; ignored");
      return () => {};
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const createActionRunner = (name: string, fn: (...args: unknown[]) => unknown) => {
    let meta: ActionMeta = { status: "idle", error: undefined };
    // Meta tracks the most recent invocation: a stale call settling later must
    // not overwrite the outcome of a newer one.
    let latestCall = 0;
    const metaListeners = new Set<(meta: ActionMeta) => void>();

    const setMeta = (callId: number, next: ActionMeta) => {
      if (callId !== latestCall) return;
      if (meta.status === next.status && meta.error === next.error) return;
      meta = next;
      metaListeners.forEach((l) => {
        l(meta);
      });
    };

    const runner = (...args: unknown[]) => {
      runHooks("beforeAction", { name, args, state: getState() });

      const callId = ++latestCall;
      setMeta(callId, { status: "pending", error: undefined });

      const settle = (outcome: ActionMeta) => {
        runHooks("afterAction", { name, args, state: getState() });
        setMeta(callId, outcome);
      };

      // Attribution wraps each write, not the action body: only writes made
      // through this action's `set` are credited to it, and the credit
      // survives `await`s and overlapping actions.
      const set: SetState<T, Full> = (partial) => {
        const prevName = currentActionName;
        const prevArgs = currentActionArgs;
        currentActionName = name;
        currentActionArgs = args;
        try {
          setState(partial);
        } finally {
          currentActionName = prevName;
          currentActionArgs = prevArgs;
        }
      };

      let result: unknown;
      try {
        result = fn({ set, get: getState }, ...args);
      } catch (err) {
        settle({ status: "error", error: err });
        throw err;
      }

      if (result instanceof Promise) {
        return result.then(
          (value) => {
            settle({ status: "success", error: undefined });
            return value;
          },
          (err) => {
            settle({ status: "error", error: err });
            throw err;
          },
        );
      }
      settle({ status: "success", error: undefined });
      return result;
    };

    runner.getMeta = () => meta;
    runner.subscribeMeta = (listener: (meta: ActionMeta) => void) => {
      metaListeners.add(listener);
      return () => metaListeners.delete(listener);
    };
    runner.useMeta = () =>
      useSyncExternalStore(runner.subscribeMeta, runner.getMeta, runner.getMeta);

    return runner;
  };

  const actions = ((map: Record<string, (...args: unknown[]) => unknown>) => {
    const result: Record<string, unknown> = {};
    for (const [name, fn] of Object.entries(map)) {
      result[name] = createActionRunner(name, fn);
    }
    return result;
  }) as StoicStore<T, Full>["actions"];

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    runHooks("onDestroy");
    listeners.clear();
  };

  function useStore<U = Full>(
    selector: (state: Full) => U = (s) => s as unknown as U,
    equality: (a: U, b: U) => boolean = Object.is,
  ) {
    // Sentinel-gated so the selector doesn't run on every render just to
    // produce a discarded useRef initializer.
    const selectedRef = useRef<U | typeof UNSET>(UNSET);
    if (selectedRef.current === UNSET) selectedRef.current = selector(snapshot);

    // React calls the snapshot functions repeatedly and compares the results with
    // `Object.is`, so an object-literal selector must return the *same* reference
    // until the selection actually changes. This applies to the server snapshot
    // too: returning a fresh object there makes React bail out with "The result of
    // getServerSnapshot should be cached to avoid an infinite loop" on hydration.
    const read = () => {
      const next = selector(snapshot);

      if (!equality(selectedRef.current as U, next)) {
        selectedRef.current = next;
      }

      return selectedRef.current as U;
    };

    return useSyncExternalStore(subscribe, read, read);
  }

  const store: StoicStore<T, Full> = {
    useStore,
    getState,
    setState,
    subscribe,
    actions,
    batch,
    destroy,
  };

  runHooks("onInit", store);

  return store;
}
