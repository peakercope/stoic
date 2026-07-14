# Plugins

The core of Stoic only handles state, derived state, and actions. Everything else — persistence, logging, devtools — is a plugin, so you only pay for what you use.

A plugin is an object implementing any of the `StoicPlugin` lifecycle hooks. Plugins are passed to `createStore`:

```tsx
import { createStore } from "stoic-store";
import { devtools, persist } from "stoic-store/plugins";

const cart = createStore({
  state: { items: [], tax: 0.2 },
  plugins: [persist({ key: "cart" }), devtools({ name: "cart" })],
});
```

Hooks **observe** state — they cannot transform it. There is no middleware chain: a plugin sees what happened, and can react to it (by writing to storage, logging, or calling `setState` from outside the update cycle), but it never sits between your `set` and the store.

## Built-in plugins

| Plugin | What it does |
| --- | --- |
| [`devtools`](./devtools.md) | Connects the store to the Redux DevTools extension, with action names, arguments, and time travel. |
| [`persist`](./persist.md) | Saves state to storage and restores it on load, with drivers, cross-tab sync, and migrations. |

## Your own

The same interface is public — see [Writing a plugin](./writing-a-plugin.md).
