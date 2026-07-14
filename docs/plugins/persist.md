# `persist`

`persist` saves your store to storage and restores it on load:

```tsx
import { createStore } from "stoic-store";
import { persist } from "stoic-store/plugins";

const settings = createStore({
  state: {
    theme: "light",
    language: "en",
  },

  plugins: [persist({ key: "settings" })],
});
```

Refresh the page and `settings` is restored automatically.

## Contents

- [Options](#options)
- [Drivers](#drivers)
- [Cross-tab sync](#cross-tab-sync)
- [Server rendering and manual hydration](#server-rendering-and-manual-hydration)
- [Versioning and migrations](#versioning-and-migrations)
- [Derived state is never persisted](#derived-state-is-never-persisted)

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `key` | `string` | *(required)* | Storage key the state is saved under. |
| `driver` | `PersistDriver` | `webStorage()` | Where state is stored (see [Drivers](#drivers)). |
| `sync` | `boolean` | `false` | Apply state written by another tab or process (see [Cross-tab sync](#cross-tab-sync)). |
| `include` | `(keyof T)[]` | — | Persist only these fields. |
| `exclude` | `(keyof T)[]` | — | Persist everything except these fields. |
| `serialize` | `(state) => string` | `JSON.stringify` | Custom serialization. |
| `deserialize` | `(raw) => Partial<T>` | `JSON.parse` | Custom deserialization. |
| `debounceMs` | `number` | — | Delay writes, resetting the timer on each change. |
| `onHydrate` | `(state: T) => void` | — | Called once a hydration attempt settles (see [Drivers](#drivers)). |
| `version` | `number` | — | Schema version of the persisted state (see [Versioning](#versioning-and-migrations)). |
| `migrate` | `(persisted, version) => Partial<T>` | — | Upgrade an older payload to the current shape. |
| `skipHydration` | `boolean` | `false` | Don't hydrate at store creation; call `rehydrate()` on the plugin instance instead (see [Server rendering](#server-rendering-and-manual-hydration)). |

`include` and `exclude` are mutually exclusive, and `serialize`/`deserialize` must be provided together — `persist` throws when given only one of the pair, since the default JSON codec on the other side couldn't read or write the custom format. A pending debounced write is flushed immediately if the store is destroyed. If storage is unavailable (the default `localStorage` doesn't exist on a server, for example), the plugin disables itself with a single development-only console warning instead of failing on every write.

```tsx
persist({
  key: "settings",
  exclude: ["loading", "error"], // don't persist transient fields
  debounceMs: 250,               // batch rapid updates into one write
});
```

## Drivers

`persist` doesn't know where your data lives. That's the driver's job:

```ts
interface PersistDriver {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): unknown | Promise<unknown>;
  subscribe?(key: string, onChange: (value: string | null) => void): () => void;
}
```

Because the return types allow promises, both web `Storage` and React Native's `AsyncStorage` satisfy the interface **as-is** — there's nothing to adapt:

```tsx
import AsyncStorage from "@react-native-async-storage/async-storage";

persist({ key: "settings", driver: sessionStorage });  // web, synchronous
persist({ key: "settings", driver: AsyncStorage });    // React Native, async
```

Anything else — IndexedDB, MMKV, Capacitor Preferences, SQLite, an encrypted store — is an object with those two methods. Synchronous drivers stay synchronous: the default `localStorage` still hydrates *before* your first render, with no promise in the path.

An async driver can't do that, so state arrives a tick later. Use `onHydrate` to know when it has — it fires once the read settles, whether it restored a payload, found nothing, or failed, so it's always safe to gate a splash screen on:

```tsx
persist({
  key: "settings",
  driver: AsyncStorage,
  onHydrate: () => setReady(true),
});
```

Concurrent writes to an async driver are coalesced rather than queued: if a write is in flight when the next one arrives, only the newest state is written when it settles, so storage converges on the last commit without a backlog. And if you write to the store while the initial read is still in flight, the stored payload is dropped — your newer state wins instead of being clobbered by it.

## Cross-tab sync

With `sync: true`, state another tab writes is applied to this store as it happens. It needs a driver with `subscribe`; the default `localStorage` driver has one (built on the `storage` event):

```tsx
persist({ key: "settings", sync: true });
```

Applying a synced payload doesn't re-persist it, so two tabs can't write back and forth at each other. Clearing storage elsewhere (a `null` value) leaves the store alone — that's not a request to reset it. The listener is removed when the store is destroyed.

## Server rendering and manual hydration

By default the plugin hydrates synchronously when the store is created. With server rendering that's a problem: the server rendered HTML from the initial state, so a client store hydrated from `localStorage` before React attaches makes the first client render differ from the server markup — a hydration mismatch. Set `skipHydration` and call `rehydrate()` on the plugin instance from an effect, after React has hydrated:

```tsx
const settingsPersist = persist<Settings>({ key: "settings", skipHydration: true });
export const settings = createStore({ state: defaults, plugins: [settingsPersist] });

function SettingsRoot({ children }: { children: ReactNode }) {
  useEffect(() => settingsPersist.rehydrate(), []);
  return children;
}
```

State written before `rehydrate()` runs is persisted over the stored payload, so rehydrate before writing. (With [`createStoreContext`](../per-instance-stores.md), create the plugin inside the factory and hand `rehydrate` out through the bundle's `actions`.)

## Versioning and migrations

State shapes change between releases. Set `version`, and when a stored payload was written by an older version, `migrate` receives it (as deserialized) together with the version that wrote it and returns state in the current shape:

```tsx
persist<Settings>({
  key: "settings",
  version: 2,
  migrate: (persisted, version) => {
    const old = persisted as Record<string, unknown>;
    if (version < 2) {
      // v1 stored a single `name`; v2 splits it.
      const [firstName = "", lastName = ""] = String(old.name ?? "").split(" ");
      return { firstName, lastName };
    }
    return old as Partial<Settings>;
  },
});
```

With `version` set, payloads are stored as a `{ version, state }` envelope — with the default serializer, `state` is stored as a plain JSON value, so what's in storage stays human-readable; a custom `serialize`'s output is embedded as a string. A payload written before versioning was enabled is treated as version `0`. If the versions differ and no `migrate` is provided, the stored state is discarded (with a console warning) rather than hydrated into the wrong shape.

## Derived state is never persisted

[Derived values](../derived-state.md) are recomputed from your raw state on every load, so `persist` never writes them, and ignores any it finds in stored data when rehydrating. You don't need to list them in `exclude` — naming one in `include` throws, since the request can't be honored.

This matters when a derived function changes. If old derived values were restored from storage, they would only be recomputed once one of their dependencies changed — so a user whose raw state hadn't moved would keep seeing values computed by the *previous* version of your code. Recomputing on load avoids that entirely.

If you want a value persisted and *not* recomputed, it isn't derived state — put it in `state`.
