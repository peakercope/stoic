const isPlain = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Compares two values one level deep: plain objects and arrays by their own
 * enumerable entries, Maps and Sets by size and membership, everything else by
 * `Object.is`. Values one level down are compared with `Object.is` — it never
 * recurses. Intended as the `equality` argument of `useStore` for selectors
 * that build a new object or array on every call.
 *
 * Non-plain objects (Dates, RegExps, class instances) are only equal by
 * reference: they carry state outside their enumerable keys, so comparing
 * keys would report two different Dates as equal.
 */
export function shallow<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;

  if (typeof a !== "object" || a === null || typeof b !== "object" || b === null) {
    return false;
  }

  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map && b instanceof Map) || a.size !== b.size) return false;
    for (const [key, value] of a) {
      if (!b.has(key) || !Object.is(value, b.get(key))) return false;
    }
    return true;
  }

  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set && b instanceof Set) || a.size !== b.size) return false;
    for (const value of a) {
      if (!b.has(value)) return false;
    }
    return true;
  }

  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (!Array.isArray(a) && !(isPlain(a) && isPlain(b))) return false;

  const keysA = Object.keys(a as object);
  const keysB = Object.keys(b as object);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (
      !Object.hasOwn(b, key) ||
      !Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    ) {
      return false;
    }
  }

  return true;
}
