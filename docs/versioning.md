# Versioning and stability

Stoic follows [semantic versioning](https://semver.org/). This page says what that means in
practice — what is covered by the promise, and what isn't.

## What 1.0 promises

From 1.0 onward, **no breaking change ships in a minor or patch release.** Concretely, these are
covered:

- The signature and behaviour of everything listed in the [API Reference](./api-reference.md) —
  `createStore`, the store's methods, the React hooks, `shallow`, `derivedKeysOf`, and the built-in
  plugins' options.
- The exported TypeScript types, and the inference you get from them. A change that forces you to
  add an annotation you didn't need before is a breaking change, even if it compiles.
- The [entry points](./installation.md#entry-points) and their contents.
- The [plugin hook contract](./plugins/writing-a-plugin.md): the hooks that exist, their arguments,
  the order they run in, and when they are called relative to subscribers.
- The documented [notification order](./api-reference.md#notification-order) and batching semantics.
- The peer-dependency floor. Dropping React 18 support would be a major release.

## What is not covered

- **Anything not in the API Reference.** If you reached it through
  `Object.getOwnPropertySymbols(store)`, a `dist/` file path, or a type marked `@internal`, it can
  change at any time.
- **Dev-only warning text.** Messages behind `DEV` checks may be reworded or removed. Don't assert
  on them.
- **Performance characteristics.** We work hard on them and track them with `yarn bench`, but a
  release that is slower on some shape is not a semver violation. Regressions are still bugs —
  please report them.
- **Exact bundle size.** Tracked in CI against a budget, not promised as a number.
- **The order of `derivedKeysOf`'s result beyond declaration order**, and object identity of
  anything not documented as stable.

## Snapshot identity

Two identity guarantees *are* part of the contract, because selectors depend on them:

- A write that changes nothing produces **no new snapshot** and **no notification**.
- A snapshot is immutable. A derived value read from a given snapshot returns the same value — and,
  for object-returning derived functions, the same reference — forever.

## Deprecations

Anything scheduled for removal will first be deprecated in a minor release, with a `@deprecated`
JSDoc tag naming the replacement, and will keep working until the next major. Deprecations are
listed in the [changelog](../CHANGELOG.md).

## Upgrading from 0.x

Releases in the `0.x` line did not carry these guarantees, and breaking changes shipped in minor
versions.

**Coming from `0.15.x`, there is nothing to migrate.** 1.0 removes and renames nothing; the major
version marks the stability commitment, not a breaking change. Bump the version and carry on. See
the [changelog](../CHANGELOG.md) for the full history.
