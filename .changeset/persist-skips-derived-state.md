---
"stoic-store": patch
---

`persist` no longer writes derived values to storage, and ignores derived keys found in existing stored data on rehydration.

Derived values are always recomputed from raw state, so persisting them was at best wasted bytes and at worst a stale-value bug: on rehydration a persisted derived value was merged straight into state, and because derived keys are only recomputed when one of their *dependencies* changes, a stale value survived untouched whenever the raw state it depended on was unchanged. Shipping a new version of a derived function meant users kept seeing values computed by the old one.

Existing stored payloads self-heal — derived keys in them are now dropped on load rather than restored.

Two things to know when upgrading:

- Naming a derived key in `include` now throws at store creation, rather than silently persisting a value that can't be meaningfully restored.
- A derived function with no raw-state dependencies (e.g. `sessionId: () => uuid()`) was previously restored from storage and will now be regenerated on each load. Such a value isn't derived state — move it to `state` to keep persisting it.
