---
"stoic-store": minor
---

`persist` now stores state through a `driver` instead of a hard-wired web `Storage`, and can sync across tabs.

A driver is `getItem`/`setItem`, with return types widened to allow promises — so web `Storage` and React Native's `AsyncStorage` both satisfy it directly, with no adapter: `persist({ key, driver: AsyncStorage })`. IndexedDB, MMKV, SQLite or an encrypted store is an object with those two methods. Synchronous drivers stay synchronous, so the default `localStorage` still hydrates before the first render. Async drivers hydrate a tick later; the new `onHydrate` option fires once the read settles so a splash screen can wait on it, concurrent writes coalesce to the newest state, and a write made while the initial read is in flight is no longer clobbered by the stored payload.

`sync: true` applies state written by another tab, via a driver's optional `subscribe` (the default `localStorage` driver implements it with the `storage` event). Applying a synced payload doesn't re-persist it, so tabs can't write back and forth at each other.

**Breaking:** the `storage` option is replaced by `driver`. It took a thunk returning a `Storage`; `driver` takes the storage itself.

```diff
- persist({ key: "settings", storage: () => sessionStorage })
+ persist({ key: "settings", driver: sessionStorage })
```
