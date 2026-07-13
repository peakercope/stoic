import type { StoicPlugin } from "../stoic";

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

export function persist<T extends object>(options: {
  key: string;
  storage?: () => Storage;
  include?: (keyof T)[];
  exclude?: (keyof T)[];
  serialize?: (state: Partial<T>) => string;
  deserialize?: (raw: string) => Partial<T>;
  debounceMs?: number;
  /**
   * Schema version of the persisted state. When set, payloads are written as
   * a `{ version, state }` envelope; on load, a payload whose version differs
   * is passed to `migrate` — or discarded if no `migrate` is provided. A
   * pre-versioning bare payload is treated as version 0.
   */
  version?: number;
  migrate?: (persisted: unknown, version: number) => Partial<T>;
}): StoicPlugin<T, T> {
  if (options.include && options.exclude) {
    throw new Error("persist: pass either `include` or `exclude`, not both");
  }

  const getStorage = options.storage ?? (() => localStorage);
  const doSerialize = options.serialize ?? JSON.stringify;
  const doDeserialize = options.deserialize ?? (JSON.parse as (raw: string) => Partial<T>);

  // Populated in onInit, before any read or write can happen.
  let derivedKeys: ReadonlySet<string> = new Set();

  const writeToStorage = (state: T) => {
    try {
      const serialized = doSerialize(filterKeys(state, options, derivedKeys));
      const payload =
        options.version === undefined
          ? serialized
          : JSON.stringify({ version: options.version, state: serialized });
      getStorage().setItem(options.key, payload);
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
    let stateRaw = raw;
    try {
      const envelope = JSON.parse(raw) as { version?: unknown; state?: unknown } | null;
      if (
        envelope !== null &&
        typeof envelope === "object" &&
        typeof envelope.version === "number" &&
        typeof envelope.state === "string"
      ) {
        storedVersion = envelope.version;
        stateRaw = envelope.state;
      }
    } catch {
      // Not JSON at the envelope level: legacy payload from a custom serializer.
    }

    if (storedVersion === options.version) return doDeserialize(stateRaw);
    if (options.migrate) return options.migrate(doDeserialize(stateRaw), storedVersion);

    console.warn(
      `Stoic persist plugin: discarding stored state for "${options.key}" — stored version ` +
        `${storedVersion} does not match ${options.version} and no \`migrate\` was provided`,
    );
    return undefined;
  };

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingState: T | undefined;
  let hydrating = false;

  return {
    onInit(store) {
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
        const raw = getStorage().getItem(options.key);
        const payload = raw != null ? readPayload(raw) : undefined;
        if (payload !== undefined) {
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
        }
      } catch {
        console.warn("Stoic persist plugin: failed to read state from storage");
      }
    },
    afterSetState(state) {
      if (hydrating) return;

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
