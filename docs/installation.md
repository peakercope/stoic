# Installation

```bash
npm install stoic-store
# or
yarn add stoic-store
```

## Requirements

Stoic requires React 18 or later (it uses `useSyncExternalStore`). The package is published as **ESM only** — every modern bundler and Node 18+ consume it as-is, but legacy CommonJS-only toolchains are not supported.

Stoic has no runtime dependencies.

## Entry points

The package has four entry points:

| Entry | Contents |
| --- | --- |
| `stoic-store` | `createStore` and the store itself. **React-free** — safe to import anywhere, including React Server Components. |
| `stoic-store/react` | The hooks: `useStore`, `useActionMeta`, and `createStoreContext`. |
| `stoic-store/plugins` | The built-in `persist` and `devtools` plugins. |
| `stoic-store/tools` | The `shallow` equality helper. |

Every export of every entry point is listed in the [API Reference](./api-reference.md).

## Next steps

Head to the [Quick Start](./quick-start.md) to build your first store.
