import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "../stoic";
import { persist } from "./persist";

describe("persist", () => {
  it("writes state to localStorage after setState", () => {
    const store = createStore({
      state: { count: 0 },
      plugins: [persist<{ count: number }>({ key: "count-storage" })],
    });

    store.setState({ count: 1 });

    expect(localStorage.getItem("count-storage")).toBe(JSON.stringify({ count: 1 }));
    store.destroy();
  });

  it("rehydrates state from a pre-populated localStorage entry on init", () => {
    localStorage.setItem("rehydrate-storage", JSON.stringify({ count: 42 }));

    const store = createStore({
      state: { count: 0 },
      plugins: [persist<{ count: number }>({ key: "rehydrate-storage" })],
    });

    expect(store.getState()).toEqual({ count: 42 });
    store.destroy();
  });

  it("respects a custom storage option", () => {
    const store = createStore({
      state: { count: 0 },
      plugins: [
        persist<{ count: number }>({
          key: "session-storage",
          storage: () => sessionStorage,
        }),
      ],
    });

    store.setState({ count: 7 });

    expect(sessionStorage.getItem("session-storage")).toBe(JSON.stringify({ count: 7 }));
    expect(localStorage.getItem("session-storage")).toBeNull();
    store.destroy();
  });

  it("falls back to initial state when the stored value is corrupt JSON", () => {
    localStorage.setItem("corrupt-storage", "{not json");

    const store = createStore({
      state: { count: 0 },
      plugins: [persist<{ count: number }>({ key: "corrupt-storage" })],
    });

    expect(store.getState()).toEqual({ count: 0 });
    store.destroy();
  });

  it("only persists included keys", () => {
    const store = createStore({
      state: { theme: "dark", loading: false },
      plugins: [
        persist<{ theme: string; loading: boolean }>({
          key: "include-storage",
          include: ["theme"],
        }),
      ],
    });

    store.setState({ theme: "light", loading: true });

    expect(JSON.parse(localStorage.getItem("include-storage") as string)).toEqual({
      theme: "light",
    });
    store.destroy();
  });

  it("persists all but excluded keys", () => {
    const store = createStore({
      state: { theme: "dark", loading: false },
      plugins: [
        persist<{ theme: string; loading: boolean }>({
          key: "exclude-storage",
          exclude: ["loading"],
        }),
      ],
    });

    store.setState({ theme: "light", loading: true });

    expect(JSON.parse(localStorage.getItem("exclude-storage") as string)).toEqual({
      theme: "light",
    });
    store.destroy();
  });

  it("throws if both include and exclude are passed", () => {
    expect(() =>
      persist<{ theme: string; loading: boolean }>({
        key: "invalid-storage",
        include: ["theme"],
        exclude: ["loading"],
      }),
    ).toThrow();
  });

  it("ignores excluded keys from stored data on rehydration", () => {
    localStorage.setItem(
      "rehydrate-exclude-storage",
      JSON.stringify({ theme: "light", loading: true }),
    );

    const store = createStore({
      state: { theme: "dark", loading: false },
      plugins: [
        persist<{ theme: string; loading: boolean }>({
          key: "rehydrate-exclude-storage",
          exclude: ["loading"],
        }),
      ],
    });

    expect(store.getState()).toEqual({ theme: "light", loading: false });
    store.destroy();
  });

  it("round-trips a non-JSON-native value through custom serialize/deserialize", () => {
    type State = { tags: Set<string> };

    const store = createStore({
      state: { tags: new Set(["a"]) },
      plugins: [
        persist<State>({
          key: "serialize-storage",
          serialize: (state) => JSON.stringify({ tags: [...(state.tags ?? [])] }),
          deserialize: (raw) => {
            const parsed = JSON.parse(raw) as { tags: string[] };
            return { tags: new Set(parsed.tags) };
          },
        }),
      ],
    });

    store.setState({ tags: new Set(["a", "b"]) });

    expect(localStorage.getItem("serialize-storage")).toBe(JSON.stringify({ tags: ["a", "b"] }));

    const rehydrated = createStore({
      state: { tags: new Set<string>() },
      plugins: [
        persist<State>({
          key: "serialize-storage",
          serialize: (state) => JSON.stringify({ tags: [...(state.tags ?? [])] }),
          deserialize: (raw) => {
            const parsed = JSON.parse(raw) as { tags: string[] };
            return { tags: new Set(parsed.tags) };
          },
        }),
      ],
    });

    expect(rehydrated.getState().tags).toEqual(new Set(["a", "b"]));
    store.destroy();
    rehydrated.destroy();
  });

  it("throws if both debounceMs and throttleMs are passed", () => {
    expect(() =>
      persist<{ count: number }>({
        key: "invalid-batching-storage",
        debounceMs: 100,
        throttleMs: 100,
      }),
    ).toThrow();
  });

  describe("debounceMs", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("coalesces rapid setState calls into a single write of the final state", () => {
      const store = createStore({
        state: { count: 0 },
        plugins: [
          persist<{ count: number }>({
            key: "debounce-storage",
            debounceMs: 100,
          }),
        ],
      });

      store.setState({ count: 1 });
      store.setState({ count: 2 });
      store.setState({ count: 3 });

      expect(localStorage.getItem("debounce-storage")).toBeNull();

      vi.advanceTimersByTime(100);

      expect(localStorage.getItem("debounce-storage")).toBe(JSON.stringify({ count: 3 }));
      store.destroy();
    });

    it("flushes a pending debounced write immediately on destroy", () => {
      const store = createStore({
        state: { count: 0 },
        plugins: [
          persist<{ count: number }>({
            key: "debounce-destroy-storage",
            debounceMs: 100,
          }),
        ],
      });

      store.setState({ count: 5 });
      store.destroy();

      expect(localStorage.getItem("debounce-destroy-storage")).toBe(JSON.stringify({ count: 5 }));
    });
  });

  describe("throttleMs", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("writes immediately on the first update, then trailing-writes the final state", () => {
      const store = createStore({
        state: { count: 0 },
        plugins: [
          persist<{ count: number }>({
            key: "throttle-storage",
            throttleMs: 100,
          }),
        ],
      });

      store.setState({ count: 1 });
      expect(localStorage.getItem("throttle-storage")).toBe(JSON.stringify({ count: 1 }));

      store.setState({ count: 2 });
      store.setState({ count: 3 });
      expect(localStorage.getItem("throttle-storage")).toBe(JSON.stringify({ count: 1 }));

      vi.advanceTimersByTime(100);
      expect(localStorage.getItem("throttle-storage")).toBe(JSON.stringify({ count: 3 }));
      store.destroy();
    });

    it("flushes a pending trailing write immediately on destroy", () => {
      const store = createStore({
        state: { count: 0 },
        plugins: [
          persist<{ count: number }>({
            key: "throttle-destroy-storage",
            throttleMs: 100,
          }),
        ],
      });

      store.setState({ count: 1 });
      store.setState({ count: 9 });
      store.destroy();

      expect(localStorage.getItem("throttle-destroy-storage")).toBe(JSON.stringify({ count: 9 }));
    });
  });
});
