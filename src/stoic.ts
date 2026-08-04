import { DEV } from "./env";

/** A `store.subscribe` callback, called with the new state after every change. */
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

/**
 * Where an action's most recent call has got to. `"idle"` until it is first
 * called; `"pending"` from the moment it is invoked (before the body runs, so a
 * write made before the first `await` already sees it).
 */
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

/**
 * A store, as returned by {@link createStore}. `T` is the raw state — the only
 * thing `setState` can write — and `Full` is that plus the derived values,
 * which is what every read returns. For a store without derived state the two
 * are the same.
 *
 * Every member is bound to the store, so destructuring them is safe:
 * `const { getState, setState } = store`.
 */
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
//
// Deliberately never evicted. Entries are keyed on derived key *names*, which
// are written into source code, so the trie is bounded by the program text and
// settles after the first store of each shape — a WeakMap has nothing to hang
// liveness off (the names are strings, and the classes are what we're caching),
// and an LRU would trade a permanent bound for a recurring rebuild on the exact
// path this cache exists to make fast. The one shape that grows without bound
// is derived keys generated at run time (`d${userId}`), which also defeats the
// per-store hidden-class sharing this enables; build one store per entity with
// fixed key names instead.
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

// Stands in for an action call's arguments when nothing can observe them (see
// `argsWanted`). Never read in that case and never mutated.
const NO_ARGS: unknown[] = [];

// Cold path — module level so it is not a closure allocated per store, and so
// the message-building code stays out of every store's context.
//
// Detection has to ship, but describing the path into the cycle does not:
// `stack` is only maintained in development, and production builds fold this
// down to naming the key the read was caught on.
const cycleError = (keys: string[], stack: number[], index: number): CircularDependencyError => {
  if (!DEV) return new CircularDependencyError([keys[index] as string]);

  // Everything from the cell's own in-flight compute down to the innermost one
  // is the cycle; anything above it is just how the read got there.
  const from = stack.indexOf(index);
  const chain = stack.slice(from === -1 ? stack.length - 1 : from).map((at) => keys[at] as string);
  chain.push(keys[index] as string);
  // A key that reads *itself* is almost never a deliberate self-reference: it is
  // a derived function that enumerates the whole state object, which walks the
  // in-flight key's own getter along with everything else. A bare "sum → sum"
  // chain gives no hint of that, so name the cause.
  return new CircularDependencyError(
    chain,
    stack[stack.length - 1] === index
      ? `\n\n"${keys[index]}" reads its own value. This is often an accidental enumeration: ` +
          "`{...state}`, `Object.keys(state)` and `Object.values(state)` all read every key, " +
          "including the one being computed."
      : "",
  );
};

/**
 * Returns the derived keys a store declares, in declaration order — empty for a
 * store without derived state.
 *
 * Plugins need this because a snapshot can't be introspected for it: derived
 * values are getters on a shared prototype resolving into a private field, so
 * they are neither own properties nor distinguishable by descriptor. Anything
 * that serializes, diffs, or writes back state — `persist` and `devtools` both
 * do — has to know which keys are computed so it can leave them out.
 *
 * Returns a copy, so the ordinary way of reading the list cannot reorder or
 * truncate the store's own. That is a guard against accidents, not a security
 * boundary — the live array is still reachable through
 * `Object.getOwnPropertySymbols(store)`.
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
  const rawKeys = Object.keys(config.state);
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
  // string-keyed lookup that goes megamorphic once several stores exist.
  //
  // `dDeps[i]` holds the (key, value-at-compute-time) pairs the last compute
  // read, flattened as [k0, v0, k1, v1, …], and describes the live snapshot
  // only — resolved values are memoized per snapshot, see readDerived.
  //
  // The snapshot class is shared by every store declaring these derived keys,
  // so this is a cache lookup rather than a build.
  const snapClass: SnapCtor = hasDerived ? snapClassFor(derivedKeys) : (null as never);
  const dValue: unknown[] = hasDerived ? [] : (null as never);
  const dDeps: (unknown[] | null)[] = hasDerived ? [] : (null as never);
  const dFns: ((s: Full) => unknown)[] = hasDerived ? [] : (null as never);
  // The cycle guard: one slot per cell, set for the duration of its compute.
  // Detection needs nothing more — describing the path into the cycle is an
  // error-message concern only, so it is a dev-only stack rather than parent
  // pointers the hot path would have to save and restore on every compute.
  const computing: number[] = hasDerived ? [] : (null as never);
  const computeStack: number[] = DEV && hasDerived ? [] : (null as never);

  // One pass, pushing into arrays that stay packed, rather than four
  // `new Array(n).fill(…)` calls plus a `.map` closure. The state/derived
  // collision check rides along on the same walk of `derivedKeys`.
  //
  // Folding `dValue` into slot 0 of the deps record — one array fewer per store
  // and one slot fewer here — was measured and reverted: it bought 44 ns of
  // one-time store creation and cost 2.1 ns on every *repeat* read of an
  // already-memoized derived value (2.3 → 4.4 ns), which is the hottest read a
  // React tree makes.
  //
  // Refilling a cell's existing deps record in place on recompute, instead of
  // allocating a replacement, was measured and reverted too: +26% on
  // set:derived-read2 and +21% on set:derived-chain. Shrinking an array and
  // re-growing it costs far more than a fresh one, which V8 bump-allocates in
  // the nursery and collects there.
  const fns = derivedFns as Record<string, (s: Full) => unknown>;
  for (let i = 0; i < derivedKeys.length; i++) {
    const key = derivedKeys[i] as string;
    // A derived getter lives on the prototype, so a raw key of the same name
    // would shadow it — unreachable and unwritable. Ships: silently losing a
    // state key in production is worse than the bytes this costs.
    if (Object.hasOwn(config.state, key)) {
      throw new Error(`stoic: "${key}" is in both \`state\` and \`derived\`; rename one`);
    }
    dValue.push(undefined);
    dDeps.push(null);
    dFns.push(fns[key] as (s: Full) => unknown);
    computing.push(0);
  }

  // One tracker object per store, retargeted around each compute via these
  // closure slots (computes nest when a derived fn reads another derived key,
  // so readDerived saves and restores them). The state shape is fixed at
  // creation, so every readable key is known up front and the tracker is a
  // plain object with one recording accessor per key — a monomorphic getter
  // call instead of a Proxy get trap on every read inside a derived fn.
  // Reads resolve against the snapshot, so a derived dep's getter memoizes
  // against the snapshot and its own transitive reads are not recorded as the
  // outer cell's deps. Built lazily on the first recompute, so a store whose
  // derived values are never read never builds one.
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
    //
    // (A guard-free fresh path for cells whose record holds only raw keys was
    // measured and rejected: it bought ~7% on the eight-cells-one-changed
    // fan-out shape but cost 3–9% on recompute-heavy paths and ~20% on store
    // creation — the per-snapshot memo write, which the identity guarantee
    // requires, is the real floor, and it stays either way.)
    if (computing[index] !== 0) throw cycleError(derivedKeys, computeStack, index);
    computing[index] = 1;
    if (DEV) computeStack.push(index);
    try {
      // The cast narrows away `undefined`: every cell's slot is pushed at
      // creation, so an out-of-bounds read cannot happen and the extra
      // runtime check the checker would otherwise force is pure dead code.
      const deps = dDeps[index] as unknown[] | null;
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
      computing[index] = 0;
      if (DEV) computeStack.pop();
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
  // Snapshots are immutable by contract — the derived dep records compare
  // against their values, and a retained older snapshot's memo is only sound
  // while the values it was computed from stay put. Nothing enforced that, so
  // a stray `getState().count = 1` corrupted both silently. Freezing in dev
  // turns it into a TypeError at the write; the private-field memo is not a
  // property, so it keeps working on a frozen snapshot.
  if (DEV) Object.freeze(snapshot);
  let destroyed = false;

  // Derived values stay lazy in development too: dev and production must agree
  // on when — and how often — derived functions run, or recompute assertions in
  // user tests turn mode-dependent. So a cyclic config surfaces on the read that
  // walks into it, not at creation, with the same chain in the message.

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
        "stoic: maximum update depth exceeded — a plugin or subscriber writes state on every change",
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
        // Indexed rather than for…of: this loop runs on every notification a
        // plugin-bearing store makes, and the iterator is an allocation.
        for (let i = 0; i < afterSetStateHooks.length; i++) {
          (afterSetStateHooks[i] as StoicPlugin<T, Full>).afterSetState?.(
            snapshot,
            actionName,
            actionArgs,
          );
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
    const base = snapshot;
    const next = typeof partial === "function" ? partial(base) : partial;
    // An updater that writes state — directly, or through an action it calls —
    // leaves the partial it returned describing a state that no longer exists.
    // The merge below still lands on the *current* snapshot, so the nested
    // write survives except where the partial overlaps it; rebasing onto `base`
    // instead would discard that write wholesale, which is worse. Neither is
    // something to rely on, so say so rather than pick a silent winner.
    if (DEV && snapshot !== base) {
      console.warn(
        "stoic: an updater passed to setState wrote state while it was running. The partial it " +
          "returned was computed from the state before that write, so any key they share is " +
          "about to be overwritten with a stale value. Updaters must be pure — move the write out.",
      );
    }
    // Writing the current snapshot back is a no-op by definition. Skipping it
    // here also avoids the `for…in` below walking the snapshot's prototype
    // chain, where the derived getters are enumerable: `for…in` does not invoke
    // them, but every one still costs a membership check and, in dev, a
    // spurious "ignored derived key" warning. An *older* snapshot is not a
    // no-op and deliberately still goes the long way.
    if ((next as unknown) === snapshot) return;

    const snap = snapshot as Record<string, unknown>;
    let nextSnap: Record<string, unknown> | null = null;
    // No own-key guard on the partial: the membership check against the
    // snapshot below already rejects anything that isn't a state key,
    // so inherited enumerable keys can't smuggle values in — they are either
    // state keys (applied, as an own read would be) or ignored.
    for (const key in next) {
      // Membership is checked against the live snapshot, not against
      // `config.state`. Every snapshot's own enumerable keys are exactly the
      // raw state keys — derived getters live on the prototype and the memo in
      // a private field — so the two agree, but the snapshot is ours. Holding
      // the caller's config object instead let them widen the accepted key set
      // after the fact by mutating it, which put a key on the next snapshot
      // that `rawKeys` doesn't know about: one hidden class per store and
      // exhaustive derived dep records both depend on that not happening.
      if (!Object.hasOwn(snap, key)) {
        // Own-key gate on the warning: passing an *older snapshot* is a legal
        // way to restore previous state, and `for…in` walks its prototype's
        // enumerable derived getters — keys the caller never wrote, so they
        // must not warn.
        if (DEV && Object.hasOwn(next, key)) {
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

    if (DEV) Object.freeze(nextSnap);
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
    // The slot this listener went into, kept as a search hint. Compaction only
    // ever moves a listener *left* and only ever shortens the array, so this is
    // a standing upper bound on the real index: scanning down from it costs one
    // step per removal that landed ahead of us, which is O(1) in practice
    // against the O(n) full scan an indexOf does.
    const hint = subs.push(listener) - 1;
    liveSubs++;
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      let at = hint < subs.length ? hint : subs.length - 1;
      while (at >= 0 && subs[at] !== listener) at--;
      // Missing once destroy() has retired every slot. `liveSubs` is already 0
      // there, so decrementing would drive it negative — and there is nothing
      // left to clear or compact either way.
      if (at < 0) return;
      subs[at] = NOOP;
      liveSubs--;
      // Amortized: a route change unsubscribes a whole subtree in one go, and
      // compacting on each of those made teardown O(n²) — an O(n) scan plus an
      // O(n) copy per listener. Waiting for the dead slots to reach half the
      // array bounds the copying at O(n) across the whole burst, and costs the
      // dispatch loop at most one NOOP call per live listener in between.
      if (subs.length - liveSubs > 8 && subs.length > liveSubs * 2) compact();
    };
  };

  const createActionRunner = (name: string, fn: (...args: unknown[]) => unknown) => {
    // Both of these are derived from hook lists that are already in scope, and
    // both are read only from here — so they are computed per action rather
    // than per store. A binding at `createStore` level would be one more slot
    // in the context object every store allocates, and that context is small
    // enough that one slot measured ~10 ns (17%) on `create:state-only`.
    //
    // Attribution exists to tell afterSetState which action produced a write;
    // with no such hook the whole mechanism is unobservable. Arguments are
    // observable through either action hook or through attribution, and with
    // none of the three a call never has to materialize them at all.
    const attributed = afterSetStateHooks !== null;
    const argsWanted = attributed || beforeActionHooks !== null || afterActionHooks !== null;

    let meta: ActionMeta = IDLE_META;
    // Meta tracks the most recent invocation: a stale call settling later must
    // not overwrite the outcome of a newer one.
    let latestCall = 0;
    let metaListeners: Set<(meta: ActionMeta) => void> | null = null;
    // Controller of the newest in-flight call that read `ctx.signal`; the next
    // call aborts it. Cleared on settle so a finished call is never aborted.
    let currentController: AbortController | null = null;

    // Only reached once something has subscribed to the meta. With no
    // subscribers the transition is unobservable except through getMeta(), so
    // the callers below just store it — which is most calls, since subscribing
    // to an action's status is opt-in.
    const setMeta = (callId: number, next: ActionMeta) => {
      if (callId !== latestCall) return;
      if (meta.status === next.status && meta.error === next.error) return;
      meta = next;
      for (const l of metaListeners as Set<(meta: ActionMeta) => void>) l(meta);
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
          for (let i = 0; i < afterActionHooks.length; i++) {
            (afterActionHooks[i] as StoicPlugin<T, Full>).afterAction?.(event);
          }
        }
        if (metaListeners !== null) setMeta(this.callId, outcome);
        else if (this.callId === latestCall) meta = outcome;
      }
    }

    CallCtx.prototype.get = getState;
    // Without an afterSetState hook nothing reads the attribution, so writes go
    // straight through and no per-call closure is built at all.
    if (!attributed) CallCtx.prototype.set = setState;

    // A plain function reading `arguments` rather than an arrow with a rest
    // parameter: the rest parameter allocates an array on every call, which is
    // exactly what this avoids. (`noArguments` is turned off for this file in
    // biome.json for the same reason.) Nothing here touches `this`, so the
    // handle stays safe to destructure off the actions object.
    const runner = function (): unknown {
      // The only things that ever read the args are the two action hooks and
      // the attribution closure — none of which most stores have. `argsWanted`
      // is constant per store, so this branch is perfectly predicted, and when
      // it is false the arguments object never escapes and V8 elides it.
      const argc = arguments.length;
      let args: unknown[] = NO_ARGS;
      if (argsWanted && argc !== 0) {
        args = new Array(argc);
        for (let i = 0; i < argc; i++) args[i] = arguments[i];
      }

      if (currentController !== null) {
        activeControllers?.delete(currentController);
        const previous = currentController;
        currentController = null;
        previous.abort();
      }

      // Not after destroy: onDestroy already ran, mirroring afterAction below.
      if (beforeActionHooks !== null && !destroyed) {
        const event: ActionEvent<Full> = { name, args, state: snapshot };
        for (let i = 0; i < beforeActionHooks.length; i++) {
          (beforeActionHooks[i] as StoicPlugin<T, Full>).beforeAction?.(event);
        }
      }

      const callId = ++latestCall;
      // Announced before the action body runs, not after: an async action that
      // writes state before its first `await` notifies subscribers from inside
      // that body, and they must already see `pending` there — that write is
      // usually exactly what puts a spinner on screen. Skipping it for calls
      // that turn out to be synchronous measured ~2ns on action:sync, which is
      // not worth making the async case wrong.
      // This call *is* the newest by construction, so the latest-call guard
      // inside setMeta cannot reject it — with nobody subscribed there is
      // nothing left for the call to do but the store.
      if (metaListeners !== null) setMeta(callId, PENDING_META);
      else meta = PENDING_META;
      const ctx = new CallCtx(callId, args);

      let result: unknown;
      try {
        // Spelling out the low arities keeps these calls off the spread path,
        // which builds an argument list at run time. Actions take 0–2 arguments
        // almost always; anything longer falls back.
        result =
          argc === 0
            ? fn(ctx)
            : argc === 1
              ? fn(ctx, arguments[0])
              : argc === 2
                ? fn(ctx, arguments[0], arguments[1])
                : fn(ctx, ...arguments);
      } catch (err) {
        ctx.settle({ status: "error", error: err });
        throw err;
      }

      // Non-native thenables (polyfilled promises, lazy thenables) must settle
      // like promises, not like sync returns. `Promise.resolve` assimilates
      // them — and returns a native promise unchanged, so the common async
      // case pays only the failed `instanceof`.
      //
      // The `typeof` gate goes first: a sync action almost always returns
      // `undefined`, which fails it immediately, where leading with
      // `instanceof Promise` made every such call walk a prototype chain first.
      if (
        typeof result === "object" &&
        result !== null &&
        (result instanceof Promise || typeof (result as PromiseLike<unknown>).then === "function")
      ) {
        return Promise.resolve(result).then(
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
      // One wrapper per subscription: two subscriptions of the same function
      // must not collapse into one Set entry, or unsubscribing either one
      // would silence both.
      const entry = (meta: ActionMeta) => listener(meta);
      set.add(entry);
      return () => set.delete(entry);
    };

    return runner;
  };

  // Dev-only bookkeeping: the registry exists purely to power the duplicate-
  // registration warning, so production never allocates or grows the Set.
  let registeredActionNames: Set<string> | null = null;
  const actions = ((map: Record<string, (...args: unknown[]) => unknown>) => {
    const result: Record<string, unknown> = {};
    for (const name of Object.keys(map)) {
      const fn = map[name] as (...args: unknown[]) => unknown;
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
    // The hooks run inside a try so that a plugin throwing from onDestroy still
    // leaves a fully torn-down store. Without it the throw escaped between
    // `destroyed = true` and the listener retirement below, which left the worst
    // of both states: setState ignored, but every listener still subscribed and
    // `liveSubs` describing a list that no longer matched. The error still
    // propagates — a plugin that fails to clean up is the caller's problem, the
    // same contract a throwing subscriber has — but it can no longer strand the
    // store on its way out.
    try {
      if (destroyHooks !== null) {
        for (const p of destroyHooks) p.onDestroy?.();
      }
    } finally {
      // Retire the slots rather than truncating: destroy() is reachable from
      // inside a listener, and the dispatch loop above is holding a length it
      // read before this ran. compact() drops them once no dispatch is walking.
      for (let i = 0; i < subs.length; i++) subs[i] = NOOP;
      liveSubs = 0;
      compact();
    }
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
