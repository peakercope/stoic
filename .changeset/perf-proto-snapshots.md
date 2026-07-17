---
"stoic-store": minor
---

Performance overhaul of the core hot paths. Store creation with derived state is ~5× faster, `setState` on derived stores ~3×, sync action invocation ~3.7×, and reads on snapshots with memoized derived values ~2.4× (snapshots now stay in V8 fast-properties mode instead of falling into dictionary mode when a derived value memoizes).

How: derived getters moved from per-snapshot `defineProperties` onto a shared prototype (cached per `derived` config, so factory-created stores reuse one hidden-class tree); memoization now *adds* an own data property instead of redefining the getter; dependency tracking reuses one proxy per store with a flat, deduped dep record; plugin hooks and action events are skipped/not allocated when no plugin implements them; state-only stores skip the snapshot copy entirely.

Breaking behavior change: a derived key is an own enumerable property of a snapshot only **after** it has been read on that snapshot. Before that it lives on the snapshot's prototype — still readable and visible to `in`, but absent from `Object.keys`, spreads, and `JSON.stringify`. (In development the eager cycle check reads every derived key at creation, so the initial snapshot is fully materialized there; don't rely on that in production.) Also, state-only stores now hand out their internal state object directly — treat snapshots as immutable, as documented.
