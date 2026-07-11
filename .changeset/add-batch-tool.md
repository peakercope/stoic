---
"stoic-store": minor
---

Add `batch` to `stoic-store/tools`: coalesce a sequence of sync or async `setState`/action calls into a single derived recompute and a single listener notification.
