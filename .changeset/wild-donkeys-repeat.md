---
"stoic-store": minor
---

Rebuild the derived-state engine around a shared snapshot class, and ship a
separate production build.

**Store creation with derived values is ~7× faster** (1.20 µs → 0.17 µs for
three derived keys). Snapshots used to hang off a per-store intermediate
prototype; a freshly created object promoted to prototype makes V8 build new
prototype info and a new map transition tree, so every property store on the
first snapshot minted a brand-new map — ~800 ns per store. Snapshots are now
instances of a class shared by every store declaring the same derived key names.

**Reading derived values after a write is 34–49% faster.** The per-snapshot memo
was attached with `Object.defineProperty` (~90 ns per snapshot); it is now a
private class field. `set:derived-read2` 230 → 140 ns, `set:selector-style`
177 → 91 ns, `set:derived-chain` 269 → 178 ns, `fanout:8derived-1changed`
364 → 239 ns. Writes that never read a derived value cost ~2 ns more (56.5 →
58 ns) — the class constructor — which is the only regression.

**New `production` export condition.** `stoic-store` now publishes a second,
pre-minified build with every dev-only warning folded out: 5205 B minified /
2460 B gzip against 6096 B / 2837 B for the default build. Bundlers that
understand the condition (Vite, webpack, Next.js) pick it up automatically in
production mode; everything else keeps resolving the default build, which still
checks `process.env.NODE_ENV` at runtime exactly as before. `persist`'s
storage-failure warnings are deliberately not dev-gated and still ship in both.

Breaking changes:

- **ES2022 is now the minimum target.** Snapshots use private class fields. A
  bundler targeting anything lower will downlevel them to a `WeakMap`, which is
  correct but slightly slower.
- `isDevEnv()` is replaced by the `DEV` binding (internal; not part of the
  public API). It is resolved once at module init rather than memoized on first
  use, which is what lets minifiers fold it.
- A snapshot's prototype chain is one level shorter, and its `constructor` is
  the internal snapshot class rather than `Object`. Nothing about a snapshot's
  own properties changed: `Object.keys`, spreads, `JSON.stringify` and `toEqual`
  still see exactly the raw state keys, and now no own symbols at all.
