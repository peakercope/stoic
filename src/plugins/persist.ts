import { isDevEnv } from "../env";
import type { StoicPlugin, StoicStore } from "../stoic";

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
  /** Storage backend, e.g. `() => sessionStorage`. Defaults to `localStorage`. */
  storage?: () => Storage;
  /** Persist only these fields. Mutually exclusive with `exclude`. */
  include?: (keyof T)[];
  /** Persist everything except these fields. Mutually exclusive with `include`. */
  exclude?: (keyof T)[];
  /** Custom serialization; defaults to `JSON.stringify`. */
  serialize?: (state: Partial<T>) => string;
  /** Custom deserialization; defaults to `JSON.parse`. */
  deserialize?: (raw: string) => Partial<T>;
  /** Delay writes by this many ms, resetting the timer on each change. A pending write is flushed on destroy. */
  debounceMs?: number;
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

  const getStorage = options.storage ?? (() => localStorage);
  const doSerialize = options.serialize ?? JSON.stringify;
  const doDeserialize = options.deserialize ?? (JSON.parse as (raw: string) => Partial<T>);

  // Populated in onInit, before any read or write can happen.
  let derivedKeys: ReadonlySet<string> = new Set();

  // Resolved once in onInit. Stays undefined when the backend can't be
  // reached (e.g. the default `localStorage` on a server), which disables the
  // plugin after a single warning instead of warning on every write.
  let storage: Storage | undefined;

  const writeToStorage = (state: T) => {
    if (storage === undefined) return;
    try {
      const filtered = filterKeys(state, options, derivedKeys);
      let payload: string;
      if (options.version === undefined) {
        payload = doSerialize(filtered);
      } else if (options.serialize) {
        // A custom serializer produces an opaque string, so it stays embedded.
        payload = JSON.stringify({
          version: options.version,
          state: options.serialize(filtered),
        });
      } else {
        payload = JSON.stringify({ version: options.version, state: filtered });
      }
      storage.setItem(options.key, payload);
    } catch {
      console.warn("Stoic persist plugin: failed to write state to storage");
    }
  };

  // Resolves a raw storage payload to the state to hydrate, or undefined to
  // skip hydration (version mismatch without a migration path).
  const readPayload = (raw: string): Partial<T> | undefined => {
    if (options.version === undefined) return doDeserialize(raw);

    // A payload written before versioning was enabled is a bare state string
    // and counts as version 0; so does one written by a custom serializer.
    let storedVersion = 0;
    let storedState: unknown = raw;
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
        storedState = envelope.state;
      }
    } catch {
      // Not JSON at the envelope level: legacy payload from a custom serializer.
    }

    // A string is a serialized state — from a custom serializer, that embedded the default-serialized state as a string.
    // Anything else is the state value itself.
    const resolve = (value: unknown): Partial<T> =>
      typeof value === "string" ? doDeserialize(value) : (value as Partial<T>);

    if (storedVersion === options.version) return resolve(storedState);
    if (options.migrate) return options.migrate(resolve(storedState), storedVersion);

    console.warn(
      `Stoic persist plugin: discarding stored state for "${options.key}" — stored version ` +
        `${storedVersion} does not match ${options.version} and no \`migrate\` was provided`,
    );
    return undefined;
  };

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingState: T | undefined;
  let hydrating = false;

  // Set in onInit; hydration (automatic or via rehydrate()) needs the store.
  let boundStore: StoicStore<T, T> | undefined;

  const hydrate = () => {
    if (boundStore === undefined) {
      if (isDevEnv()) {
        console.warn(
          "Stoic persist plugin: rehydrate() called before the plugin was attached to a " +
            "store (pass it via createStore's `plugins`); ignored",
        );
      }
      return;
    }
    if (storage === undefined) return;
    try {
      const raw = storage.getItem(options.key);
      const payload = raw != null ? readPayload(raw) : undefined;
      if (payload !== undefined) {
        const parsed = filterKeys(payload as T, options, derivedKeys);
        // Drop keys the store no longer has: a stale payload would otherwise
        // merge them into state and re-persist them forever.
        const current = boundStore.getState();
        for (const key of Object.keys(parsed) as (keyof T)[]) {
          if (!(key in current)) delete parsed[key];
        }
        // Writing back what was just read is pointless; suppress the
        // afterSetState this rehydration triggers.
        hydrating = true;
        try {
          boundStore.setState(parsed);
        } finally {
          hydrating = false;
        }
      }
    } catch {
      console.warn("Stoic persist plugin: failed to read state from storage");
    }
  };

  return {
    onInit(store) {
      boundStore = store;
      // Derived values are exposed as getter properties on snapshots (a
      // documented invariant of the core, pinned by its tests); raw keys are
      // plain data properties. Inspecting descriptors doesn't compute anything.
      const snapshot = store.getState();
      derivedKeys = new Set(
        Object.keys(snapshot).filter(
          (key) => Object.getOwnPropertyDescriptor(snapshot, key)?.get !== undefined,
        ),
      );

      for (const key of options.include ?? []) {
        if (derivedKeys.has(key as string)) {
          throw new Error(
            `persist: \`include\` names derived key "${String(key)}". Derived values are ` +
              "recomputed from state and are never persisted. Move it to `state` to persist it.",
          );
        }
      }

      try {
        storage = getStorage();
      } catch {
        storage = undefined;
      }
      if (storage === undefined) {
        if (isDevEnv()) {
          console.warn(
            `Stoic persist plugin: storage is unavailable for "${options.key}"; ` +
              "persistence is disabled for this store",
          );
        }
        return;
      }

      if (!options.skipHydration) hydrate();
    },
    rehydrate: hydrate,
    afterSetState(state) {
      if (hydrating || storage === undefined) return;

      if (options.debounceMs !== undefined) {
        pendingState = state;
        if (debounceTimer !== undefined) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = undefined;
          writeToStorage(state);
        }, options.debounceMs);
        return;
      }

      writeToStorage(state);
    },
    onDestroy() {
      if (debounceTimer !== undefined) {
        clearTimeout(debounceTimer);
        debounceTimer = undefined;
        writeToStorage(pendingState as T);
      }
    },
  };
}
