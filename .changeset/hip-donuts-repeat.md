---
"stoic-store": patch
---

Fix a controller leak when an action reads `ctx.signal` after it has already settled: the late read registered an `AbortController` that `settle()` had already run past and could never remove. Such a read now gets a born-aborted signal, like any other stale call.

Fix `liveSubs` going negative when an unsubscribe runs after `destroy()` has already retired every slot; the unsubscribe is now a no-op.

Add a dev-only hint to `CircularDependencyError` when a key reads its own value, pointing at the usual cause — `{...state}`, `Object.keys(state)` or `Object.values(state)` inside a derived function enumerating the key being computed.
