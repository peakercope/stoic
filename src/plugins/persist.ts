import { isDevEnv } from "../env";
import { derivedKeysOf, type StoicPlugin, type StoicStore } from "../stoic";

type MaybePromise<T> = T | Promise<T>;

/**
 * Where persisted state lives. Return types are widened to allow promises, so
 * web `Storage` (`localStorage`, `sessionStorage`) and React Native's
 * `AsyncStorage` both satisfy this as-is — no adapter needed. Anything else
 * (IndexedDB, MMKV, SQLite, an encrypted store) is an object with these methods.
 */
export interface PersistDriver {
  getItem(key: string): MaybePromise<string | null>;
  setItem(key: string, value: string): MaybePromise<unknown>;
  /**
   * Notifies when another context (a second tab, another process) writes `key`,
   * with the value it wrote — or `null` when it was removed. Returns an
   * unsubscribe. Drivers without one cannot be used with `sync`.
   */
  subscribe?(key: string, onChange: (value: string | null) => void): () => void;
}

/**
 * The default driver: `localStorage`, with cross-tab notification via the
 * `storage` event. The backend is resolved lazily on each call, so building the
 * driver is safe on a server, where touching `localStorage` would throw.
 */
export function webStorage(getStorage: () => Storage = () => localStorage): PersistDriver {
  return {
    getItem: (key) => getStorage().getItem(key),
    setItem: (key, value) => {
      getStorage().setItem(key, value);
    },
    subscribe(key, onChange) {
      const area = getStorage();
      const listener = (event: StorageEvent) => {
        // `storage` fires for every key of every area in the document.
        if (event.key === key && event.storageArea === area) onChange(event.newValue);
      };
      window.addEventListener("storage", listener);
      return () => {
        window.removeEventListener("storage", listener);
      };
    },
  };
}

/**
 * Runs `ok` on the driver's result whether the driver is synchronous or async,
 * routing both a synchronous throw and a rejection to `fail`. A sync driver
 * never yields to the microtask queue, so hydration still lands before the
 * first render.
 */
function settle<V>(run: () => MaybePromise<V>, ok: (value: V) => void, fail: () => void): void {
  let result: MaybePromise<V>;
  try {
    result = run();
  } catch {
    fail();
    return;
  }
  if (result instanceof Promise) result.then(ok, fail);
  else ok(result);
}

// Derived values are always recomputed from raw state, so they are dropped on
// the way out (never written) and on the way back in (a persisted derived value
// is stale by definition, and would survive rehydration untouched whenever its
// dependencies happen to be unchanged).
function filterKeys<T extends object>(
  state: T,
  options: { include?: (keyof T)[]; exclude?: (keyof T)[] },
  derivedKeys: ReadonlySet<string>,
): Partial<T> {
  const result: Partial<T> = {};

  if (options.include) {
    // A key can be absent when rehydrating an older payload that predates it;
    // copying it anyway would overwrite the initial-state default with undefined.
    for (const key of options.include) {
      if (key in state) result[key] = state[key];
    }
    return result;
  }

  const excluded = new Set(options.exclude ?? []);
  for (const key of Object.keys(state) as (keyof T)[]) {
    if (excluded.has(key)) continue;
    if (derivedKeys.has(key as string)) continue;
    result[key] = state[key];
  }
  return result;
}

/** What `persist` returns: the plugin hooks plus a manual hydration trigger. */
export type PersistPlugin<T extends object> = StoicPlugin<T, T> & {
  /**
   * Reads storage and merges the stored state into the store now. Meant for
   * `skipHydration` setups; a no-op when nothing is stored or storage is
   * unavailable. State written before `rehydrate()` is persisted over the
   * stored payload, so rehydrate before writing.
   */
  rehydrate: () => void;
};

/**
 * Saves raw state to storage on every change and restores it when the store
 * is created. Derived values are never persisted — they are recomputed from
 * raw state on load. When storage is unavailable (e.g. `localStorage` on a
 * server), the plugin disables itself with a single dev-only warning.
 */
export function persist<T extends object>(options: {
  /** Storage key the state is saved under. */
  key: string;
  /**
   * Where state is stored. Defaults to `localStorage`. Web `Storage` and React
   * Native's `AsyncStorage` can be passed directly; async drivers hydrate as
   * soon as the read resolves (see `onHydrate`).
   */
  driver?: PersistDriver;
  /**
   * Apply state written by another tab or process as it happens. Requires a
   * driver with `subscribe`; the default `localStorage` driver has one.
   */
  sync?: boolean;
  /** Persist only these fields. Mutually exclusive with `exclude`. */
  include?: (keyof T)[];
  /** Persist everything except these fields. Mutually exclusive with `include`. */
  exclude?: (keyof T)[];
  /** Custom serialization; defaults to `JSON.stringify`. Requires `deserialize`. */
  serialize?: (state: Partial<T>) => string;
  /** Custom deserialization; defaults to `JSON.parse`. Requires `serialize`. */
  deserialize?: (raw: string) => Partial<T>;
  /** Delay writes by this many ms, resetting the timer on each change. A pending write is flushed on destroy. */
  debounceMs?: number;
  /**
   * Called with the state once a hydration attempt settles — whether it
   * restored a payload, found nothing stored, or failed. With an async driver
   * that happens after the first render, so this is how a splash screen learns
   * it can go away.
   */
  onHydrate?: (state: T) => void;
  /**
   * Schema version of the persisted state. When set, payloads are written as
   * a `{ version, state }` envelope; on load, a payload whose version differs
   * is passed to `migrate` — or discarded if no `migrate` is provided. A
   * pre-versioning bare payload is treated as version 0.
   */
  version?: number;
  /** Upgrades a payload written by an older `version` to the current shape. */
  migrate?: (persisted: unknown, version: number) => Partial<T>;
  /**
   * Skip the automatic hydration at store creation; call `rehydrate()` on the
   * plugin instance when you want it. Useful with server rendering, where
   * hydrating from `localStorage` during React hydration would make the
   * client render differ from the server HTML.
   */
  skipHydration?: boolean;
}): PersistPlugin<T> {
  if (options.include && options.exclude) {
    throw new Error("persist: pass either `include` or `exclude`, not both");
  }
  if ((options.serialize === undefined) !== (options.deserialize === undefined)) {
    throw new Error(
      "persist: pass `serialize` and `deserialize` together, or neither — with only one of " +
        "them, the default JSON codec on the other side cannot read or write the custom format",
    );
  }

  const driver = options.driver ?? webStorage();
  const doSerialize = options.serialize ?? JSON.stringify;
  const doDeserialize = options.deserialize ?? (JSON.parse as (raw: string) => Partial<T>);

  // Populated in onInit, before any read or write can happen.
  let derivedKeys: ReadonlySet<string> = new Set();

  // Set in onInit; hydration (automatic or via rehydrate()) needs the store.
  let boundStore: StoicStore<T, T> | undefined;

  let hydrating = false;
  let destroyed = false;
  let disabled = false;
  let unsubscribe: (() => void) | undefined;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  // Set when the backend can't be reached at all (e.g. the default
  // `localStorage` on a server), which disables the plugin after a single
  // warning instead of warning on every write.
  const unavailable = () => {
    if (disabled) return;
    disabled = true;
    if (isDevEnv()) {
      console.warn(
        `Stoic persist plugin: storage is unavailable for "${options.key}"; persistence is disabled for this store`,
      );
    }
  };

  const encode = (state: T): string => {
    const filtered = filterKeys(state, options, derivedKeys);
    if (options.version === undefined) return doSerialize(filtered);
    // A custom serializer produces an opaque string, so it stays embedded.
    if (options.serialize) {
      return JSON.stringify({ version: options.version, state: options.serialize(filtered) });
    }
    return JSON.stringify({ version: options.version, state: filtered });
  };

  // Once per store, not per write, or a persistently failing backend (full
  // quota) floods the console — but not dev-gated, because it signals data loss.
  let warnedWriteFailure = false;
  const warnWriteFailure = () => {
    if (warnedWriteFailure) return;
    warnedWriteFailure = true;
    console.warn("Stoic persist plugin: failed to write state to storage");
  };

  // An async driver can have a write in flight when the next one arrives.
  // Writes are coalesced rather than queued: only the newest state matters, so
  // storage converges on the last commit without an unbounded backlog.
  let writing = false;
  let queued: T | undefined;

  const writeToStorage = (state: T) => {
    if (disabled) return;
    if (writing) {
      queued = state;
      return;
    }

    let payload: string;
    try {
      payload = encode(state);
    } catch {
      warnWriteFailure();
      return;
    }

    const done = () => {
      writing = false;
      const next = queued;
      queued = undefined;
      if (next !== undefined) writeToStorage(next);
    };

    writing = true;
    settle(
      () => driver.setItem(options.key, payload),
      done,
      () => {
        warnWriteFailure();
        done();
      },
    );
  };

  // Resolves a raw storage payload to the state to hydrate, or undefined to
  // skip hydration (version mismatch without a migration path).
  const readPayload = (raw: string): Partial<T> | undefined => {
    if (options.version === undefined) return doDeserialize(raw);

    let storedVersion = 0;
    let storedState: Partial<T> | undefined;
    try {
      const envelope = JSON.parse(raw) as {
        version?: unknown;
        state?: unknown;
      } | null;
      if (
        envelope !== null &&
        typeof envelope === "object" &&
        typeof envelope.version === "number" &&
        "state" in envelope
      ) {
        storedVersion = envelope.version;
        // A custom codec embeds the serialized state as an opaque string; the
        // default codec stores the state value itself.
        storedState = options.deserialize
          ? options.deserialize(envelope.state as string)
          : (envelope.state as Partial<T>);
      }
    } catch {
      // Not JSON at the envelope level; treated as a bare payload below.
    }
    // A payload without an envelope predates versioning and counts as version 0.
    if (storedState === undefined) storedState = doDeserialize(raw);

    if (storedVersion === options.version) return storedState;
    if (options.migrate) return options.migrate(storedState, storedVersion);

    console.warn(
      `Stoic persist plugin: discarding stored state for "${options.key}" — stored version ${storedVersion} does not match ${options.version} and no \`migrate\` was provided`,
    );
    return undefined;
  };

  // Merges a raw payload into the store. Shared by hydration and by `sync`,
  // which is the same operation with a different trigger. A `null` value (the
  // key was removed elsewhere) leaves state alone — clearing storage is not a
  // request to reset the store.
  const applyPayload = (raw: string | null) => {
    const store = boundStore;
    if (store === undefined || raw === null) return;
    try {
      const payload = readPayload(raw);
      if (payload === undefined) return;

      const parsed = filterKeys(payload as T, options, derivedKeys);
      // Drop keys the store no longer has: a stale payload would otherwise
      // merge them into state and re-persist them forever.
      const current = store.getState();
      for (const key of Object.keys(parsed) as (keyof T)[]) {
        if (!(key in current)) delete parsed[key];
      }
      // Writing back what was just read is pointless; suppress the
      // afterSetState this rehydration triggers.
      hydrating = true;
      try {
        store.setState(parsed);
      } finally {
        hydrating = false;
      }
    } catch {
      console.warn("Stoic persist plugin: failed to read state from storage");
    }
  };

  const hydrate = () => {
    const store = boundStore;
    if (store === undefined) {
      if (isDevEnv()) {
        console.warn(
          "Stoic persist plugin: rehydrate() called before the plugin was attached to a " +
            "store (pass it via createStore's `plugins`); ignored",
        );
      }
      return;
    }
    if (disabled) return;

    // The core mints a new snapshot object on every real write, so snapshot
    // identity is a free signal for "did the store change while the read was in
    // flight". It cannot, for a synchronous driver.
    const before = store.getState();
    const finish = () => {
      options.onHydrate?.(store.getState());
    };

    settle(
      () => driver.getItem(options.key),
      (raw) => {
        // A write landed during an async read: the live state is newer than the
        // payload, so applying it would clobber what the user just did.
        if (!destroyed && store.getState() === before) applyPayload(raw);
        finish();
      },
      () => {
        unavailable();
        finish();
      },
    );
  };

  return {
    onInit(store) {
      boundStore = store;
      derivedKeys = new Set(derivedKeysOf(store));

      for (const key of options.include ?? []) {
        if (derivedKeys.has(key as string)) {
          throw new Error(
            `persist: \`include\` names derived key "${String(key)}". Derived values are ` +
              "recomputed from state and are never persisted. Move it to `state` to persist it.",
          );
        }
      }

      if (options.sync) {
        if (driver.subscribe) {
          try {
            unsubscribe = driver.subscribe(options.key, (raw) => {
              // Our own writes never come back through here (the DOM `storage`
              // event does not fire in the tab that wrote), and for any other
              // transport `hydrating` suppresses the re-persist — so applying a
              // payload cannot loop.
              if (!destroyed && !disabled) applyPayload(raw);
            });
          } catch {
            unavailable();
          }
        } else if (isDevEnv()) {
          console.warn(
            `Stoic persist plugin: \`sync\` is set for "${options.key}" but the driver has no ` +
              "`subscribe`; cross-context sync is disabled",
          );
        }
      }

      if (!options.skipHydration) hydrate();
    },
    rehydrate: hydrate,
    afterSetState(state) {
      if (hydrating || disabled) return;

      if (options.debounceMs !== undefined) {
        if (debounceTimer !== undefined) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = undefined;
          // Read the state at fire time: `sync` or `rehydrate()` may have
          // applied newer state since this write was scheduled (their writes
          // don't reschedule the timer), and persisting the captured snapshot
          // would clobber it.
          if (boundStore !== undefined) writeToStorage(boundStore.getState());
        }, options.debounceMs);
        return;
      }

      writeToStorage(state);
    },
    onDestroy() {
      destroyed = true;
      unsubscribe?.();
      unsubscribe = undefined;
      // `queued` is deliberately left alone: a state coalesced behind an
      // in-flight async write is the store's final state, and the in-flight
      // write's completion flushes it.
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
        if (boundStore !== undefined) writeToStorage(boundStore.getState());
      }
    },
  };
}
