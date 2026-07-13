---
"stoic-store": minor
---

Devtools action payloads: entries in the Redux DevTools log now carry the arguments their action was invoked with (`{ type: "addItem", args: ["a1", 2] }`), so calls to the same action are distinguishable in the timeline. A direct `store.setState` still logs as `"anonymous"` with no `args`.

The `afterSetState` plugin hook gains a third parameter, `actionArgs`, attributed per-write like `actionName` — so it stays correct across `await`s, overlapping async actions, and batches. This is additive; existing plugins are unaffected.
