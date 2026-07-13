import * as React from "react";
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { createStoreContext } from "./context";
import { persist } from "./plugins";
import { createStore, type StoicPlugin } from "./stoic";
import { shallow } from "./tools";

type CartState = { items: string[]; taxRate: number };
type CartDerived = { count: number };

/** Renders `element` into a fresh root and returns handles to drive it. */
function render(element: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(element));

  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function makeCartContext() {
  return createStoreContext((initialItems: string[] = []) => {
    const store = createStore<CartState, CartDerived>({
      state: { items: initialItems, taxRate: 0.2 },
      derived: { count: ({ items }) => items.length },
    });

    const actions = store.actions({
      addItem: ({ set }, item: string) => set((s) => ({ items: [...s.items, item] })),
      loadItems: async ({ set }, items: string[]) => {
        await Promise.resolve();
        set({ items });
      },
    });

    return { store, actions };
  });
}

describe("createStoreContext", () => {
  it("gives each Provider an independent store", () => {
    const { Provider, useStore, useActions } = makeCartContext();

    function Cart({ label }: { label: string }) {
      const count = useStore((s) => s.count);
      const { addItem } = useActions();
      return (
        <button type="button" data-label={label} onClick={() => addItem("x")}>
          {label}:{count}
        </button>
      );
    }

    const view = render(
      <>
        <Provider>
          <Cart label="a" />
        </Provider>
        <Provider>
          <Cart label="b" />
        </Provider>
      </>,
    );

    const [buttonA] = Array.from(view.container.querySelectorAll("button"));
    act(() => buttonA?.click());

    expect(view.container.textContent).toContain("a:1");
    expect(view.container.textContent).toContain("b:0");

    view.unmount();
  });

  it("seeds the store from `init` and builds it exactly once per Provider", () => {
    const factory = vi.fn((initialItems: string[] = []) => {
      const store = createStore({ state: { items: initialItems } });
      const actions = store.actions({
        touch: ({ set }) => set((s) => ({ items: [...s.items] })),
      });
      return { store, actions };
    });
    const { Provider, useStore } = createStoreContext(factory);

    let renders = 0;
    function View() {
      renders++;
      const items = useStore((s) => s.items);
      return <span>{items.join(",")}</span>;
    }

    const view = render(
      <Provider init={["seeded"]}>
        <View />
      </Provider>,
    );

    expect(view.container.textContent).toBe("seeded");
    expect(factory).toHaveBeenCalledTimes(1);
    expect(factory).toHaveBeenCalledWith(["seeded"]);
    expect(renders).toBeGreaterThan(0);

    view.unmount();
  });

  it("re-renders only for the selected slice, honoring a custom equality", () => {
    const { Provider, useStore, useStoreApi } = makeCartContext();
    const renders = vi.fn();
    let api!: ReturnType<typeof useStoreApi>;

    function View() {
      renders();
      const { count } = useStore((s) => ({ count: s.count }), shallow);
      api = useStoreApi();
      return <span>{count}</span>;
    }

    const view = render(
      <Provider>
        <View />
      </Provider>,
    );

    const before = renders.mock.calls.length;

    // `taxRate` feeds no selected value → no re-render.
    act(() => api.setState({ taxRate: 0.5 }));
    expect(renders.mock.calls.length).toBe(before);

    act(() => api.setState({ items: ["a"] }));
    expect(renders.mock.calls.length).toBe(before + 1);
    expect(view.container.textContent).toBe("1");

    view.unmount();
  });

  it("returns stable action handles whose useMeta tracks async status", async () => {
    const { Provider, useActions } = makeCartContext();
    const seen: string[] = [];
    let handles: ReturnType<typeof useActions> | undefined;
    let sameHandles = true;

    function View() {
      const actions = useActions();
      if (handles && handles !== actions) sameHandles = false;
      handles = actions;
      seen.push(actions.loadItems.useMeta().status);
      return null;
    }

    const view = render(
      <Provider>
        <View />
      </Provider>,
    );

    expect(seen.at(-1)).toBe("idle");

    // Invoke in a sync act: React 18's act defers renders scheduled inside an
    // async callback until it resolves, so awaiting the action in the same act
    // would flush only after meta already reads "success".
    let promise: Promise<void> | undefined;
    act(() => {
      promise = handles?.loadItems(["a", "b"]);
    });
    expect(seen.at(-1)).toBe("pending");

    await act(async () => {
      await promise;
    });

    expect(seen.at(-1)).toBe("success");
    expect(sameHandles).toBe(true);

    view.unmount();
  });

  it("keeps the store alive through a StrictMode double-mount", () => {
    const { Provider, useStore, useActions } = makeCartContext();

    function Cart() {
      const count = useStore((s) => s.count);
      const { addItem } = useActions();
      return (
        <button type="button" onClick={() => addItem("x")}>
          {count}
        </button>
      );
    }

    const view = render(
      <StrictMode>
        <Provider>
          <Cart />
        </Provider>
      </StrictMode>,
    );

    const button = view.container.querySelector("button");
    act(() => button?.click());

    // A store destroyed by StrictMode's mount→unmount→mount cycle would ignore
    // this write and still read 0.
    expect(view.container.textContent).toBe("1");

    view.unmount();
  });

  it("destroys the store on a real unmount, flushing a pending persist write", async () => {
    const onDestroy = vi.fn();
    const plugin: StoicPlugin<{ count: number }> = { onDestroy };
    const { Provider, useStore, useActions } = createStoreContext(() => {
      const store = createStore({
        state: { count: 0 },
        plugins: [plugin, persist<{ count: number }>({ key: "ctx-storage", debounceMs: 1000 })],
      });
      const actions = store.actions({
        inc: ({ set }) => set((s) => ({ count: s.count + 1 })),
      });
      return { store, actions };
    });

    function View() {
      const count = useStore((s) => s.count);
      const { inc } = useActions();
      return (
        <button type="button" onClick={() => inc()}>
          {count}
        </button>
      );
    }

    const view = render(
      <Provider>
        <View />
      </Provider>,
    );

    const button = view.container.querySelector("button");
    act(() => button?.click());
    // The write is debounced by 1s, so nothing has reached storage yet.
    expect(localStorage.getItem("ctx-storage")).toBeNull();

    view.unmount();

    await vi.waitFor(() => {
      expect(onDestroy).toHaveBeenCalledOnce();
      // destroy() must flush the still-pending debounced write.
      expect(JSON.parse(localStorage.getItem("ctx-storage") as string)).toEqual({ count: 1 });
    });
    localStorage.removeItem("ctx-storage");
  });

  // React 18 has no <Activity>; the React-18 CI job skips these.
  const Activity = (
    React as {
      Activity?: React.ComponentType<{ mode: "visible" | "hidden"; children?: React.ReactNode }>;
    }
  ).Activity;

  describe.skipIf(!Activity)("<Activity>", () => {
    const Boundary = Activity as NonNullable<typeof Activity>;

    it("recreates the store when revealed after being destroyed while hidden", async () => {
      const onDestroy = vi.fn();
      const factory = vi.fn(() => {
        const store = createStore({
          state: { count: 0 },
          plugins: [{ onDestroy } satisfies StoicPlugin<{ count: number }>],
        });
        const actions = store.actions({
          inc: ({ set }) => set((s) => ({ count: s.count + 1 })),
        });
        return { store, actions };
      });
      const { Provider, useStore, useActions } = createStoreContext(factory);

      function View() {
        const count = useStore((s) => s.count);
        const { inc } = useActions();
        return (
          <button type="button" onClick={() => inc()}>
            {count}
          </button>
        );
      }

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      const tree = (mode: "visible" | "hidden") => (
        <Boundary mode={mode}>
          <Provider>
            <View />
          </Provider>
        </Boundary>
      );

      act(() => root.render(tree("visible")));

      // Hide the subtree: effects clean up, the deferred destroy fires while
      // hidden — flushing plugins like a pending persist write.
      await act(async () => root.render(tree("hidden")));
      expect(onDestroy).toHaveBeenCalledOnce();

      // Reveal: the Provider must not hand out the destroyed store.
      await act(async () => root.render(tree("visible")));
      expect(factory).toHaveBeenCalledTimes(2);

      const button = container.querySelector("button");
      act(() => button?.click());
      expect(container.textContent).toBe("1");

      act(() => root.unmount());
      container.remove();
    });

    it("does not destroy the store on a hide immediately followed by a reveal", async () => {
      const onDestroy = vi.fn();
      const { Provider, useStore } = createStoreContext(() => {
        const store = createStore({
          state: { count: 0 },
          plugins: [{ onDestroy } satisfies StoicPlugin<{ count: number }>],
        });
        return { store, actions: {} };
      });

      function View() {
        return <span>{useStore((s) => s.count)}</span>;
      }

      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      const tree = (mode: "visible" | "hidden") => (
        <Boundary mode={mode}>
          <Provider>
            <View />
          </Provider>
        </Boundary>
      );

      act(() => root.render(tree("visible")));

      // Hide and reveal before the deferred destroy's microtask can run.
      act(() => {
        root.render(tree("hidden"));
        root.render(tree("visible"));
      });
      await act(async () => {});

      expect(onDestroy).not.toHaveBeenCalled();

      act(() => root.unmount());
      container.remove();
    });
  });

  it("throws a helpful error when its hooks are used outside the Provider", () => {
    const { useStore, useActions, useStoreApi } = makeCartContext();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    for (const hook of [useStore, useActions, useStoreApi]) {
      function Orphan() {
        hook();
        return null;
      }
      expect(() => render(<Orphan />)).toThrow(/Provider/);
    }

    errors.mockRestore();
  });
});
