# Philosophy

## No complexity

There are no reducers, action types, decorators, or code generation. If you know JavaScript, you already know most of Stoic.

## Derived state is a first-class concept

Computed values belong in your store, not scattered across components as `useMemo` calls. Describe how values relate to each other once, and Stoic keeps them up to date.

## Keep the core small

The core only handles state, derived state, and actions. Persistence, logging, devtools, and history belong in [plugins](./plugins/README.md).

## Optimize by default

Dependency tracking, memoized derived values, and selective rerendering all happen automatically — you shouldn't need to think about performance for common use cases.
