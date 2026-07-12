---
"stoic-store": patch
---

Fix `useStore` returning an uncached server snapshot. Object-literal selectors previously produced a fresh reference on every `getServerSnapshot` call, which made React bail out during hydration with "The result of getServerSnapshot should be cached to avoid an infinite loop". Both snapshot functions now share the same equality-checked cached read.
