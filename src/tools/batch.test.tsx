import { describe, expect, it, vi } from "vitest";
import { createStore } from "../stoic";
import { batch } from "./batch";

describe("batch", () => {
  it("recomputes derived state once and notifies listeners once for multiple actions", () => {
    const doubled = vi.fn((s: { count: number }) => s.count * 2);
    const store = createStore<{ count: number }, { doubled: number }>({
      state: { count: 0 },
      derived: { doubled },
    });
    const { setA, setB, setC } = store.actions({
      setA: (setState) => setState({ count: 1 }),
      setB: (setState) => setState((s) => ({ count: s.count + 1 })),
      setC: (setState) => setState((s) => ({ count: s.count + 1 })),
    });

    const listener = vi.fn();
    store.subscribe(listener);
    doubled.mockClear();

    batch(store, () => {
      setA();
      setB();
      setC();
    });

    expect(store.getState().count).toBe(3);
    expect(store.getState().doubled).toBe(6);
    expect(doubled).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
    store.destroy();
  });

  it("defers notification until an async batch resolves", async () => {
    const store = createStore({ state: { count: 0 } });
    const { increment } = store.actions({
      increment: async (setState) => {
        await Promise.resolve();
        setState((s) => ({ count: s.count + 1 }));
      },
    });

    const listener = vi.fn();
    store.subscribe(listener);

    const promise = batch(store, async () => {
      await increment();
      await increment();
    });

    expect(listener).not.toHaveBeenCalled();
    await promise;

    expect(store.getState().count).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
    store.destroy();
  });

  it("returns the sync callback's return value synchronously", () => {
    const store = createStore({ state: { count: 0 } });
    const result = batch(store, () => 42);
    expect(result).toBe(42);
    store.destroy();
  });

  it("returns a promise resolving to the async callback's return value", async () => {
    const store = createStore({ state: { count: 0 } });
    const result = batch(store, async () => {
      await Promise.resolve();
      return "done";
    });
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBe("done");
    store.destroy();
  });

  it("still flushes and notifies once if the sync callback throws", () => {
    const store = createStore({ state: { count: 0 } });
    const listener = vi.fn();
    store.subscribe(listener);

    expect(() =>
      batch(store, () => {
        store.setState({ count: 1 });
        throw new Error("boom");
      }),
    ).toThrow("boom");

    expect(store.getState().count).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    store.destroy();
  });

  it("still flushes and notifies once if the async callback rejects", async () => {
    const store = createStore({ state: { count: 0 } });
    const listener = vi.fn();
    store.subscribe(listener);

    await expect(
      batch(store, async () => {
        store.setState({ count: 1 });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(store.getState().count).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
    store.destroy();
  });

  it("does not flush until the outermost of nested batch calls ends", () => {
    const store = createStore({ state: { count: 0 } });
    const listener = vi.fn();
    store.subscribe(listener);

    batch(store, () => {
      store.setState({ count: 1 });
      batch(store, () => {
        store.setState({ count: 2 });
      });
      expect(listener).not.toHaveBeenCalled();
      store.setState({ count: 3 });
    });

    expect(store.getState().count).toBe(3);
    expect(listener).toHaveBeenCalledTimes(1);
    store.destroy();
  });

  it("works on a store with no subscribers yet", () => {
    const store = createStore({ state: { count: 0 } });

    batch(store, () => {
      store.setState({ count: 1 });
      store.setState((s) => ({ count: s.count + 1 }));
    });

    expect(store.getState().count).toBe(2);
    store.destroy();
  });

  it("reflects fully recomputed derived state immediately after the batch closes", () => {
    const store = createStore<{ count: number }, { doubled: number }>({
      state: { count: 0 },
      derived: { doubled: (s) => s.count * 2 },
    });
    store.subscribe(() => {});

    batch(store, () => {
      store.setState({ count: 5 });
    });

    expect(store.getState().doubled).toBe(10);
    store.destroy();
  });
});
