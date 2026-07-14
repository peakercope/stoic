# TypeScript

State-only stores infer everything from the config object. Stores with **derived state need both type parameters spelled out** — `createStore<State, Derived>` — because a derived function's argument includes the derived values themselves, which TypeScript cannot infer while it is still inferring them:

```tsx
type State = { count: number };
type Derived = { doubled: number };

const store = createStore<State, Derived>({
  state: { count: 1 },
  derived: { doubled: (s) => s.count * 2 },
});
```

Everything downstream — `useStore` selectors, action arguments, `get()` inside actions — is inferred from there; no further annotations are needed.

## Types you may want to import

| Type | Use it for |
| --- | --- |
| `StoicStore<State, Full>` | Passing a store around. `Full` is state **and** derived values. |
| `SetState<T, Full>` | Typing something that accepts an action's `set`. |
| `ActionCtx<T, Full>` | Typing an action written outside the `actions()` call. |
| `StoicPlugin<T, Full>` | [Writing a plugin](./plugins/writing-a-plugin.md). |

All of them are exported from `stoic-store`; see the [API Reference](./api-reference.md#types) for their full definitions.

> When writing plugin hooks, define them with method shorthand (`afterSetState(state) { ... }`), not as arrow-function properties. Method shorthand is required for the hook to type-check correctly against stores with derived state — see [Writing a plugin](./plugins/writing-a-plugin.md).
