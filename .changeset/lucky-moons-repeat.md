---
"stoic-store": patch
---

Fix thenable handling, duplicate meta subscriptions, and a spurious setState warning

- Actions and the persist plugin now settle on any thenable, not just native `Promise` instances. A polyfilled or lazy thenable returned from an action was previously treated as a synchronous value, so the action's meta settled immediately and the thenable itself was handed back as the result.
- `subscribeMeta` wraps each listener, so subscribing the same function twice yields two independent subscriptions; previously the second call collapsed into the same `Set` entry and unsubscribing either one silenced both.
- `setState` no longer warns in development when passed an older snapshot. Restoring a previous snapshot is legal, but `for…in` walks its prototype's enumerable derived getters, which produced warnings for keys the caller never wrote.
- Micro-optimizations in the plugin hook loops and action registration (indexed iteration instead of iterators).
