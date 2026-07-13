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

  it("does not write back to storage during rehydration", () => {
    localStorage.setItem("no-writeback-storage", JSON.stringify({ count: 7 }));
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    const store = createStore({
      state: { count: 0 },
      plugins: [persist<{ count: number }>({ key: "no-writeback-storage" })],
    });

    expect(store.getState().count).toBe(7);
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
    store.destroy();
  });

  describe("derived", () => {
    type Counter = { count: number };
    type CounterDerived = { doubled: number };

    it("does not write derived values to storage", () => {
      const store = createStore<Counter, CounterDerived>({
        state: { count: 0 },
        derived: { doubled: (s) => s.count * 2 },
        plugins: [persist<Counter>({ key: "derived-write-storage" })],
      });

      store.setState({ count: 3 });

      expect(JSON.parse(localStorage.getItem("derived-write-storage") as string)).toEqual({
        count: 3,
      });
      store.destroy();
    });

    it("ignores a stale derived value in stored data on rehydration", () => {
      localStorage.setItem("derived-stale-storage", JSON.stringify({ count: 0, doubled: 999 }));

      const store = createStore<Counter, CounterDerived>({
        state: { count: 0 },
        derived: { doubled: (s) => s.count * 2 },
        plugins: [persist<Counter>({ key: "derived-stale-storage" })],
      });

      expect(store.getState().doubled).toBe(0);

      // The stale payload is scrubbed on the next real write.
      store.setState({ count: 1 });
      expect(JSON.parse(localStorage.getItem("derived-stale-storage") as string)).toEqual({
        count: 1,
      });
      store.destroy();
    });

    it("recomputes with the current formula when a derived function has changed", () => {
      // Written by an older release whose `doubled` was `count * 2`.
      localStorage.setItem("derived-formula-storage", JSON.stringify({ count: 5, doubled: 10 }));

      const store = createStore<Counter, CounterDerived>({
        state: { count: 0 },
        derived: { doubled: (s) => s.count * 3 },
        plugins: [persist<Counter>({ key: "derived-formula-storage" })],
      });

      expect(store.getState().doubled).toBe(15);
      store.destroy();
    });

    it("throws at store creation if include names a derived key", () => {
      expect(() =>
        createStore<Counter, CounterDerived>({
          state: { count: 0 },
          derived: { doubled: (s) => s.count * 2 },
          plugins: [
            persist<Counter>({
              key: "derived-include-storage",
              // `include` is typed against raw state, so naming a derived key
              // takes a cast — the guard is for users who reach for one.
              include: ["doubled" as keyof Counter],
            }),
          ],
        }),
      ).toThrow(/doubled/);
    });

    it("treats a derived key in exclude as a no-op", () => {
      type Gated = { count: number; loading: boolean };

      const store = createStore<Gated, CounterDerived>({
        state: { count: 0, loading: false },
        derived: { doubled: (s) => s.count * 2 },
        plugins: [
          persist<Gated>({
            key: "derived-exclude-storage",
            exclude: ["loading", "doubled" as keyof Gated],
          }),
        ],
      });

      store.setState({ count: 4 });

      expect(JSON.parse(localStorage.getItem("derived-exclude-storage") as string)).toEqual({
        count: 4,
      });
      store.destroy();
    });

    it("keeps derived values out of debounced and destroy-flushed writes", () => {
      vi.useFakeTimers();

      const store = createStore<Counter, CounterDerived>({
        state: { count: 0 },
        derived: { doubled: (s) => s.count * 2 },
        plugins: [
          persist<Counter>({
            key: "derived-debounce-storage",
            debounceMs: 100,
          }),
        ],
      });

      store.setState({ count: 2 });
      store.destroy();

      expect(JSON.parse(localStorage.getItem("derived-debounce-storage") as string)).toEqual({
        count: 2,
      });

      vi.useRealTimers();
    });
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

  describe("failing writes", () => {
    it("warns on each failed write but stays active for later ones", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      let failWrites = true;
      const written: string[] = [];
      const storage = {
        getItem: () => null,
        setItem: (_key: string, value: string) => {
          if (failWrites) throw new Error("quota exceeded");
          written.push(value);
        },
      } as unknown as Storage;

      const store = createStore({
        state: { n: 0 },
        plugins: [persist<{ n: number }>({ key: "failing-storage", storage: () => storage })],
      });

      store.setState({ n: 1 });
      store.setState({ n: 2 });
      expect(warnSpy).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("write"));

      // Once the backend recovers (e.g. space was freed), writes resume.
      failWrites = false;
      store.setState({ n: 3 });
      expect(written).toEqual([JSON.stringify({ n: 3 })]);

      warnSpy.mockRestore();
      store.destroy();
    });
  });

  describe("unavailable storage", () => {
    it("disables itself with a single warning instead of warning on every write", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const store = createStore({
        state: { count: 0 },
        plugins: [
          persist<{ count: number }>({
            key: "unavailable-storage",
            // Mirrors `() => localStorage` on a server, where the global is undefined.
            storage: () => {
              throw new ReferenceError("localStorage is not defined");
            },
          }),
        ],
      });

      store.setState({ count: 1 });
      store.setState({ count: 2 });
      store.destroy();

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unavailable"));
      warnSpy.mockRestore();
    });
  });

  describe("version and migrate", () => {
    it("writes the state as a plain JSON value inside the envelope", () => {
      const store = createStore({
        state: { count: 0 },
        plugins: [persist<{ count: number }>({ key: "versioned-storage", version: 2 })],
      });

      store.setState({ count: 1 });

      // Not an escaped string: the envelope holds the state object directly.
      expect(JSON.parse(localStorage.getItem("versioned-storage") as string)).toEqual({
        version: 2,
        state: { count: 1 },
      });
      store.destroy();
    });

    it("rehydrates an envelope whose version matches", () => {
      localStorage.setItem(
        "versioned-match-storage",
        JSON.stringify({ version: 3, state: { count: 9 } }),
      );

      const store = createStore({
        state: { count: 0 },
        plugins: [persist<{ count: number }>({ key: "versioned-match-storage", version: 3 })],
      });

      expect(store.getState().count).toBe(9);
      store.destroy();
    });

    it("rehydrates a pre-1.0 envelope whose state is an escaped JSON string", () => {
      // Written by stoic-store <= 0.6, which double-serialized the state.
      localStorage.setItem(
        "versioned-legacy-envelope-storage",
        JSON.stringify({ version: 3, state: JSON.stringify({ count: 9 }) }),
      );

      const store = createStore({
        state: { count: 0 },
        plugins: [
          persist<{ count: number }>({ key: "versioned-legacy-envelope-storage", version: 3 }),
        ],
      });

      expect(store.getState().count).toBe(9);
      store.destroy();
    });

    it("runs migrate on an older payload and hydrates its result", () => {
      localStorage.setItem(
        "versioned-migrate-storage",
        JSON.stringify({ version: 1, state: { count: "7" } }),
      );
      const migrate = vi.fn((persisted: unknown) => ({
        count: Number((persisted as { count: string }).count),
      }));

      const store = createStore({
        state: { count: 0 },
        plugins: [
          persist<{ count: number }>({ key: "versioned-migrate-storage", version: 2, migrate }),
        ],
      });

      expect(migrate).toHaveBeenCalledWith({ count: "7" }, 1);
      expect(store.getState().count).toBe(7);
      store.destroy();
    });

    it("runs migrate on an older pre-1.0 string-state envelope", () => {
      localStorage.setItem(
        "versioned-migrate-legacy-storage",
        JSON.stringify({ version: 1, state: JSON.stringify({ count: "7" }) }),
      );
      const migrate = vi.fn((persisted: unknown) => ({
        count: Number((persisted as { count: string }).count),
      }));

      const store = createStore({
        state: { count: 0 },
        plugins: [
          persist<{ count: number }>({
            key: "versioned-migrate-legacy-storage",
            version: 2,
            migrate,
          }),
        ],
      });

      expect(migrate).toHaveBeenCalledWith({ count: "7" }, 1);
      expect(store.getState().count).toBe(7);
      store.destroy();
    });

    it("keeps string embedding for a custom serializer and round-trips it", () => {
      const serialize = (state: Partial<{ count: number }>) => `custom:${state.count}`;
      const deserialize = (raw: string) => ({ count: Number(raw.slice("custom:".length)) });

      const first = createStore({
        state: { count: 0 },
        plugins: [
          persist<{ count: number }>({
            key: "versioned-custom-storage",
            version: 2,
            serialize,
            deserialize,
          }),
        ],
      });
      first.setState({ count: 8 });
      first.destroy();

      // A custom serializer produces an opaque string, so it stays embedded.
      expect(JSON.parse(localStorage.getItem("versioned-custom-storage") as string)).toEqual({
        version: 2,
        state: "custom:8",
      });

      const second = createStore({
        state: { count: 0 },
        plugins: [
          persist<{ count: number }>({
            key: "versioned-custom-storage",
            version: 2,
            serialize,
            deserialize,
          }),
        ],
      });
      expect(second.getState().count).toBe(8);
      second.destroy();
    });

    it("discards stored state and warns on version mismatch without migrate", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      localStorage.setItem(
        "versioned-discard-storage",
        JSON.stringify({ version: 1, state: { count: 9 } }),
      );

      const store = createStore({
        state: { count: 0 },
        plugins: [persist<{ count: number }>({ key: "versioned-discard-storage", version: 2 })],
      });

      expect(store.getState().count).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("version"));
      warnSpy.mockRestore();
      store.destroy();
    });

    it("treats a legacy bare payload as version 0 and migrates it", () => {
      localStorage.setItem("versioned-legacy-storage", JSON.stringify({ count: "4" }));
      const migrate = vi.fn((persisted: unknown) => ({
        count: Number((persisted as { count: string }).count),
      }));

      const store = createStore({
        state: { count: 0 },
        plugins: [
          persist<{ count: number }>({ key: "versioned-legacy-storage", version: 1, migrate }),
        ],
      });

      expect(migrate).toHaveBeenCalledWith({ count: "4" }, 0);
      expect(store.getState().count).toBe(4);
      store.destroy();
    });
  });

  describe("rehydration with mismatched payloads", () => {
    it("keeps initial defaults for included keys missing from the stored payload", () => {
      localStorage.setItem("partial-include-storage", JSON.stringify({ theme: "light" }));

      const store = createStore({
        state: { theme: "dark", fontSize: 14 },
        plugins: [
          persist<{ theme: string; fontSize: number }>({
            key: "partial-include-storage",
            include: ["theme", "fontSize"],
          }),
        ],
      });

      expect(store.getState()).toEqual({ theme: "light", fontSize: 14 });
      store.destroy();
    });

    it("does not merge unknown keys from a stale stored payload into state", () => {
      localStorage.setItem("stale-keys-storage", JSON.stringify({ theme: "light", legacy: true }));

      const store = createStore({
        state: { theme: "dark" },
        plugins: [persist<{ theme: string }>({ key: "stale-keys-storage" })],
      });

      expect(store.getState()).toEqual({ theme: "light" });
      store.destroy();
    });
  });

  describe("skipHydration", () => {
    it("leaves initial state untouched until rehydrate() is called", () => {
      localStorage.setItem("skip-hydration-storage", JSON.stringify({ count: 42 }));

      const plugin = persist<{ count: number }>({
        key: "skip-hydration-storage",
        skipHydration: true,
      });
      const store = createStore({ state: { count: 0 }, plugins: [plugin] });

      expect(store.getState()).toEqual({ count: 0 });

      plugin.rehydrate();
      expect(store.getState()).toEqual({ count: 42 });
      store.destroy();
    });

    it("rehydrate() applies the same filtering as init hydration", () => {
      localStorage.setItem(
        "skip-hydration-filter-storage",
        JSON.stringify({ theme: "light", draft: "wip" }),
      );

      const plugin = persist<{ theme: string; draft: string }>({
        key: "skip-hydration-filter-storage",
        exclude: ["draft"],
        skipHydration: true,
      });
      const store = createStore({ state: { theme: "dark", draft: "" }, plugins: [plugin] });

      plugin.rehydrate();

      expect(store.getState()).toEqual({ theme: "light", draft: "" });
      store.destroy();
    });

    it("rehydrate() before the plugin is attached to a store warns and does nothing", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const plugin = persist<{ count: number }>({ key: "unattached-storage" });
      plugin.rehydrate();

      expect(warn).toHaveBeenCalledOnce();
      warn.mockRestore();
    });

    it("rehydrate() is a no-op without stored data", () => {
      const plugin = persist<{ count: number }>({
        key: "skip-hydration-empty-storage",
        skipHydration: true,
      });
      const store = createStore({ state: { count: 7 }, plugins: [plugin] });

      plugin.rehydrate();

      expect(store.getState()).toEqual({ count: 7 });
      store.destroy();
    });
  });

  describe("unavailable storage in production", () => {
    it("stays silent about unavailable storage in production builds", () => {
      vi.stubEnv("NODE_ENV", "production");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const store = createStore({
        state: { count: 0 },
        plugins: [
          persist<{ count: number }>({
            key: "prod-unavailable-storage",
            storage: () => {
              throw new Error("no storage here");
            },
          }),
        ],
      });
      store.setState({ count: 1 });

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
      vi.unstubAllEnvs();
      store.destroy();
    });
  });
});
