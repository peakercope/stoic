---
"stoic-store": patch
---

Give `useStore`'s snapshot function a stable identity, and add benchmarks for the React binding

- `useStore` no longer rebuilds its `getSnapshot` closure on every render. React's `useSyncExternalStore` re-runs its store-instance effect whenever `getSnapshot` differs from the previous render, and that effect calls `getSnapshot` again — so every render of every subscribed component was paying a scheduled passive effect plus a second full selector pass. The hook now keeps one record per mounted component holding the current store, selector, equality and last selection, and closes over that record instead of over the arguments, so the read is allocated once and never changes identity. A parent re-render that drags 64 `useStore` calls through a render is 11–16% faster, and an inline selector runs one fewer time per render. Behaviour is unchanged: a selector or store that changes between renders is still picked up on the next read, and the cached-selection contract `getServerSnapshot` depends on is preserved.

  Rebuilding the closure only when `[store, selector, equality]` change was measured and rejected: consumers write selectors inline, so those dependencies differ on every render anyway and the memo only adds a dependency array to the same work. It measured ~5% *slower* than doing nothing.

- `yarn bench` gains five cases covering the layer every consumer actually touches, which the suite previously did not measure at all. Two run without React and isolate the per-notify selector cost at ns resolution (`notify:selector-fanout-64`, `notify:selector-fanout-64-1changed`); three drive real `react-dom` renders through a DOM (`render:mount-64`, `render:update-64-1changed`, `render:rerender-parent-64`). A case opts in with `needs: "react"` and receives a second `setup` argument, so the existing cases are untouched and only React cases pay for the DOM.

  The fan-out pair records something worth knowing: a notify costs the same whether a subscriber's selection changed or not — 64 subscribers cost ~460 ns either way, about 7 ns each. Stoic's bail-out saves React render work, not selector work.

- New `yarn size`, a zero-dependency gzipped bundle report over `dist/prod` with the same `--save`/`--base` workflow as `yarn bench`. Sizes are measured per public entry point together with every chunk it pulls in, which is what a consumer importing that specifier pays, and keeps a saved baseline comparable across builds despite the shared chunk's content hash. The core entry is unchanged at 2.40 kB gzipped; `stoic-store/react` grows 60 B.
