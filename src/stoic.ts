import { useRef, useSyncExternalStore } from "react";

type Listener<T> = (state: T) => void;

type DerivedConfig<T, D> = {
  [K in keyof D]: (state: T & D) => D[K];
};

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

export type SetState<T, Full = T> = (partial: Partial<T> | ((s: Full) => Partial<T>)) => void;
export type ActionCtx<T, Full = T> = {
  set: SetState<T, Full>;
  get: () => Full;
};
type SyncActionFn<T, Full, A extends unknown[]> = (ctx: ActionCtx<T, Full>, ...args: A) => void;
type AsyncActionFn<T, Full, A extends unknown[]> = (
  ctx: ActionCtx<T, Full>,
  ...args: A
) => Promise<void>;

export type ActionStatus = "idle" | "pending" | "success" | "error";
export type ActionMeta = { status: ActionStatus; error: unknown };

export type ActionHandle<A extends unknown[], R> = ((...args: A) => R) & {
  getMeta: () => ActionMeta;
  subscribeMeta: (listener: (meta: ActionMeta) => void) => () => void;
  useMeta: () => ActionMeta;
};

// biome-ignore lint/suspicious/noExplicitAny: args are inferred per entry; any is the only sound constraint for heterogeneous tuples
type ActionMap<T, Full> = Record<string, SyncActionFn<T, Full, any> | AsyncActionFn<T, Full, any>>;

// biome-ignore lint/suspicious/noExplicitAny: `get` makes ActionMap invariant in Full; any keeps the constraint satisfiable for every store type
type ActionHandlesFor<M extends ActionMap<any, any>, T, Full> = {
  [K in keyof M]: M[K] extends AsyncActionFn<T, Full, infer A>
    ? ActionHandle<A, Promise<void>>
    : M[K] extends SyncActionFn<T, Full, infer A>
      ? ActionHandle<A, void>
      : never;
};

export type StoicStore<T, Full = T> = {
  getState: () => Full;
  setState: SetState<T, Full>;
  subscribe: (listener: Listener<Full>) => () => void;
  actions<M extends ActionMap<T, Full>>(map: M): ActionHandlesFor<M, T, Full>;
  batch: <R>(fn: () => R) => R;
  destroy: () => void;
  useStore: <U = Full>(selector?: (state: Full) => U, equality?: (a: U, b: U) => boolean) => U;
};

export type ActionContext<Full = unknown> = {
  name: string;
  args: unknown[];
  state: Full;
};

export interface StoicPlugin<T extends object = object, Full extends object = T> {
  onInit?(store: StoicStore<T, Full>): void;
  beforeAction?(ctx: ActionContext<Full>): void;
  afterAction?(ctx: ActionContext<Full>): void;
  /**
   * `actionName` is the action whose `ctx.set` produced the change (also
   * across `await`s), or `undefined` for a direct `store.setState`. For a
   * batch it is the action behind the last state-changing write.
   */
  afterSetState?(state: Full, actionName?: string): void;
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

export function createStore<T extends object>(config: {
  state: T;
  derived?: undefined;
  plugins?: StoicPlugin<T, T>[];
}): StoicStore<T, T>;
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
      const tracked = new Proxy(snap as object, {
        get(target, prop) {
          // Receiver must be the snapshot (not the proxy) so a derived dep's
          // getter memoizes against the snapshot and its own transitive reads
          // are not recorded as this cell's deps.
          const value = Reflect.get(target, prop, target);
          if (typeof prop === "string") deps.push([prop, value]);
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

  const initialRaw = { ...config.state };
  let raw = { ...initialRaw };
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
  let batchActionName: string | undefined;

  // Guards against a plugin or subscriber calling setState from inside a
  // notification: one level of re-entrancy is legal but warned about (it
  // usually means derived state would express the relationship better);
  // unbounded recursion is cut off before it overflows the stack.
  const MAX_NOTIFY_DEPTH = 25;
  let notifyDepth = 0;

  const notify = (actionName?: string) => {
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
      runHooks("afterSetState", snapshot, actionName);
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
      return;
    }
    notify(currentActionName);
  };

  const batch = <R>(fn: () => R): R => {
    batchDepth++;
    try {
      return fn();
    } finally {
      if (--batchDepth === 0 && batchChanged) {
        batchChanged = false;
        const actionName = batchActionName;
        batchActionName = undefined;
        notify(actionName);
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
        const prev = currentActionName;
        currentActionName = name;
        try {
          setState(partial);
        } finally {
          currentActionName = prev;
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
