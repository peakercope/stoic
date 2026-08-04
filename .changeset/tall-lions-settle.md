---
"stoic-store": major
---

Stoic is 1.0.

Nothing is removed or renamed in this release — if you are on `0.15.x`, upgrading is a version bump
and nothing else. What changes is the commitment: from here on, **no breaking change ships in a
minor or patch release**.

[Versioning](https://github.com/peakercope/stoic/blob/main/docs/versioning.md) spells out exactly
what that covers. In short, the stable surface is everything in the
[API Reference](https://github.com/peakercope/stoic/blob/main/docs/api-reference.md) — `createStore`
and the store's methods, the React hooks, `shallow`, `derivedKeysOf`, the built-in plugins' options
— plus the exported types and the inference you get from them, the entry points, the plugin hook
contract and its ordering, and the documented notification and batching semantics. A change that
forces you to add a type annotation you didn't need before counts as breaking, even if it compiles.

Deliberately outside the promise: dev-only warning text, exact bundle size, performance
characteristics, and anything reachable only through internals — a `dist/` path, a `@internal` type,
or `Object.getOwnPropertySymbols(store)`.

Two design decisions are worth stating plainly, because 1.0 freezes both:

- **Derived stores spell out their types** — `createStore<State, Derived>`. This is a TypeScript
  limitation rather than a temporary shortcut: a derived function's parameter includes the derived
  values, so `Derived` sits in both an inference source and an inference target at once, and there
  is no fixed-point inference in the language. Thirteen candidate signatures were measured; every
  one of them either inferred the types or kept chained derived reads typed, never both. See
  [TypeScript](https://github.com/peakercope/stoic/blob/main/docs/typescript.md#why-derived-cant-be-inferred).
- **Plugins observe; they don't intercept.** Every hook returns `void`. There is no middleware
  chain, and installing a plugin cannot change what your store does — only what else watches it. See
  [Philosophy](https://github.com/peakercope/stoic/blob/main/docs/philosophy.md).
