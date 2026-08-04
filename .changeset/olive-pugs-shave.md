---
"stoic-store": patch
---

Fix `destroy()` leaving a store half torn down when a plugin's `onDestroy` hook throws.

`destroy()` set the destroyed flag first and retired the listeners last, so a throw in between left
the worst of both states: `setState` was ignored, but every listener was still subscribed and the
live-listener count no longer described the list. The visible symptom was a store destroyed from
inside a notification — the dispatch loop is holding a length it read before `destroy()` ran, and
only the retired slots stop it from calling the listeners ordered after the one that destroyed the
store, so those listeners ran against a destroyed store. The rest of the time it was a leak: the
listeners, and everything their closures held, were retained for good.

The hook loop now runs inside a `try`, with the teardown in the `finally`. The error still
propagates — a plugin that fails to clean up is the caller's problem, matching the contract a
throwing subscriber already has — but it can no longer strand the store on the way out.

`destroy()` is a cold path with no benchmark case; a same-session A/B over the whole suite showed no
movement outside noise. The core entry grew from 2.40 kB to 2.41 kB gzipped.

Plugin hooks are still not wrapped in `try`/`catch` anywhere else, and that stays deliberate. What
each hook does when it throws is now specified in
[Writing a plugin](https://github.com/peakercope/stoic/blob/main/docs/plugins/writing-a-plugin.md#errors)
and pinned by tests for all five hooks.
