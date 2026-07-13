---
"stoic-store": minor
---

React hooks move to `stoic-store/react`, production-build fixes, and persist SSR support.

**Breaking:**

- **React hooks now live in the `stoic-store/react` entry.** The core entry is React-free, so store modules can be imported from React Server Components (for `getState()` or actions) without pulling client-side React in.
  - `store.useStore(selector?, equality?)` → `useStore(store, selector?, equality?)` from `stoic-store/react`.
  - `action.useMeta()` → `useActionMeta(action)` from `stoic-store/react`.
  - `createStoreContext` moved from `stoic-store` to `stoic-store/react` (unchanged otherwise).
  - Store-specific hooks are now plain wrappers: `const useCart = (sel) => useStore(cart, sel)`.
- **`createStore` throws when a key is declared in both `state` and `derived`.** Previously the derived getter silently shadowed the state key, making it unreachable and unwritable.
- Published files no longer include sourcemap comments pointing at unshipped `.map` files.

**Fixed:**

- **Dev-mode detection is now bundler-strippable.** The `NODE_ENV` check was read through `globalThis.process`, which bundler define-replacement does not rewrite — so in production browser bundles (where no `process` global exists) the `devtools` plugin defaulted to **enabled** and dev warnings shipped active. The check is now the literal `process.env.NODE_ENV` expression; Vite/esbuild/webpack replace it and production builds correctly disable devtools and warnings.
- The persist plugin's "storage unavailable" warning is development-only, so SSR servers no longer log it per store per request.

**New:**

- **`persist` supports `skipHydration` + `rehydrate()`** for server rendering: skip the synchronous hydration at store creation (which causes a server/client hydration mismatch) and call `rehydrate()` on the plugin instance from an effect after React has hydrated.
- `actions()` warns in development when a second call reuses an action name, which would silently create a handle with fresh, independent status meta.
- README: API reference tables for every entry point, a section on what `batch` buys over React's own render batching, and persist SSR guidance.
- Examples import Stoic by its published name (`stoic-store`, aliased to the repo's `src/`), so their code is copy-pasteable into real apps.
