import { isDevEnv } from "./env";

export type Listener<T> = (state: T) => void;

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
  /**
   * Aborted when a newer call of this action starts, or when the store is
   * destroyed. Created lazily on first read — actions that never use it pay
   * nothing. Pass it to `fetch` (or check `signal.aborted`) to cancel stale
   * async work.
   */
  signal: AbortSignal;
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
 * its {@link ActionMeta} status. In React, read it with `useActionMeta`
 * from `stoic-store/react`.
 */
export type ActionHandle<A extends unknown[], R> = ((...args: A) => R) & {
  /** The meta of the most recent invocation. */
  getMeta: () => ActionMeta;
  /** Subscribes to meta changes; returns an unsubscribe function. */
  subscribeMeta: (listener: (meta: ActionMeta) => void) => () => void;
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
   * Aborts in-flight action signals, runs plugin `onDestroy` hooks, and drops
   * all listeners. Afterwards `setState` and `subscribe` are ignored (with a
   * dev warning).
   */
  destroy: () => void;
};

/** What `beforeAction`/`afterAction` hooks receive about the running action. */
export type ActionEvent<Full = unknown> = {
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
  beforeAction?(event: ActionEvent<Full>): void;
  /**
   * Called after every action settles — also when it throws or rejects, but
   * not when it settles after the store was destroyed (`onDestroy` has run
   * by then).
   */
  afterAction?(event: ActionEvent<Full>): void;
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

// Memoization state for the derived keys lives in parallel arrays indexed by a
// dense derived-key index rather than in one object per key: the prototype
// getter closes over its index, so a read is an element load instead of a
// string-keyed lookup that goes megamorphic once several stores exist.
//
// `deps[i]` records (key, value-at-compute-time) pairs — flattened as
// [k0, v0, k1, v1, …] — from the most recent compute. That compute is fresh
// for a snapshot when every recorded dep value is still `Object.is`-equal on
// it; reading a derived dep recurses through its own getter, so invalidation
// is transitive. The resolved value is pinned per snapshot as an own data
// property shadowing the shared prototype getter, so code holding an older
// snapshot reads a stable, correct value and repeat reads are plain property
// accesses.

// The internal contract between the core and the first-party plugins: the
// store carries its derived key list under a module-private symbol. Plugins
// can't inspect snapshot property descriptors instead — derived getters live
// on a shared prototype and self-memoize into plain data properties on read.
const DERIVED_KEYS = Symbol("stoic.derivedKeys");

// Each store's readDerived lives as a plain data property on a per-store
// intermediate prototype under this symbol, one hop below the shared getter
// prototype: snap → store proto (readDerived slot) → shared getter proto.
// The getters need nothing store-specific beyond the key index, so one getter
// prototype serves every store with the same derived key names, and neither
// snapshots nor writes ever carry a per-snapshot slot — the old design's
// non-enumerable defineProperty per snapshot took a slow attribute-transition
// path on every accepted write.
const READ_DERIVED = Symbol("stoic.readDerived");

type ReadDerived = (index: number, snap: object) => unknown;
type WithRead = { [READ_DERIVED]: ReadDerived };

// Keyed by the derived key names rather than by the `derived` config object.
// A factory that builds its config inline — every createStoreContext store,
// every per-request SSR store — hands createStore a fresh object every call and
// would never hit an identity-keyed cache, which made those stores rebuild the
// whole getter prototype from scratch. The getters depend on nothing except the
// key names and their order, so every store declaring the same derived keys can
// share one prototype. Bounded by the number of distinct derived key sets in
// the program. (An identity cache in front of this one was measured and lost:
// it costs a WeakMap store per created store, which the inline case — the one
// that needed help — pays without ever reading back.)
const PROTO_BY_NAMES = new Map<string, object>();

const protoFor = (derivedKeys: string[]): object => {
  // U+0000 cannot appear in a JS identifier and is vanishingly unlikely in a
  // computed key, so joining on it keeps distinct key sets distinct.
  const cacheKey = derivedKeys.join("\u0000");
  let proto = PROTO_BY_NAMES.get(cacheKey);
  if (proto === undefined) {
    const descriptors: PropertyDescriptorMap = {};
    for (let i = 0; i < derivedKeys.length; i++) {
      const index = i;
      descriptors[derivedKeys[i] as string] = {
        enumerable: true,
        configurable: true,
        get(this: WithRead) {
          return this[READ_DERIVED](index, this);
        },
      };
    }
    proto = Object.defineProperties({}, descriptors);
    PROTO_BY_NAMES.set(cacheKey, proto);
  }
  return proto;
};

// Pins a resolved derived value on the snapshot as an own data property,
// shadowing the prototype getter. Non-writable (like the getter it shadows);
// enumerable/configurable must be spelled out — this adds a property rather
// than reconfiguring one, so nothing carries over. The descriptor object is
// reused across pins and cleared after, so a pin allocates nothing and
// retains nothing (measured: writable/all-true attributes bought nothing —
// pin cost is dwarfed by the recompute around it).
// Shared, frozen meta singletons: every non-error outcome is one of these,
// so a sync action call allocates no meta objects at all. Error metas carry
// a per-call `error` and stay allocated.
const IDLE_META: ActionMeta = Object.freeze({ status: "idle", error: undefined });
const PENDING_META: ActionMeta = Object.freeze({ status: "pending", error: undefined });
const SUCCESS_META: ActionMeta = Object.freeze({ status: "success", error: undefined });

const PIN_DESC: PropertyDescriptor = {
  value: undefined,
  enumerable: true,
  configurable: true,
};
const pin = (snap: object, key: string, value: unknown) => {
  PIN_DESC.value = value;
  Object.defineProperty(snap, key, PIN_DESC);
  PIN_DESC.value = undefined;
};

const NOOP = () => {};

// `computeParent` slot values: IDLE when a derived key is not being computed,
// ROOT when its compute was started by a plain read rather than by another
// derived value. Anything else is the index of the compute that triggered it.
const IDLE = -2;
const ROOT = -1;

// Cold path — module level so it is not a closure allocated per store, and so
// the message-building code stays out of every store's context.
const cycleError = (
  keys: string[],
  parent: number[],
  innermost: number,
  index: number,
): CircularDependencyError => {
  const chain: string[] = [];
  for (let at = innermost; at !== ROOT; at = parent[at] as number) {
    chain.push(keys[at] as string);
    if (at === index) break;
  }
  chain.reverse();
  chain.push(keys[index] as string);
  return new CircularDependencyError(chain);
};

/**
 * @internal Not part of the public API. Returns a copy — the store keeps using
 * its own list, so a plugin cannot reorder or truncate it.
 */
export const derivedKeysOf = (store: object): readonly string[] => {
  const keys = (store as { [DERIVED_KEYS]?: readonly string[] })[DERIVED_KEYS];
  return keys === undefined ? [] : keys.slice();
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

  const isDev = isDevEnv();

  const derivedFns = (config.derived ?? {}) as Record<string, (s: Full) => unknown>;
  const derivedKeys = Object.keys(derivedFns);
  const hasDerived = derivedKeys.length > 0;
  // The state shape is fixed at creation: setState only applies these keys.
  // `initialState` doubles as the membership check (hasOwn beats a Set here —
  // no extra allocation at creation, same lookup cost per written key).
  const initialState = config.state as Record<string, unknown>;
  const rawKeys = Object.keys(config.state);
  for (const key of derivedKeys) {
    if (Object.hasOwn(config.state, key)) {
      throw new Error(
        `stoic: "${key}" is declared in both \`state\` and \`derived\`. The derived getter ` +
          "would shadow the state key, making it unreachable and unwritable — rename one of them.",
      );
    }
  }
  // Per-hook plugin lists, resolved once: the hot paths skip hook dispatch (and
  // the event-object allocation) entirely when no plugin implements a hook.
  // These lists are also the store's only reference to the plugins, so mutating
  // the caller's `plugins` array afterwards can't change hook dispatch.
  let afterSetStateHooks: StoicPlugin<T, Full>[] | null = null;
  let beforeActionHooks: StoicPlugin<T, Full>[] | null = null;
  let afterActionHooks: StoicPlugin<T, Full>[] | null = null;
  let destroyHooks: StoicPlugin<T, Full>[] | null = null;
  for (const p of config.plugins ?? []) {
    if (p.afterSetState) {
      afterSetStateHooks ??= [];
      afterSetStateHooks.push(p);
    }
    if (p.beforeAction) {
      beforeActionHooks ??= [];
      beforeActionHooks.push(p);
    }
    if (p.afterAction) {
      afterActionHooks ??= [];
      afterActionHooks.push(p);
    }
    if (p.onDestroy) {
      destroyHooks ??= [];
      destroyHooks.push(p);
    }
  }

  // Subscribers in dispatch order, with unsubscribed slots held as null until
  // it is safe to compact them away. Dispatching from an array rather than a
  // Set drops the iterator allocation every notification paid and makes each
  // step a single element load, which is what dominates once a real tree has a
  // few dozen subscribers. Unsubscribing stays immediate — a listener removed
  // mid-notification is skipped by the null check — at the cost of an indexOf
  // scan per unsubscribe, which happens orders of magnitude less often than
  // dispatch does.
  const subs: Listener<Full>[] = [];
  let liveSubs = 0;
  // Cleared slots are compacted away only between notifications, never while a
  // dispatch is walking the array.
  let dispatchDepth = 0;
  const compact = () => {
    if (dispatchDepth !== 0 || subs.length === liveSubs) return;
    let write = 0;
    for (let i = 0; i < subs.length; i++) {
      const fn = subs[i];
      if (fn !== NOOP) subs[write++] = fn as Listener<Full>;
    }
    subs.length = write;
  };
  // Controllers of in-flight action calls that read `ctx.signal`, so destroy()
  // can abort them all. Allocated on the first signal read.
  let activeControllers: Set<AbortController> | null = null;

  // Derived-only structures are never allocated for state-only stores; every
  // use is behind a hasDerived (or derived-read) path. Parallel arrays indexed
  // by derived-key index, so a read is an element load rather than a
  // string-keyed lookup on a shared dictionary.
  const dValue: unknown[] = hasDerived ? [] : (null as never);
  const dDeps: (unknown[] | null)[] = hasDerived ? [] : (null as never);
  const dFns: ((s: Full) => unknown)[] = hasDerived ? [] : (null as never);
  // Doubles as the cycle guard and as the chain used to describe a cycle once
  // one is found. One element load replaces the old per-cell `computing`
  // boolean *and* the string stack that existed only for the error message.
  const computeParent: number[] = hasDerived ? [] : (null as never);
  let computingNow = ROOT;

  // One pass, pushing into arrays that stay packed, rather than four
  // `new Array(n).fill(…)` calls plus a `.map` closure.
  for (let i = 0; i < derivedKeys.length; i++) {
    dValue.push(undefined);
    dDeps.push(null);
    dFns.push(derivedFns[derivedKeys[i] as string] as (s: Full) => unknown);
    computeParent.push(IDLE);
  }

  // One tracker object per store, retargeted around each compute via these
  // closure slots (computes nest when a derived fn reads another derived key,
  // so readDerived saves and restores them). The state shape is fixed at
  // creation, so every readable key is known up front and the tracker is a
  // plain object with one recording accessor per key — a monomorphic getter
  // call instead of a Proxy get trap on every read inside a derived fn.
  // Reads resolve against the snapshot, so a derived dep's getter memoizes
  // against the snapshot and its own transitive reads are not recorded as the
  // outer cell's deps. Built lazily on the first recompute; the dev-only
  // eager pass at creation triggers it there.
  let trackSnap: Record<string, unknown> = undefined as never;
  let trackDeps: unknown[] = undefined as never;
  let tracker: Full | null = null;
  const makeTracker = (): Full => {
    const descriptors: PropertyDescriptorMap = {};
    const recording = (key: string): PropertyDescriptor => ({
      enumerable: true,
      configurable: true,
      get() {
        const value = trackSnap[key];
        const deps = trackDeps;
        // Deduped by linear scan: dep counts are small, and a derived fn
        // that reads the same key in a loop must not bloat the record.
        for (let i = 0; i < deps.length; i += 2) {
          if (deps[i] === key) return value;
        }
        deps.push(key, value);
        return value;
      },
    });
    for (const key of rawKeys) descriptors[key] = recording(key);
    for (const key of derivedKeys) descriptors[key] = recording(key);
    return Object.defineProperties({}, descriptors) as Full;
  };

  const readDerived = (index: number, snap: Full): unknown => {
    const key = derivedKeys[index] as string;
    // The whole body runs under the cycle guard. Freshness checking can recurse
    // as readily as a recompute can — a derived dep is revalidated through its
    // own getter — so guarding only the recompute would let a cycle discovered
    // during revalidation run away.
    if (computeParent[index] !== IDLE) {
      throw cycleError(derivedKeys, computeParent, computingNow, index);
    }
    computeParent[index] = computingNow;
    const outer = computingNow;
    computingNow = index;
    try {
      const deps = dDeps[index];
      if (deps !== null) {
        // A recorded compute is reusable for any snapshot on which every dep it
        // read still has the same value — derived functions are pure, so that
        // is exactly the condition for the cached value to be correct here.
        let fresh = true;
        for (let i = 0; i < deps.length; i += 2) {
          if (!Object.is(deps[i + 1], (snap as Record<string, unknown>)[deps[i] as string])) {
            fresh = false;
            break;
          }
        }
        if (fresh) {
          const value = dValue[index];
          pin(snap, key, value);
          return value;
        }
      }

      const prevSnap = trackSnap;
      const prevDeps = trackDeps;
      trackSnap = snap as Record<string, unknown>;
      const recorded: unknown[] = [];
      trackDeps = recorded;
      if (tracker === null) tracker = makeTracker();
      let value: unknown;
      try {
        value = (dFns[index] as (s: Full) => unknown)(tracker);
      } catch (err) {
        // Keeps the invariant that `dDeps[i]`/`dValue[i]` always describe one
        // completed compute. Nothing observable depends on it today — a pure
        // derived function that throws for a given state throws again for that
        // same state, so the leftover record can only be reused where it would
        // have produced the same answer — but every cheaper freshness test
        // (a dirty bit, a version stamp) does depend on it, and the cost here
        // is a store on a path that is already unwinding.
        dDeps[index] = null;
        throw err;
      } finally {
        trackSnap = prevSnap;
        trackDeps = prevDeps;
      }

      // Only the live snapshot owns the shared memo. A read against a snapshot
      // someone is still holding computes and pins its own value but leaves the
      // record alone — otherwise it would retune the cell to an older state and
      // force the very next current-snapshot read to recompute.
      if ((snap as object) === (snapshot as object)) {
        dValue[index] = value;
        dDeps[index] = recorded;
      }
      pin(snap, key, value);
      return value;
    } finally {
      computeParent[index] = IDLE;
      computingNow = outer;
    }
  };

  // Per-store intermediate prototype: carries this store's readDerived under
  // the module symbol, one hop below the shared getter prototype. Costs a
  // fresh snapshot shape tree per store (~1µs at creation), which buys every
  // write out of the old per-snapshot defineProperty — a trade that pays for
  // itself within ~a dozen writes.
  let derivedProto: object | null = null;
  if (hasDerived) {
    derivedProto = Object.create(protoFor(derivedKeys));
    (derivedProto as WithRead)[READ_DERIVED] = readDerived as ReadDerived;
  }

  // The snapshot is the single source of truth — there is no separate raw
  // copy. Each accepted write builds the next snapshot in one pass; only
  // `rawKeys` are carried over, so pinned derived own-properties never leak
  // into the next snapshot.
  let snapshot = (
    derivedProto === null
      ? { ...config.state }
      : Object.assign(Object.create(derivedProto), config.state)
  ) as Full;
  let destroyed = false;

  // Derived values are lazy in development too. The eager pass that used to run
  // here surfaced a statically cyclic config at creation rather than on first
  // read, but it cost a full evaluation of every derived key per store and made
  // dev and production disagree about when derived functions run — including
  // how often, which made recompute assertions in user tests mode-dependent.
  // A cycle still throws, with the same chain in the message, on the read that
  // walks into it.

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
    // Reachable on a destroyed store via a batch flush (destroy() inside the
    // batch): listeners are already cleared, but plugins must not hear
    // afterSetState after their onDestroy ran.
    if (destroyed) return;
    if (notifyDepth > 0 && isDev) {
      console.warn(
        "stoic: re-entrant setState detected — a plugin or subscriber updated state while a " +
          "notification was in progress. Prefer derived state or batching over update loops.",
      );
    }
    if (notifyDepth >= MAX_NOTIFY_DEPTH) {
      throw new Error(
        "stoic: maximum update depth exceeded. A plugin or subscriber calls setState on every state change, creating an infinite update loop.",
      );
    }
    notifyDepth++;
    try {
      // A hook or listener may write state, which re-enters notify and delivers
      // the newer snapshot to *everyone*. When that happens this pass is over:
      // continuing it would hand the same final state a second time to whoever
      // is ordered after the writer (duplicate devtools entries, duplicate
      // persist writes). Snapshot identity is the signal — the core mints a new
      // object for every accepted write.
      const seen = snapshot;
      if (afterSetStateHooks !== null) {
        for (const p of afterSetStateHooks) {
          p.afterSetState?.(snapshot, actionName, actionArgs);
          if (snapshot !== seen) return;
        }
      }
      // Iterating a cached array rather than the Set avoids allocating a Set
      // iterator per notification, and it fixes the dispatch list for the
      // duration of this pass: a listener subscribed by another listener
      // belongs to the next change, not this one. Removal still takes effect
      // immediately — a component unmounting mid-notification must not be
      // called — so each entry is re-checked against the live Set.
      // The length is read once: a listener subscribed by another listener
      // belongs to the next change, not to this one.
      dispatchDepth++;
      try {
        const n = subs.length;
        for (let i = 0; i < n; i++) {
          (subs[i] as Listener<Full>)(snapshot);
          if (snapshot !== seen) return;
        }
      } finally {
        dispatchDepth--;
        compact();
      }
    } finally {
      notifyDepth--;
    }
  };

  const setState: SetState<T, Full> = (partial) => {
    if (destroyed) {
      if (isDev) console.warn("stoic: setState called on a destroyed store; ignored");
      return;
    }
    const next = typeof partial === "function" ? partial(snapshot) : partial;
    // Writing the current snapshot back is a no-op by definition, and the
    // `for…in` below would otherwise walk the snapshot's prototype chain and
    // evaluate every derived getter on it just to reject each one. An *older*
    // snapshot is not a no-op and deliberately still goes the long way.
    if ((next as unknown) === snapshot) return;

    const snap = snapshot as Record<string, unknown>;
    let nextSnap: Record<string, unknown> | null = null;
    // No own-key guard on the partial: the membership check against
    // `initialState` below already rejects anything that isn't a state key,
    // so inherited enumerable keys can't smuggle values in — they are either
    // state keys (applied, as an own read would be) or ignored.
    for (const key in next) {
      if (!Object.hasOwn(initialState, key)) {
        // Derived keys were never writable; unknown keys are rejected because
        // the state shape is fixed at creation (keeps every snapshot on one
        // hidden class and the derived dep records exhaustive).
        if (isDev) {
          console.warn(
            derivedKeys.indexOf(key) !== -1
              ? `stoic: setState ignored derived key "${key}"; derived values are computed`
              : `stoic: setState ignored unknown key "${key}"; the state shape is fixed by \`state\` at creation`,
          );
        }
        continue;
      }
      const value = (next as Record<string, unknown>)[key];
      if (!Object.is(snap[key], value)) {
        if (nextSnap === null) {
          if (derivedProto === null) {
            nextSnap = { ...snap };
          } else {
            // Copy only rawKeys (never pins), reading from the old snapshot.
            nextSnap = Object.create(derivedProto) as Record<string, unknown>;
            for (let i = 0; i < rawKeys.length; i++) {
              const k = rawKeys[i] as string;
              nextSnap[k] = snap[k];
            }
          }
        }
        nextSnap[key] = value;
      }
    }
    if (nextSnap === null) return;

    snapshot = nextSnap as Full;

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
      if (isDev) console.warn("stoic: subscribe called on a destroyed store; ignored");
      return NOOP;
    }
    subs.push(listener);
    liveSubs++;
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const at = subs.indexOf(listener);
      if (at !== -1) subs[at] = NOOP;
      liveSubs--;
      compact();
    };
  };

  const createActionRunner = (name: string, fn: (...args: unknown[]) => unknown) => {
    let meta: ActionMeta = IDLE_META;
    // Meta tracks the most recent invocation: a stale call settling later must
    // not overwrite the outcome of a newer one.
    let latestCall = 0;
    let metaListeners: Set<(meta: ActionMeta) => void> | null = null;
    // Controller of the newest in-flight call that read `ctx.signal`; the next
    // call aborts it. Cleared on settle so a finished call is never aborted.
    let currentController: AbortController | null = null;

    const setMeta = (callId: number, next: ActionMeta) => {
      if (callId !== latestCall) return;
      if (meta.status === next.status && meta.error === next.error) return;
      meta = next;
      if (metaListeners !== null) {
        for (const l of metaListeners) l(meta);
      }
    };

    // One context class per runner: call contexts are monomorphic instances
    // with the `signal` accessor on the prototype instead of a fresh accessor
    // object per invocation. `set` and `get` stay per-call/closure functions
    // because actions destructure them off the context.
    class CallCtx implements ActionCtx<T, Full> {
      callId: number;
      args: unknown[];
      // Lazy: allocated only when the action reads `ctx.signal`.
      controller: AbortController | null = null;
      // Attribution wraps each write, not the action body: only writes made
      // through this action's `set` are credited to it, and the credit
      // survives `await`s and overlapping actions.
      set: SetState<T, Full> = (partial) => {
        const prevName = currentActionName;
        const prevArgs = currentActionArgs;
        currentActionName = name;
        currentActionArgs = this.args;
        try {
          setState(partial);
        } finally {
          currentActionName = prevName;
          currentActionArgs = prevArgs;
        }
      };
      get = getState;

      constructor(callId: number, args: unknown[]) {
        this.callId = callId;
        this.args = args;
      }

      get signal(): AbortSignal {
        let controller = this.controller;
        if (controller === null) {
          controller = new AbortController();
          this.controller = controller;
          if (this.callId === latestCall && !destroyed) {
            currentController = controller;
            activeControllers ??= new Set();
            activeControllers.add(controller);
          } else {
            // A newer call has already started (or the store is gone), so
            // this call is stale by the abort contract: its signal is born
            // aborted, and it must not take the abort slot from the newest
            // in-flight call.
            controller.abort();
          }
        }
        return controller.signal;
      }

      // A prototype method, not a per-call closure: everything per-call it
      // needs lives on `this`, the rest comes from the runner's scope.
      settle(outcome: ActionMeta) {
        const controller = this.controller;
        if (controller !== null && currentController === controller) {
          activeControllers?.delete(controller);
          currentController = null;
        }
        // Not after destroy: onDestroy already ran, so plugins must not be
        // observed again. Meta still settles — handles outlive the store.
        if (afterActionHooks !== null && !destroyed) {
          const event: ActionEvent<Full> = { name, args: this.args, state: snapshot };
          for (const p of afterActionHooks) p.afterAction?.(event);
        }
        setMeta(this.callId, outcome);
      }
    }

    const runner = (...args: unknown[]) => {
      if (currentController !== null) {
        activeControllers?.delete(currentController);
        const previous = currentController;
        currentController = null;
        previous.abort();
      }

      // Not after destroy: onDestroy already ran, mirroring afterAction below.
      if (beforeActionHooks !== null && !destroyed) {
        const event: ActionEvent<Full> = { name, args, state: snapshot };
        for (const p of beforeActionHooks) p.beforeAction?.(event);
      }

      const callId = ++latestCall;
      setMeta(callId, PENDING_META);

      const ctx = new CallCtx(callId, args);

      let result: unknown;
      try {
        result = fn(ctx, ...args);
      } catch (err) {
        ctx.settle({ status: "error", error: err });
        throw err;
      }

      if (result instanceof Promise) {
        return result.then(
          (value) => {
            ctx.settle(SUCCESS_META);
            return value;
          },
          (err) => {
            ctx.settle({ status: "error", error: err });
            throw err;
          },
        );
      }
      ctx.settle(SUCCESS_META);
      return result;
    };

    runner.getMeta = () => meta;
    runner.subscribeMeta = (listener: (meta: ActionMeta) => void) => {
      metaListeners ??= new Set();
      const set = metaListeners;
      set.add(listener);
      return () => set.delete(listener);
    };

    return runner;
  };

  // Dev-only bookkeeping: the registry exists purely to power the duplicate-
  // registration warning, so production never allocates or grows the Set.
  let registeredActionNames: Set<string> | null = null;
  const actions = ((map: Record<string, (...args: unknown[]) => unknown>) => {
    const result: Record<string, unknown> = {};
    for (const [name, fn] of Object.entries(map)) {
      if (isDev) {
        registeredActionNames ??= new Set();
        if (registeredActionNames.has(name)) {
          console.warn(
            `stoic: action "${name}" is already registered on this store. Each actions() call ` +
              "builds new handles with fresh, independent status meta — create handles once " +
              "(at module or factory level) and reuse them.",
          );
        }
        registeredActionNames.add(name);
      }
      result[name] = createActionRunner(name, fn);
    }
    return result;
  }) as StoicStore<T, Full>["actions"];

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    if (activeControllers !== null) {
      for (const controller of activeControllers) controller.abort();
      activeControllers.clear();
    }
    if (destroyHooks !== null) {
      for (const p of destroyHooks) p.onDestroy?.();
    }
    // Retire the slots rather than truncating: destroy() is reachable from
    // inside a listener, and the dispatch loop above is holding a length it
    // read before this ran. compact() drops them once no dispatch is walking.
    for (let i = 0; i < subs.length; i++) subs[i] = NOOP;
    liveSubs = 0;
    compact();
  };

  // The symbol sits in the literal so the store object gets its final shape
  // in one step instead of a post-literal transition; symbol keys stay out of
  // Object.keys/JSON either way.
  const store: StoicStore<T, Full> = {
    getState,
    setState,
    subscribe,
    actions,
    batch,
    destroy,
    [DERIVED_KEYS]: derivedKeys,
  } as StoicStore<T, Full>;

  for (const p of config.plugins ?? []) p.onInit?.(store);

  return store;
}
