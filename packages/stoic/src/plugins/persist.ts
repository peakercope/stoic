import type { StoicPlugin } from "../stoic";

function filterKeys<T extends object>(
  state: T,
  options: { include?: (keyof T)[]; exclude?: (keyof T)[] },
): Partial<T> {
  if (options.include) {
    const result: Partial<T> = {};
    for (const key of options.include) result[key] = state[key];
    return result;
  }
  if (options.exclude) {
    const excluded = new Set(options.exclude);
    const result: Partial<T> = {};
    for (const key of Object.keys(state) as (keyof T)[]) {
      if (!excluded.has(key)) result[key] = state[key];
    }
    return result;
  }
  return state;
}

export function persist<T extends object>(options: {
  key: string;
  storage?: () => Storage;
  include?: (keyof T)[];
  exclude?: (keyof T)[];
  serialize?: (state: Partial<T>) => string;
  deserialize?: (raw: string) => Partial<T>;
  debounceMs?: number;
  throttleMs?: number;
}): StoicPlugin<T, T> {
  if (options.include && options.exclude) {
    throw new Error("persist: pass either `include` or `exclude`, not both");
  }
  if (options.debounceMs !== undefined && options.throttleMs !== undefined) {
    throw new Error("persist: pass either `debounceMs` or `throttleMs`, not both");
  }

  const getStorage = options.storage ?? (() => localStorage);
  const doSerialize = options.serialize ?? JSON.stringify;
  const doDeserialize = options.deserialize ?? (JSON.parse as (raw: string) => Partial<T>);

  const writeToStorage = (state: T) => {
    try {
      getStorage().setItem(options.key, doSerialize(filterKeys(state, options)));
    } catch {
      console.warn("Stoic persist plugin: failed to write state to storage");
    }
  };

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingState: T | undefined;

  let throttleTimer: ReturnType<typeof setTimeout> | undefined;
  let lastWriteTime = 0;

  return {
    onInit(store) {
      try {
        const raw = getStorage().getItem(options.key);
        if (raw != null) {
          const parsed = doDeserialize(raw);
          store.setState(filterKeys(parsed as T, options));
        }
      } catch {
        console.warn("Stoic persist plugin: failed to read state from storage");
      }
    },
    afterSetState(state) {
      if (options.debounceMs !== undefined) {
        pendingState = state;
        if (debounceTimer !== undefined) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = undefined;
          writeToStorage(state);
        }, options.debounceMs);
        return;
      }

      if (options.throttleMs !== undefined) {
        pendingState = state;
        const elapsed = Date.now() - lastWriteTime;
        if (elapsed >= options.throttleMs) {
          lastWriteTime = Date.now();
          writeToStorage(state);
          return;
        }
        if (throttleTimer === undefined) {
          throttleTimer = setTimeout(() => {
            throttleTimer = undefined;
            lastWriteTime = Date.now();
            writeToStorage(pendingState as T);
          }, options.throttleMs - elapsed);
        }
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
      if (throttleTimer !== undefined) {
        clearTimeout(throttleTimer);
        throttleTimer = undefined;
        writeToStorage(pendingState as T);
      }
    },
  };
}
