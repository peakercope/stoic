# stoic

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
