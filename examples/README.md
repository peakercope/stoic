# Stoic Examples

Self-contained applications, each solving a realistic problem and teaching one or multiple
Stoic concepts. Every example is a standalone Vite + React + TypeScript app that imports
Stoic from this repository's `src/`, so changes to the library show up immediately.

```bash
cd examples/shopping-cart
yarn install
yarn dev
```

| Example | Teaches | Highlights |
| --- | --- | --- |
| [**shopping-cart**](shopping-cart) | Nested derived state, automatic dependency tracking | The flagship. A seven-step derived chain from `items` to `total` — subtotal, coupon discount, shipping, tax. Nothing is stored twice. |
| [**github-user-search**](github-user-search) | Async actions against a real API, derived filtering | Hits the real GitHub REST API. Sorting and filtering repos are derived — changing a control never refetches. |
| [**kanban-board**](kanban-board) | Complex state, derived stats, `batch` | A flat list of tasks; the columns, counts, overdue list and progress bar are all derived. Drag-and-drop is one `map`. |

## Which one should I read first?

**[shopping-cart](shopping-cart)** — it's the clearest demonstration of the idea the whole
library is built around: describe how a value is computed once, and never think about
keeping it up to date again.

Then pick whichever is closest to what you're building:

- Fetching data? → [github-user-search](github-user-search)
- A big, interconnected view model? → [kanban-board](kanban-board)

## What they have in common

- **No `useMemo` for derived values.** If a value is computed from state, it's in `derived`.
- **No hand-written `loading` / `error` flags.** Async actions expose their own status via
  `action.useMeta()`.
- **Selectors are narrow.** Components subscribe to the values they render, and use
  `shallow` when a selector returns an object.
