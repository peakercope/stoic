# `devtools`

`devtools` connects a store to the [Redux DevTools](https://github.com/reduxjs/redux-devtools) browser extension, so you can inspect state, see every action as it fires, and time-travel through history:

```tsx
import { createStore } from "stoic-store";
import { devtools } from "stoic-store/plugins";

const cart = createStore({
  state: {
    items: [],
    tax: 0.2,
  },

  plugins: [devtools({ name: "cart" })],
});
```

## What you see

Every entry in the DevTools log is tagged with the name of the action that produced it (`setTax`, `addItem`, ...) and carries the arguments that action was called with, under `args`:

```jsonc
// addItem("a1", 2)
{ "type": "addItem", "args": ["a1", 2] }
```

`args` is always an array, so a no-argument action sends `[]`. A `setState` call made outside of an action shows up as `"anonymous"` with no `args` — there's no action, so there are no arguments. Arguments are sent as-is: the extension serializes them on receipt, so unserializable values (DOM events, class instances) are rendered as best it can.

Time-travel (jumping to a past state, resetting, importing a state) is applied back to the store automatically.

During a [`batch`](../batching.md), the whole batch is logged as one combined entry.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `string` | an auto-generated, unique per-store name | Instance name shown in the DevTools dropdown. |
| `enabled` | `boolean` | `true` outside of `NODE_ENV=production` | Whether to connect to the extension at all. |
| `anonymousActionType` | `string` | `"anonymous"` | Label used for `setState` calls made outside of an action. |

If the Redux DevTools extension isn't installed, `devtools` is a no-op — your store behaves exactly as if the plugin weren't there.
