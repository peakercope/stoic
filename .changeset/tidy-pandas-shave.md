---
"stoic-store": patch
---

Fix a state-shape hole, make mass unsubscribe linear, and cut sync action overhead

- `setState` now checks written keys against the live snapshot instead of the `state` object passed to `createStore`. Mutating that object after creation used to widen the store's accepted key set, putting a key on the next snapshot that the store's key list never knew about — which both the one-hidden-class-per-store invariant and the exhaustiveness of the derived dependency records rely on not happening. The store also no longer retains a reference to the caller's config object.
- Unsubscribing is no longer O(n) per call with an O(n) compaction on top, so unmounting a subtree is linear rather than quadratic. A 256-listener mount/unmount cycle goes from 41.6 µs to 11.5 µs.
- Sync action invocation is 11–16% faster: meta transitions are stored directly when nothing has subscribed to them, the thenable test leads with the check most likely to fail, and the runner only materializes an arguments array when a plugin hook or attribution can observe it.
- Snapshots are frozen in development, so mutating state directly now throws instead of silently corrupting the derived dependency records and any retained snapshot's memo. Production is unaffected.
- `setState` warns in development when an updater function writes state while it is running; the partial it returns describes a state that no longer exists.
- Circular dependency detection is unchanged, but the dependency chain in the message is now built only in development. Production names the key the read was caught on — the same split already used for the self-enumeration hint.
- Prod core bundle is 2415 B gzipped, down from 2459 B.
