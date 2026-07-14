---
"stoic-store": patch
---

`persist` throws when given only one of `serialize`/`deserialize`. Previously the mismatch misbehaved silently: with `version` set, a custom `deserialize` without a custom `serialize` was never called (the envelope's state round-trips as a plain JSON value), and a custom `serialize` without `deserialize` fed its opaque string to `JSON.parse`. Pass both or neither.
