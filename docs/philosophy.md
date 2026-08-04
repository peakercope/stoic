# Philosophy

## No complexity

There are no reducers, action types, decorators, or code generation. If you know JavaScript, you already know most of Stoic.

## Derived state is a first-class concept

Computed values belong in your store, not scattered across components as `useMemo` calls. Describe how values relate to each other once, and Stoic keeps them up to date.

## Keep the core small

The core only handles state, derived state, and actions. Persistence, logging, devtools, and history belong in [plugins](./plugins/README.md).

## Plugins observe; they don't intercept

Every plugin hook returns `void`. A plugin can watch state, actions, and the store's lifecycle, but it cannot transform a write, veto an action, or wrap a call — there is no middleware chain.

This is a deliberate ceiling, not a gap. Interception is what makes a plugin system easy to adopt and hard to reason about: once two plugins can both rewrite a write, their order becomes part of your application's behaviour, and every guarantee in the core — that a snapshot is what you wrote, that notification order is stable, that a re-entrant write abandons the interrupted pass exactly once — becomes conditional on which plugins are installed.

The cost is that anything needing to *wrap* behaviour has to live in the core. That's why action status, cancellation, and write attribution ship in the box rather than as plugins. The benefit is that adding a plugin can't change what your store does — only what else watches it. If you need to transform state, do it in an action, where it is visible at the call site.

## Optimize by default

Dependency tracking, memoized derived values, and selective rerendering all happen automatically — you shouldn't need to think about performance for common use cases.
