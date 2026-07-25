import { DEV } from "./env";

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
  constructor(cycle: string[], hint = "") {
    super(`Circular dependency detected:\n${cycle.join(" → ")}${hint}`);
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
// is transitive. This state describes the live snapshot only — see readDerived.
//
// Resolved values are then memoized per snapshot (the `#memo` field on the
// snapshot class), which is what makes a snapshot immutable in practice:
// whatever value it produced for a derived key once is the value it produces
// forever, however much the store has moved on since.

// The internal contract between the core and the first-party plugins: the
// store carries its derived key list under a module-private symbol. Plugins
// can't inspect snapshot property descriptors instead — derived getters live
// on a shared prototype and resolve into a private field.
const DERIVED_KEYS = Symbol("stoic.derivedKeys");

// Derived values may legitimately be undefined, so absence needs its own token.
const EMPTY = Symbol("stoic.empty");

type ReadDerived = (index: number, snap: object) => unknown;

// The snapshot class for one set of derived key names. Snapshots are class
// instances rather than `Object.create(proto)` objects because the two
// per-snapshot slots the engine needs — the owning store's `readDerived`, and
// the resolved-value memo — are **private fields**, the only per-object slot
// that is both invisible (nothing leaks into `Object.keys`, spreads,
// `JSON.stringify` or `toEqual`) and free to install. Both alternatives were
// measured and are worse: an own enumerable symbol leaks into user spreads and
// into `toEqual`, and `Object.defineProperty` costs ~90 ns *per snapshot*.
type SnapCtor = {
  new (read: ReadDerived): object;
  read(snap: object, index: number): unknown;
  memo(snap: object): unknown[] | null;
  memoInit(snap: object): unknown[];
};

// Keyed by the derived key names rather than by the `derived` config object.
// A factory that builds its config inline — every createStoreContext store,
// every per-request SSR store — hands createStore a fresh object every call and
// would never hit an identity-keyed cache, which made those stores rebuild the
// whole getter prototype from scratch. The class depends on nothing except the
// key names and their order, so every store declaring the same derived keys can
// share one. Bounded by the number of distinct derived key sets in the program.
// (An identity cache in front of this one was measured and lost: it costs a
// WeakMap store per created store, which the inline case — the one that needed
// help — pays without ever reading back.)
//
// Sharing it is the whole point. A *fresh* object promoted to prototype makes
// V8 build new prototype info and a new map transition tree, so each of the
// first snapshot's property stores minted a brand-new map: ~800 ns per store,
// which was 70% of the cost of creating a store with derived values.
//
// A trie of Maps, one level per key name, rather than a flat Map keyed on the
// joined names: building the join key measured ~59 ns for three keys against
// ~13 ns for the walk, and it was the largest single item left in creating a
// store with derived values. The class hangs off its node under a symbol, so it
// can never collide with a key name.
type ClassTrie = Map<string | symbol, ClassTrie | SnapCtor>;
const CLASS_TRIE: ClassTrie = new Map();
const TRIE_END = Symbol("stoic.trieEnd");

const snapClassFor = (derivedKeys: string[]): SnapCtor => {
  let node = CLASS_TRIE;
  for (let i = 0; i < derivedKeys.length; i++) {
    const key = derivedKeys[i] as string;
    let next = node.get(key) as ClassTrie | undefined;
    if (next === undefined) {
      next = new Map();
      node.set(key, next);
    }
    node = next;
  }
  let cls = node.get(TRIE_END) as SnapCtor | undefined;
  if (cls === undefined) {
    // Shared with every store declaring these keys: it is only ever sliced,
    // never mutated, so one per key-set is enough and no store pays to build it.
    const template: unknown[] = new Array(derivedKeys.length).fill(EMPTY);
    class Snap {
      #read: ReadDerived;
      // Allocated by the first derived read that lands on this snapshot, so a
      // snapshot that is written and never read pays nothing for it.
      #memo: unknown[] | null = null;
      constructor(read: ReadDerived) {
        this.#read = read;
      }
      static read(snap: Snap, index: number): unknown {
        return snap.#read(index, snap);
      }
      static memo(snap: Snap): unknown[] | null {
        return snap.#memo;
      }
      static memoInit(snap: Snap): unknown[] {
        const memo = template.slice();
        snap.#memo = memo;
        return memo;
      }
    }
    const descriptors: PropertyDescriptorMap = {};
    for (let i = 0; i < derivedKeys.length; i++) {
      const index = i;
      descriptors[derivedKeys[i] as string] = {
        enumerable: true,
        configurable: true,
        get(this: Snap) {
          return Snap.read(this, index);
        },
      };
    }
    Object.defineProperties(Snap.prototype, descriptors);
    cls = Snap as unknown as SnapCtor;
    node.set(TRIE_END, cls);
  }
  return cls;
};

// Shared, frozen meta singletons: every non-error outcome is one of these,
// so a sync action call allocates no meta objects at all. Error metas carry
// a per-call `error` and stay allocated.
const IDLE_META: ActionMeta = Object.freeze({ status: "idle", error: undefined });
const PENDING_META: ActionMeta = Object.freeze({ status: "pending", error: undefined });
const SUCCESS_META: ActionMeta = Object.freeze({ status: "success", error: undefined });

const NOOP = () => {};

// Handed to every state-only store as its derived key list; never mutated.
const NO_KEYS: string[] = [];

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
  // A key that reads *itself* is almost never a deliberate self-reference: it is
  // a derived function that enumerates the whole state object, which walks the
  // in-flight key's own getter along with everything else. A bare "sum → sum"
  // chain gives no hint of that, so name the cause. DEV-gated because the
  // message is the only part that is dev-only — detection has to ship.
  return new CircularDependencyError(
    chain,
    DEV && innermost === index
      ? `\n\n"${keys[index]}" reads its own value. This is often an accidental enumeration: ` +
          "`{...state}`, `Object.keys(state)` and `Object.values(state)` all read every key, " +
          "including the one being computed."
      : "",
  );
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

  // Guarded rather than `config.derived ?? {}`: the fallback object and the
  // `Object.keys` call on it are pure waste for a state-only store. The shared
  // empty list is safe to hand out because nothing ever mutates it —
  // `derivedKeysOf` copies before returning.
  const derivedFns = config.derived as Record<string, (s: Full) => unknown> | undefined;
  const derivedKeys = derivedFns === undefined ? NO_KEYS : Object.keys(derivedFns);
  const hasDerived = derivedKeys.length > 0;
  // The state shape is fixed at creation: setState only applies these keys.
  // `initialState` doubles as the membership check (hasOwn beats a Set here —
  // no extra allocation at creation, same lookup cost per written key).
  const initialState = config.state as Record<string, unknown>;
  const rawKeys = Object.keys(config.state);
  for (let i = 0; i < derivedKeys.length; i++) {
    const key = derivedKeys[i] as string;
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
  // Read once and guarded rather than `?? []`: the fallback array and its
  // iterator are allocated by every plugin-less store, which is most of them.
  const plugins = config.plugins;
  for (let i = 0; plugins !== undefined && i < plugins.length; i++) {
    const p = plugins[i] as StoicPlugin<T, Full>;
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

  // Subscribers in dispatch order, with unsubscribed slots retired to NOOP
  // until it is safe to compact them away. Dispatching from an array rather
  // than a Set drops the iterator allocation every notification paid and makes
  // each step a single element load, which is what dominates once a real tree
  // has a few dozen subscribers. Unsubscribing stays immediate — a listener
  // removed mid-notification has already been replaced by NOOP, so the dispatch
  // loop calls that instead — at the cost of an indexOf scan per unsubscribe,
  // which happens orders of magnitude less often than dispatch does.
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
  //
  // The snapshot class is shared by every store declaring these derived keys,
  // so this is a cache lookup rather than a build.
  const snapClass: SnapCtor = hasDerived ? snapClassFor(derivedKeys) : (null as never);
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
  //
  // Folding `dValue` into slot 0 of the deps record — one array fewer per store
  // and one slot fewer here — was measured and reverted: it bought 44 ns of
  // one-time store creation and cost 2.1 ns on every *repeat* read of an
  // already-memoized derived value (2.3 → 4.4 ns), which is the hottest read a
  // React tree makes.
  const fns = derivedFns as Record<string, (s: Full) => unknown>;
  for (let i = 0; i < derivedKeys.length; i++) {
    dValue.push(undefined);
    dDeps.push(null);
    dFns.push(fns[derivedKeys[i] as string] as (s: Full) => unknown);
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

  // The memo is re-read rather than carried down from the top of readDerived:
  // computing this key may have read a derived dep off the same snapshot, and
  // that nested read is what attached the array.
  const remember = (snap: Full, index: number, value: unknown) => {
    const memo = snapClass.memo(snap) ?? snapClass.memoInit(snap);
    memo[index] = value;
  };

  const readDerived = (index: number, snap: Full): unknown => {
    // Whatever this snapshot has already resolved is final — snapshots are
    // immutable, so a value it produced once is the value it produces forever.
    const memo = snapClass.memo(snap);
    if (memo !== null) {
      const cached = memo[index];
      if (cached !== EMPTY) return cached;
    }
    // The rest runs under the cycle guard. Freshness checking can recurse
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
      if (deps !== null && deps !== undefined) {
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
          remember(snap, index, value);
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
      remember(snap, index, value);
      return value;
    } finally {
      computeParent[index] = IDLE;
      computingNow = outer;
    }
  };

  // The snapshot is the single source of truth — there is no separate raw
  // copy. Each accepted write builds the next snapshot in one pass, carrying
  // only `rawKeys` over. A snapshot with derived values is an instance of the
  // shared class, constructed with this store's readDerived; a state-only store
  // never touches the class machinery and keeps plain object literals, which
  // clone through V8's fast object-spread path.
  let snapshot = (
    hasDerived
      ? Object.assign(new snapClass(readDerived as ReadDerived), config.state)
      : { ...config.state }
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
    if (notifyDepth > 0 && DEV) {
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
      // The length is read once, which fixes the dispatch list for the duration
      // of this pass: a listener subscribed by another listener belongs to the
      // next change, not to this one. Removal still takes effect immediately —
      // a component unmounting mid-notification must not be called — because
      // unsubscribe retires the slot to NOOP, which this loop then calls
      // instead. Slots are only compacted away once no dispatch is walking.
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
      if (DEV) console.warn("stoic: setState called on a destroyed store; ignored");
      return;
    }
    const next = typeof partial === "function" ? partial(snapshot) : partial;
    // Writing the current snapshot back is a no-op by definition. Skipping it
    // here also avoids the `for…in` below walking the snapshot's prototype
    // chain, where the derived getters are enumerable: `for…in` does not invoke
    // them, but every one still costs a membership check and, in dev, a
    // spurious "ignored derived key" warning. An *older* snapshot is not a
    // no-op and deliberately still goes the long way.
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
        if (DEV) {
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
          // The previous snapshot's own enumerable properties are exactly the
          // raw state keys — the resolved derived values live in a private
          // field, so nothing has to be filtered out on the way across.
          //
          // `Object.assign` rather than a `rawKeys` loop of keyed stores: the
          // loop measured the same on a three-key state and 28 ns worse on an
          // eight-key one, because every keyed store pays its own transition
          // lookup while assign walks the source map once.
          nextSnap = hasDerived
            ? (Object.assign(new snapClass(readDerived as ReadDerived), snap) as Record<
                string,
                unknown
              >)
            : { ...snap };
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
      if (DEV) console.warn("stoic: subscribe called on a destroyed store; ignored");
      return NOOP;
    }
    subs.push(listener);
    liveSubs++;
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      const at = subs.indexOf(listener);
      // Missing once destroy() has retired every slot. `liveSubs` is already 0
      // there, so decrementing would drive it negative — and there is nothing
      // left to clear or compact either way.
      if (at === -1) return;
      subs[at] = NOOP;
      liveSubs--;
      compact();
    };
  };

  // Action attribution exists to tell afterSetState which action produced a
  // write. With no such hook the whole mechanism is unobservable.
  const attributed = afterSetStateHooks !== null;

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
    // object per invocation. `set` and `get` are prototype properties rather
    // than class fields — actions destructure them off the context, so they
    // must not need a receiver, but neither varies per call.
    class CallCtx implements ActionCtx<T, Full> {
      declare set: SetState<T, Full>;
      declare get: () => Full;
      callId: number;
      args: unknown[];
      // Lazy: allocated only when the action reads `ctx.signal`.
      controller: AbortController | null = null;
      // Set by settle(). A call that has already finished must not be able to
      // claim the abort slot or register a controller nothing will remove.
      settled = false;

      constructor(callId: number, args: unknown[]) {
        this.callId = callId;
        this.args = args;
        // Attribution wraps each write, not the action body: only writes made
        // through this action's `set` are credited to it, and the credit
        // survives `await`s and overlapping actions. It costs a closure per
        // call, so it is only installed when something can actually observe it
        // — `currentActionName`/`Args` are read solely by afterSetState hooks.
        if (attributed) {
          this.set = (partial) => {
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
        }
      }

      get signal(): AbortSignal {
        let controller = this.controller;
        if (controller === null) {
          controller = new AbortController();
          this.controller = controller;
          if (this.callId === latestCall && !destroyed && !this.settled) {
            currentController = controller;
            activeControllers ??= new Set();
            activeControllers.add(controller);
          } else {
            // A newer call has already started, the store is gone, or this call
            // has already settled — all stale by the abort contract: the signal
            // is born aborted, and it must not take the abort slot from the
            // newest in-flight call. Without the `settled` check a signal read
            // after the fact would register a controller that settle() has
            // already run past and so can never remove.
            controller.abort();
          }
        }
        return controller.signal;
      }

      // A prototype method, not a per-call closure: everything per-call it
      // needs lives on `this`, the rest comes from the runner's scope.
      settle(outcome: ActionMeta) {
        this.settled = true;
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

    CallCtx.prototype.get = getState;
    // Without an afterSetState hook nothing reads the attribution, so writes go
    // straight through and no per-call closure is built at all.
    if (!attributed) CallCtx.prototype.set = setState;

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
      // Announced before the action body runs, not after: an async action that
      // writes state before its first `await` notifies subscribers from inside
      // that body, and they must already see `pending` there — that write is
      // usually exactly what puts a spinner on screen. Skipping it for calls
      // that turn out to be synchronous measured ~2ns on action:sync, which is
      // not worth making the async case wrong.
      setMeta(callId, PENDING_META);
      const ctx = new CallCtx(callId, args);

      let result: unknown;
      try {
        // Spelling out the low arities keeps these calls off the spread path,
        // which builds an argument list at run time. Actions take 0–2 arguments
        // almost always; anything longer falls back.
        result =
          args.length === 0
            ? fn(ctx)
            : args.length === 1
              ? fn(ctx, args[0])
              : args.length === 2
                ? fn(ctx, args[0], args[1])
                : fn(ctx, ...args);
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
      if (DEV) {
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

  for (let i = 0; plugins !== undefined && i < plugins.length; i++) {
    (plugins[i] as StoicPlugin<T, Full>).onInit?.(store);
  }

  return store;
}
