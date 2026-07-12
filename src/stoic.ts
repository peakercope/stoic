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

function findDerivedDependencyCycle(
  derivedKeys: string[],
  dependencies: Map<string, Set<string>>,
): string[] | null {
  const derivedKeySet = new Set(derivedKeys);
  const status = new Map<string, "visiting" | "done">();
  const path: string[] = [];

  const visit = (node: string): string[] | null => {
    status.set(node, "visiting");
    path.push(node);

    for (const dep of dependencies.get(node) ?? []) {
      if (!derivedKeySet.has(dep)) continue;
      const depStatus = status.get(dep);
      if (depStatus === "visiting") {
        return [...path.slice(path.indexOf(dep)), dep];
      }
      if (depStatus === undefined) {
        const found = visit(dep);
        if (found) return found;
      }
    }

    path.pop();
    status.set(node, "done");
    return null;
  };

  for (const key of derivedKeys) {
    if (!status.has(key)) {
      const cycle = visit(key);
      if (cycle) return cycle;
    }
  }
  return null;
}

export type SetState<T, Full = T> = (partial: Partial<T> | ((s: Full) => Partial<T>)) => void;
type SyncActionFn<T, Full, A extends unknown[]> = (setState: SetState<T, Full>, ...args: A) => void;
type AsyncActionFn<T, Full, A extends unknown[]> = (
  setState: SetState<T, Full>,
  ...args: A
) => Promise<void>;

export type ActionStatus = "idle" | "pending" | "success" | "error";
export type ActionMeta = { status: ActionStatus; error: unknown };

type ActionHandle<A extends unknown[], R> = ((...args: A) => R) & {
  getMeta: () => ActionMeta;
  subscribeMeta: (listener: (meta: ActionMeta) => void) => () => void;
};

type ActionMap<T, Full> = Record<string, SyncActionFn<T, Full, any> | AsyncActionFn<T, Full, any>>;

type ActionHandlesFor<M extends ActionMap<unknown, unknown>, T, Full> = {
  [K in keyof M]: M[K] extends AsyncActionFn<T, Full, infer A>
    ? ActionHandle<A, Promise<void>>
    : M[K] extends SyncActionFn<T, Full, infer A>
      ? ActionHandle<A, void>
      : never;
};

export const STOIC_INTERNAL = Symbol("stoic.internal");

export interface StoicBatchControls {
  begin(): void;
  end(): void;
}

export interface StoicInternals {
  batch: StoicBatchControls;
  derivedKeys: readonly string[];
}

export type StoicStore<T, Full = T> = {
  getState: () => Full;
  setState: SetState<T, Full>;
  subscribe: (listener: Listener<Full>) => () => void;
  actions<M extends ActionMap<T, Full>>(map: M): ActionHandlesFor<M, T, Full>;
  destroy: () => void;
  // Not part of the public API: internal escape hatches for stoic-store's own
  // tools/plugins (e.g. `batch()`) without every consumer seeing them.
  [STOIC_INTERNAL]: StoicInternals;
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
  beforeSetState?(nextState: Partial<T>): void;
  afterSetState?(state: Full): void;
  onDestroy?(): void;
}

function internal__createStore<T extends object, D extends object = Record<never, never>>(config: {
  state: T;
  derived?: DerivedConfig<T, D> | undefined;
  plugins?: StoicPlugin<T, T & D>[] | undefined;
}): StoicStore<T, T & D> {
  type Full = T & D;

  let state = { ...config.state } as Full;
  const derivedEntries = Object.entries(config.derived ?? {}) as [string, (s: Full) => unknown][];
  const derivedKeys = derivedEntries.map(([key]) => key);
  const plugins = config.plugins ?? [];

  const runHooks = <K extends keyof StoicPlugin<T, Full>>(
    hook: K,
    ...args: Parameters<NonNullable<StoicPlugin<T, Full>[K]>>
  ) => {
    for (const p of plugins) {
      (p[hook] as ((...a: typeof args) => void) | undefined)?.(...args);
    }
  };

  const listeners = new Set<Listener<Full>>();

  const dependencies = new Map<string, Set<string>>();

  // Plugins are fixed for the store's lifetime, so this is computed once.
  const hasAfterSetStateHook = plugins.some((p) => typeof p.afterSetState === "function");
  const isObserved = () => hasAfterSetStateHook || listeners.size > 0;

  // Raw keys changed since the last flush while unobserved; null = nothing pending.
  let pendingDirty: Set<string> | null = null;

  // >0 while a `batch()` call (from stoic-store/tools) is in progress. Setting
  // this makes setState/getState behave as if the store were unobserved, so
  // recompute and notification only happen once the outermost batch ends.
  let batchDepth = 0;

  const sameDeps = (prev: Set<string> | undefined, next: Set<string>) => {
    if (prev === undefined || prev.size !== next.size) return false;
    for (const key of prev) {
      if (!next.has(key)) return false;
    }
    return true;
  };

  const recomputeDerived = (dirty: Set<string> | null) => {
    let depsChanged = false;
    // One proxy per pass; `state` is only reassigned between passes, and the
    // target must stay the live state object so spread/ownKeys work in
    // derived functions. `trackedKeys` is swapped per entry.
    let trackedKeys!: Set<string>;
    let proxiedState: Full | undefined;

    for (const [key, fn] of derivedEntries) {
      const deps = dependencies.get(key);
      let mustRun = dirty === null || deps === undefined;
      if (!mustRun) {
        for (const d of deps as Set<string>) {
          if ((dirty as Set<string>).has(d)) {
            mustRun = true;
            break;
          }
        }
      }

      if (!mustRun) continue;

      proxiedState ??= new Proxy(state, {
        get(target, prop, receiver) {
          if (typeof prop === "string") trackedKeys.add(prop);
          return Reflect.get(target, prop, receiver);
        },
      });
      trackedKeys = new Set<string>();

      const prevValue = (state as Record<string, unknown>)[key];
      const newValue = fn(proxiedState);
      if (!depsChanged && !sameDeps(deps, trackedKeys)) depsChanged = true;
      dependencies.set(key, trackedKeys);

      (state as Record<string, unknown>)[key] = newValue;

      if (dirty !== null && !Object.is(prevValue, newValue)) {
        dirty.add(key);
      }
    }

    // A cycle can only appear when some dependency set actually changed, so
    // the DFS is skipped for steady-state recomputation.
    if (depsChanged) {
      const cycle = findDerivedDependencyCycle(derivedKeys, dependencies);
      if (cycle) throw new CircularDependencyError(cycle);
    }
  };

  recomputeDerived(null);

  // Coalesces derived recomputation deferred while the store was unobserved.
  // Any CircularDependencyError that only manifests via a deferred write is
  // thrown here instead of from the setState call that caused it.
  const flush = () => {
    if (pendingDirty === null) return;
    const dirty = pendingDirty;
    pendingDirty = null;
    try {
      recomputeDerived(dirty);
    } catch (err) {
      // Re-stash so a later flush retries: recomputation is idempotent, and
      // dropping the dirty set would leave dependents stale forever.
      pendingDirty = dirty;
      throw err;
    }
  };

  const notify = () => {
    runHooks("afterSetState", state);
    listeners.forEach((l) => {
      l(state);
    });
  };

  const getState = () => {
    if (batchDepth === 0) flush();
    return state;
  };

  const beginBatch = () => {
    batchDepth++;
  };

  const endBatch = () => {
    batchDepth--;
    // pendingDirty is non-null iff some setState ran while deferred; a batch
    // that never wrote has nothing to recompute or announce.
    if (batchDepth > 0 || !isObserved() || pendingDirty === null) return;

    flush();
    notify();
  };

  const setState: SetState<T, Full> = (partial) => {
    // getState (not the raw variable) so the functional form sees flushed
    // derived values even when recomputation was deferred while unobserved.
    const next = typeof partial === "function" ? partial(getState()) : partial;

    runHooks("beforeSetState", next);

    const prevState = state;
    state = { ...state, ...next };

    if (pendingDirty === null) pendingDirty = new Set();
    for (const key of Object.keys(next)) {
      if (
        !Object.is(
          (prevState as Record<string, unknown>)[key],
          (state as Record<string, unknown>)[key],
        )
      ) {
        pendingDirty.add(key);
      }
    }

    if (batchDepth === 0 && isObserved()) {
      flush();
      notify();
    }
  };

  const subscribe = (listener: Listener<Full>) => {
    const wasObserved = isObserved();
    listeners.add(listener);
    if (!wasObserved) flush();
    return () => listeners.delete(listener);
  };

  const createActionRunner = (name: string, fn: (...args: unknown[]) => unknown) => {
    let meta: ActionMeta = { status: "idle", error: undefined };
    // Overlapping calls: stay "pending" until the last one settles, then
    // report that settle's outcome.
    let inflight = 0;
    const metaListeners = new Set<(meta: ActionMeta) => void>();

    const setMeta = (next: ActionMeta) => {
      if (meta.status === next.status && meta.error === next.error) return;
      meta = next;
      metaListeners.forEach((l) => {
        l(meta);
      });
    };

    const runner = (...args: unknown[]) => {
      const ctx: ActionContext<Full> = { name, args, state: getState() };
      runHooks("beforeAction", ctx);

      const finish = () => {
        runHooks("afterAction", { name, args, state: getState() });
      };

      inflight++;
      setMeta({ status: "pending", error: undefined });

      const settle = (outcome: ActionMeta) => {
        finish();
        if (--inflight === 0) setMeta(outcome);
      };

      let result: unknown;
      try {
        result = fn(setState, ...args);
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
    runHooks("onDestroy");
    listeners.clear();
  };

  const store = {
    getState,
    setState,
    subscribe,
    actions,
    destroy,
    [STOIC_INTERNAL]: { batch: { begin: beginBatch, end: endBatch }, derivedKeys },
  };

  runHooks("onInit", store);

  return store;
}

const UNSET = Symbol("stoic.unset");

type UseStore<Full> = <U = Full>(
  selector?: (state: Full) => U,
  equality?: (a: U, b: U) => boolean,
) => U;

type ActionHandleWithHook<A extends unknown[], R> = ActionHandle<A, R> & {
  useMeta: () => ActionMeta;
};

type ActionHandlesWithHookFor<M extends ActionMap<unknown, unknown>, T, Full> = {
  [K in keyof M]: M[K] extends AsyncActionFn<T, Full, infer A>
    ? ActionHandleWithHook<A, Promise<void>>
    : M[K] extends SyncActionFn<T, Full, infer A>
      ? ActionHandleWithHook<A, void>
      : never;
};

type StoicHookedStore<T, Full> = Omit<StoicStore<T, Full>, "actions"> & {
  useStore: UseStore<Full>;
  actions<M extends ActionMap<T, Full>>(map: M): ActionHandlesWithHookFor<M, T, Full>;
};

export function createStore<T extends object>(config: {
  state: T;
  derived?: undefined;
  plugins?: StoicPlugin<T, T>[];
}): StoicHookedStore<T, T>;
export function createStore<T extends object, D extends object>(config: {
  state: T;
  derived: DerivedConfig<T, D>;
  plugins?: StoicPlugin<T, T & D>[];
}): StoicHookedStore<T, T & D>;
export function createStore<T extends object, D extends object = Record<never, never>>(config: {
  state: T;
  derived?: DerivedConfig<T, D> | undefined;
  plugins?: StoicPlugin<T, T & D>[] | undefined;
}) {
  const store = internal__createStore(config);

  type Full = T & D;

  function useStore<U = Full>(
    selector: (state: Full) => U = (s) => s as unknown as U,
    equality: (a: U, b: U) => boolean = Object.is,
  ) {
    // Sentinel-gated so the selector doesn't run on every render just to
    // produce a discarded useRef initializer.
    const selectedRef = useRef<U | typeof UNSET>(UNSET);
    if (selectedRef.current === UNSET) selectedRef.current = selector(store.getState());

    // React calls the snapshot functions repeatedly and compares the results with
    // `Object.is`, so an object-literal selector must return the *same* reference
    // until the selection actually changes. This applies to the server snapshot
    // too: returning a fresh object there makes React bail out with "The result of
    // getServerSnapshot should be cached to avoid an infinite loop" on hydration.
    const read = () => {
      const next = selector(store.getState());

      if (!equality(selectedRef.current as U, next)) {
        selectedRef.current = next;
      }

      return selectedRef.current as U;
    };

    return useSyncExternalStore(store.subscribe, read, read);
  }

  const actions = ((map: Record<string, (...args: unknown[]) => unknown>) => {
    const runners = (
      store.actions as (
        map: Record<string, (...args: unknown[]) => unknown>,
      ) => Record<string, ActionHandle<unknown[], unknown>>
    )(map);
    for (const runner of Object.values(runners)) {
      (runner as ActionHandleWithHook<unknown[], unknown>).useMeta = () =>
        useSyncExternalStore(runner.subscribeMeta, runner.getMeta, runner.getMeta);
    }
    return runners;
  }) as StoicHookedStore<T, Full>["actions"];

  return {
    useStore,
    getState: store.getState,
    setState: store.setState,
    subscribe: store.subscribe,
    actions,
    destroy: store.destroy,
    [STOIC_INTERNAL]: store[STOIC_INTERNAL],
  };
}
