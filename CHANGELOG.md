# stoic

## 0.4.2

### Patch Changes

- 44e1351: `persist` no longer writes derived values to storage, and ignores derived keys found in existing stored data on rehydration.

  Derived values are always recomputed from raw state, so persisting them was at best wasted bytes and at worst a stale-value bug: on rehydration a persisted derived value was merged straight into state, and because derived keys are only recomputed when one of their _dependencies_ changes, a stale value survived untouched whenever the raw state it depended on was unchanged. Shipping a new version of a derived function meant users kept seeing values computed by the old one.

  Existing stored payloads self-heal — derived keys in them are now dropped on load rather than restored.

  Two things to know when upgrading:

  - Naming a derived key in `include` now throws at store creation, rather than silently persisting a value that can't be meaningfully restored.
  - A derived function with no raw-state dependencies (e.g. `sessionId: () => uuid()`) was previously restored from storage and will now be regenerated on each load. Such a value isn't derived state — move it to `state` to keep persisting it.

## 0.4.1

### Patch Changes

- 3ce7124: Fix `useStore` returning an uncached server snapshot. Object-literal selectors previously produced a fresh reference on every `getServerSnapshot` call, which made React bail out during hydration with "The result of getServerSnapshot should be cached to avoid an infinite loop". Both snapshot functions now share the same equality-checked cached read.

## 0.4.0

### Minor Changes

- d0d7fe6: Add `batch` to `stoic-store/tools`: coalesce a sequence of sync or async `setState`/action calls into a single derived recompute and a single listener notification.

## 0.3.0

### Minor Changes

- 0ef91d4: Add devtools plugin

## 0.2.0

### Minor Changes

- 7bdece6: Add lazy/mount-aware derived recomputation

## 0.1.1

### Patch Changes

- 445e807: Update peer dependencies

## 0.1.0

### Minor Changes

- 84e6c94: Flatten the repo from a yarn-workspaces monorepo into a single package: removed the `playground` dev sandbox and moved `stoic-store`'s source, config, and changelog from `packages/stoic` to the repo root. No changes to the published API or behavior.

## 0.0.2

### Patch Changes

- b0f4670: Verify npm trusted publishing and release automation after configuring the trusted publisher.

## 0.0.1

### Patch Changes

- bb7f7a8: Set up npm publish and GitHub release automation via changesets.
