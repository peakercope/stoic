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

Everything downstream — `useStore` selectors, action arguments, `get()` inside actions, action
return types — is inferred from there; no further annotations are needed. `Derived` is the only
type Stoic asks you to write.

### Why `Derived` can't be inferred

This is a limit of TypeScript, not something Stoic hasn't got around to. A derived function's
argument includes the derived values themselves, so that chained derivations type-check:

```ts
derived: {
  subtotal: (s) => s.items.reduce((n, i) => n + i.price, 0),
  total: (s) => s.subtotal * (1 + s.tax), //   ← reads another derived value
}
```

That makes `Derived` appear in two places at once: in the **parameter** of every derived function,
and in their **return types**. To infer it from the returns, TypeScript would first have to know
the parameter type — which is the thing it is trying to infer. There is no fixed-point inference in
the language, so it gives up and falls back to `unknown`.

We measured this rather than assumed it: thirteen candidate signatures were tried, including
return-position inference, self-referential intersections, `NoInfer<>`, and a defaulted `Self` type
parameter. Every one of them either inferred the derived types **or** typed chained reads — never
both. The only shape that achieves both is a builder chain
(`createStore({ state }).derive({ … }).derive({ … })`), which infers because each step's parameter
type is already known. Stoic doesn't use one, deliberately: it would forbid a derived value from
referencing one declared later (which [works today](./derived-state.md)), add a second way to
describe a store, and grow the bundle.

So the trade is explicit: **one hand-written type in exchange for chained derived state that is
fully checked**. If your store has no chaining you still write `Derived`, because the alternative
would be an API that silently stops inferring the moment you add your first chain.

## Types you may want to import

| Type | Use it for |
| --- | --- |
| `StoicStore<State, Full>` | Passing a store around. `Full` is state **and** derived values. |
| `SetState<T, Full>` | Typing something that accepts an action's `set`. |
| `ActionCtx<T, Full>` | Typing an action written outside the `actions()` call. |
| `StoicPlugin<T, Full>` | [Writing a plugin](./plugins/writing-a-plugin.md). |

All of them are exported from `stoic-store`; see the [API Reference](./api-reference.md#types) for their full definitions.

> When writing plugin hooks, define them with method shorthand (`afterSetState(state) { ... }`), not as arrow-function properties. Method shorthand is required for the hook to type-check correctly against stores with derived state — see [Writing a plugin](./plugins/writing-a-plugin.md).
