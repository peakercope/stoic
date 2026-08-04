---
"stoic-store": minor
---

Export `derivedKeysOf`, so third-party plugins can tell derived values from raw state.

Derived values are getters on a shared prototype that resolve into a private field, so no reflection
over a snapshot distinguishes them: `Object.keys`, `getOwnPropertyNames` and descriptor checks all
report exactly the raw state keys. `derivedKeysOf(store)` returns the declared derived keys (a copy,
in declaration order), which is what `persist` needs to keep computed values out of storage and what
`devtools` needs to read them back in for the extension to serialize.

It already existed and both built-in plugins already used it — it was just marked `@internal` and
not exported, which left first-party plugins with a capability nobody else could replicate. Since
the plugin contract is one of the things a stable release freezes, that asymmetry is worth removing
now. Application code rarely needs this.

```ts
import { derivedKeysOf, type StoicPlugin } from "stoic-store";

export function logger(): StoicPlugin {
  let derived: readonly string[] = [];
  return {
    onInit(store) {
      derived = derivedKeysOf(store); // fixed at creation — read once, keep it
    },
  };
}
```
