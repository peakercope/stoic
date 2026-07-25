# Installation

```bash
npm install stoic-store
# or
yarn add stoic-store
```

## Requirements

Stoic requires React 18 or later (it uses `useSyncExternalStore`). The package is published as **ESM only** — every modern bundler and Node 18+ consume it as-is, but legacy CommonJS-only toolchains are not supported.

Snapshots use **private class fields**, so the effective floor is **ES2022** (every browser since 2021–22, Node 16.14+). If your bundler is configured for a lower target it will downlevel them to a `WeakMap` — still correct, just marginally slower.

Stoic has no runtime dependencies.

## Development and production builds

Stoic publishes two builds and picks between them with the `production` [export condition](https://nodejs.org/api/packages.html#conditional-exports):
Your bundler sets the `production` condition (Vite, webpack and Next.js do in production mode)

The production build has every development-only warning folded out at build time. The default build is unchanged from previous versions: it reads `process.env.NODE_ENV` at runtime, so a bundler that doesn't understand the condition still gets silent-in-production behaviour. You do not need to configure anything either way.

Warnings that report a *real* runtime failure — `persist` being unable to read or write storage — are not development-only and ship in both builds.

## Entry points

The package has four entry points:

| Entry | Contents |
| --- | --- |
| `stoic-store` | `createStore` and the store itself. **React-free** — safe to import anywhere, including React Server Components. |
| `stoic-store/react` | The hooks: `useStore`, `useActionMeta`, and `createStoreContext`. |
| `stoic-store/plugins` | The built-in `persist` and `devtools` plugins. Each is also importable on its own from `stoic-store/plugins/persist` and `stoic-store/plugins/devtools`. |
| `stoic-store/tools` | The `shallow` equality helper. |

Every export of every entry point is listed in the [API Reference](./api-reference.md).

## Next steps

Head to the [Quick Start](./quick-start.md) to build your first store.
