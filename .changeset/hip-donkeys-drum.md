---
"stoic-store": minor
---

Actions receive an `AbortSignal` as `ctx.signal`, aborted when a newer call of the same action starts or when the store is destroyed. Pass it to `fetch` to cancel superseded requests. The signal is created lazily, so actions that never read it are unaffected.
