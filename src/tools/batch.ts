import { STOIC_INTERNAL, type StoicInternals } from "../stoic";

type Batchable = { [STOIC_INTERNAL]: StoicInternals };

export function batch<T>(store: Batchable, fn: () => T): T {
  store[STOIC_INTERNAL].batch.begin();

  let result: T;
  try {
    result = fn();
  } catch (err) {
    store[STOIC_INTERNAL].batch.end();
    throw err;
  }

  if (result instanceof Promise) {
    return result.finally(() => {
      store[STOIC_INTERNAL].batch.end();
    }) as T;
  }

  store[STOIC_INTERNAL].batch.end();
  return result;
}
