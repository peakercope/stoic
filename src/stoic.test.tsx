import * as React from "react";
import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CircularDependencyError, createStore, type StoicPlugin } from "../src/stoic";
import { useActionMeta, useStore } from "./react";
import { shallow } from "./tools/shallow";

// ─── Core store (no React) ────────────────────────────────────────────────────

describe("getState", () => {
  it("returns the initial state", () => {
    const { getState } = createStore({ state: { count: 0, name: "stoic" } });
    expect(getState()).toEqual({ count: 0, name: "stoic" });
  });
});

describe("setState", () => {
  it("merges a partial object into state", () => {
    const { getState, setState } = createStore({
      state: { count: 0, name: "stoic" },
    });
    setState({ count: 1 });
    expect(getState()).toEqual({ count: 1, name: "stoic" });
  });

  it("receives current state when called with a function", () => {
    const { getState, setState } = createStore({ state: { count: 5 } });
    setState((s) => ({ count: s.count + 1 }));
    expect(getState().count).toBe(6);
  });

  it("can be called multiple times, accumulating changes", () => {
    const { getState, setState } = createStore({ state: { a: 1, b: 2 } });
    setState({ a: 10 });
    setState({ b: 20 });
    expect(getState()).toEqual({ a: 10, b: 20 });
  });

  it("does not mark a key dirty when set to its current value", () => {
    const doubled = vi.fn((s: { count: number }) => s.count * 2);
    const { getState, setState } = createStore<{ count: number }, { doubled: number }>({
      state: { count: 5 },
      derived: { doubled },
    });
    doubled.mockClear();

    setState({ count: 5 });

    expect(doubled).not.toHaveBeenCalled();
    expect(getState().count).toBe(5);
  });
});

describe("subscribe", () => {
  it("calls listener with new state after setState", () => {
    const { setState, subscribe } = createStore({ state: { count: 0 } });
    const listener = vi.fn();
    subscribe(listener);
    setState({ count: 1 });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ count: 1 }));
  });

  it("returned unsubscribe stops future notifications", () => {
    const { setState, subscribe } = createStore({ state: { count: 0 } });
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    unsubscribe();
    setState({ count: 1 });
    expect(listener).not.toHaveBeenCalled();
  });

  it("notifies all subscribed listeners", () => {
    const { setState, subscribe } = createStore({ state: { x: 0 } });
    const a = vi.fn();
    const b = vi.fn();
    subscribe(a);
    subscribe(b);
    setState({ x: 99 });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("does not call unsubscribed listener while others still receive updates", () => {
    const { setState, subscribe } = createStore({ state: { x: 0 } });
    const a = vi.fn();
    const b = vi.fn();
    subscribe(a);
    const unsubscribeB = subscribe(b);
    unsubscribeB();
    setState({ x: 1 });
    expect(a).toHaveBeenCalledOnce();
    expect(b).not.toHaveBeenCalled();
  });
});

describe("derived", () => {
  it("immediately adds the derived key to state", () => {
    const { getState } = createStore<{ count: number }, { doubled: number }>({
      state: { count: 3 },
      derived: { doubled: (s) => s.count * 2 },
    });
    expect(getState().doubled).toBe(6);
  });

  it("recomputes derived value after setState", () => {
    const { getState, setState } = createStore<{ count: number }, { doubled: number }>({
      state: { count: 3 },
      derived: { doubled: (s) => s.count * 2 },
    });
    setState({ count: 10 });
    expect(getState().doubled).toBe(20);
  });

  it("supports multiple independent derivations", () => {
    const { getState, setState } = createStore<
      { count: number },
      { doubled: number; squared: number }
    >({
      state: { count: 4 },
      derived: {
        doubled: (s) => s.count * 2,
        squared: (s) => s.count ** 2,
      },
    });
    expect(getState().doubled).toBe(8);
    expect(getState().squared).toBe(16);
    setState({ count: 3 });
    expect(getState().doubled).toBe(6);
    expect(getState().squared).toBe(9);
  });

  it("supports a derivation reading an earlier-declared derived key", () => {
    const { getState, setState } = createStore<
      { price: number; tax: number },
      { subtotal: number; total: number }
    >({
      state: { price: 100, tax: 0.2 },
      derived: {
        subtotal: (s) => s.price,
        total: (s) => s.subtotal * (1 + s.tax),
      },
    });
    expect(getState().total).toBe(120);
    setState({ price: 200 });
    expect(getState().total).toBe(240);
  });

  it("does not recompute a derived value whose dependency did not change", () => {
    const subtotal = vi.fn((s: { price: number; count: number }) => s.price * s.count);
    const { getState, setState } = createStore<
      { price: number; count: number; tax: number },
      { subtotal: number }
    >({
      state: { price: 10, count: 2, tax: 0.1 },
      derived: { subtotal },
    });
    // Derived values are lazy, so nothing has run until the first read.
    expect(subtotal).not.toHaveBeenCalled();
    expect(getState().subtotal).toBe(20);
    expect(subtotal).toHaveBeenCalledTimes(1);

    setState({ tax: 0.2 });

    expect(getState().subtotal).toBe(20);
    expect(subtotal).toHaveBeenCalledTimes(1);
  });

  it("cascades recomputation transitively through a chain of derived values", () => {
    const subtotal = vi.fn((s: { price: number; count: number }) => s.price * s.count);
    const total = vi.fn((s: { subtotal: number; tax: number }) => s.subtotal * (1 + s.tax));
    const finalPrice = vi.fn(
      (s: { total: number; discount: number }) => s.total * (1 - s.discount),
    );
    const { getState, setState, subscribe } = createStore<
      { price: number; count: number; tax: number; discount: number },
      { subtotal: number; total: number; finalPrice: number }
    >({
      state: { price: 100, count: 1, tax: 0.1, discount: 0.05 },
      derived: {
        subtotal: (s) => subtotal(s),
        total: (s) => total(s),
        finalPrice: (s) => finalPrice(s),
      },
    });
    subscribe(vi.fn());
    subtotal.mockClear();
    total.mockClear();
    finalPrice.mockClear();

    setState({ price: 200 });

    expect(getState().finalPrice).toBeCloseTo(200 * (1 + 0.1) * (1 - 0.05));
    expect(subtotal).toHaveBeenCalledTimes(1);
    expect(total).toHaveBeenCalledTimes(1);
    expect(finalPrice).toHaveBeenCalledTimes(1);
  });

  it("only recomputes the directly-dependent derived value for a leaf field change", () => {
    const subtotal = vi.fn((s: { price: number; count: number }) => s.price * s.count);
    const total = vi.fn((s: { subtotal: number; tax: number }) => s.subtotal * (1 + s.tax));
    const finalPrice = vi.fn(
      (s: { total: number; discount: number }) => s.total * (1 - s.discount),
    );
    const { getState, setState, subscribe } = createStore<
      { price: number; count: number; tax: number; discount: number },
      { subtotal: number; total: number; finalPrice: number }
    >({
      state: { price: 100, count: 1, tax: 0.1, discount: 0.05 },
      derived: {
        subtotal: (s) => subtotal(s),
        total: (s) => total(s),
        finalPrice: (s) => finalPrice(s),
      },
    });
    subscribe(vi.fn());
    // Warm the chain first: derived values are lazy, so without a read there is
    // nothing cached for the write to invalidate selectively.
    getState().finalPrice;
    subtotal.mockClear();
    total.mockClear();
    finalPrice.mockClear();

    setState({ discount: 0.1 });

    expect(getState().finalPrice).toBeCloseTo(100 * (1 + 0.1) * (1 - 0.1));
    expect(subtotal).not.toHaveBeenCalled();
    expect(total).not.toHaveBeenCalled();
    expect(finalPrice).toHaveBeenCalledTimes(1);
  });

  it("does not cascade when a recomputed derived value is unchanged", () => {
    const parity = vi.fn((s: { n: number }) => s.n % 2);
    const label = vi.fn((s: { parity: number }) => (s.parity === 0 ? "even" : "odd"));
    const { getState, setState, subscribe } = createStore<
      { n: number },
      { parity: number; label: string }
    >({
      state: { n: 2 },
      derived: {
        parity: (s) => parity(s),
        label: (s) => label(s),
      },
    });
    subscribe(vi.fn());
    getState().label;
    parity.mockClear();
    label.mockClear();

    setState({ n: 4 });

    expect(getState().label).toBe("even");
    expect(parity).toHaveBeenCalledTimes(1);
    expect(label).not.toHaveBeenCalled();
  });

  it("exposes a derived key as a lazy enumerable getter that self-memoizes into a data property on first read", () => {
    const doubled = vi.fn((s: { count: number }) => s.count * 2);
    const { getState, setState } = createStore<{ count: number }, { doubled: number }>({
      state: { count: 3 },
      derived: { doubled },
    });

    // A fresh snapshot (past the dev-only eager pass at creation) exposes the
    // derived key as an enumerable getter on its prototype chain (per-store
    // proto → shared getter proto); inspecting it computes nothing and the
    // snapshot has no own property yet.
    setState({ count: 4 });
    const snapshot = getState();
    doubled.mockClear();
    expect(Object.getOwnPropertyDescriptor(snapshot, "doubled")).toBeUndefined();
    const proto = Object.getPrototypeOf(Object.getPrototypeOf(snapshot) as object) as object;
    const before = Object.getOwnPropertyDescriptor(proto, "doubled");
    expect(before?.get).toBeTypeOf("function");
    expect(before?.enumerable).toBe(true);
    expect("doubled" in snapshot).toBe(true);
    expect(doubled).not.toHaveBeenCalled();

    // The first read pins the value as a plain enumerable data property, so
    // repeat reads on this snapshot are plain property accesses.
    expect(snapshot.doubled).toBe(8);
    const after = Object.getOwnPropertyDescriptor(snapshot, "doubled");
    expect(after?.get).toBeUndefined();
    expect(after?.value).toBe(8);
    expect(after?.enumerable).toBe(true);

    const rawDesc = Object.getOwnPropertyDescriptor(snapshot, "count");
    expect(rawDesc?.get).toBeUndefined();
    expect(rawDesc?.value).toBe(4);
  });

  it("tracks non-string (symbol) property reads on the proxied state without adding them as dependencies", () => {
    const doubled = vi.fn((s: { count: number }) => {
      Reflect.get(s, Symbol.iterator);
      return s.count * 2;
    });
    const { getState, setState } = createStore<
      { count: number; other: number },
      { doubled: number }
    >({
      state: { count: 3, other: 0 },
      derived: { doubled },
    });
    expect(getState().doubled).toBe(6);
    doubled.mockClear();

    setState({ other: 1 });

    expect(doubled).not.toHaveBeenCalled();
  });
});

describe("old-snapshot derived reads", () => {
  it("computes at most once per snapshot when old and new snapshots are read alternately", () => {
    const doubled = vi.fn((s: { count: number }) => s.count * 2);
    const { getState, setState } = createStore<{ count: number }, { doubled: number }>({
      state: { count: 1 },
      derived: { doubled },
    });

    const before = getState();
    setState({ count: 2 });
    const after = getState();

    // Warm both snapshots once, then verify alternating reads never recompute.
    expect(before.doubled).toBe(2);
    expect(after.doubled).toBe(4);
    doubled.mockClear();

    expect(after.doubled).toBe(4);
    expect(before.doubled).toBe(2);
    expect(after.doubled).toBe(4);
    expect(before.doubled).toBe(2);

    expect(doubled).not.toHaveBeenCalled();
  });

  it("does not let an old-snapshot read invalidate the live memo", () => {
    const doubled = vi.fn((s: { count: number }) => s.count * 2);
    const { getState, setState } = createStore<{ count: number }, { doubled: number }>({
      state: { count: 1 },
      derived: { doubled },
    });

    const first = getState();
    expect(first.doubled).toBe(2);

    setState({ count: 2 });
    const middle = getState();
    setState({ count: 1 });
    const live = getState();

    doubled.mockClear();
    // A retained older snapshot has to compute its own value…
    expect(middle.doubled).toBe(4);
    expect(doubled).toHaveBeenCalledTimes(1);

    doubled.mockClear();
    // …but it must not retune the shared record to that older state. The live
    // snapshot is back at count: 1, which is what the record already describes,
    // so this read is a cache hit. Letting the stale read write the record made
    // it describe count: 2 and forced this recompute for nothing.
    expect(live.doubled).toBe(2);
    expect(doubled).not.toHaveBeenCalled();
  });

  it("retries a derived value that threw", () => {
    let boom = true;
    const flaky = vi.fn((s: { count: number }) => {
      if (boom) throw new Error("nope");
      return s.count * 2;
    });
    const { getState } = createStore<{ count: number }, { flaky: number }>({
      state: { count: 3 },
      derived: { flaky },
    });

    expect(() => getState().flaky).toThrow("nope");
    boom = false;
    expect(getState().flaky).toBe(6);
    expect(flaky).toHaveBeenCalledTimes(2);
  });

  it("keeps a stable reference per snapshot for object-returning derived values", () => {
    const { getState, setState } = createStore<{ n: number }, { wrapped: { n: number } }>({
      state: { n: 1 },
      derived: { wrapped: (s) => ({ n: s.n }) },
    });

    const before = getState();
    setState({ n: 2 });
    const after = getState();

    const beforeRef = before.wrapped;
    const afterRef = after.wrapped;
    expect(before.wrapped).toBe(beforeRef);
    expect(after.wrapped).toBe(afterRef);
    expect(beforeRef).toEqual({ n: 1 });
    expect(afterRef).toEqual({ n: 2 });
  });
});

// ─── lazy/mount-aware derived recomputation ───────────────────────────────────

describe("lazy/mount-aware derived recomputation", () => {
  it("does not recompute derived values while the store has no listeners", () => {
    const doubled = vi.fn((s: { count: number }) => s.count * 2);
    const { setState } = createStore<{ count: number }, { doubled: number }>({
      state: { count: 1 },
      derived: { doubled },
    });
    doubled.mockClear();

    setState({ count: 2 });
    setState({ count: 3 });

    expect(doubled).not.toHaveBeenCalled();
  });

  it("coalesces multiple unobserved setState calls into a single recompute", () => {
    const doubled = vi.fn((s: { count: number }) => s.count * 2);
    const { getState, setState } = createStore<{ count: number }, { doubled: number }>({
      state: { count: 1 },
      derived: { doubled },
    });
    doubled.mockClear();

    setState({ count: 2 });
    setState({ count: 3 });
    setState({ count: 4 });

    expect(doubled).not.toHaveBeenCalled();
    expect(getState().doubled).toBe(8);
    expect(doubled).toHaveBeenCalledTimes(1);
  });

  it("getState() flushes pending recomputation and returns a fresh value", () => {
    const { getState, setState } = createStore<{ count: number }, { doubled: number }>({
      state: { count: 1 },
      derived: { doubled: (s) => s.count * 2 },
    });

    setState({ count: 5 });

    expect(getState().doubled).toBe(10);
  });

  it("subscribing flushes pending state without invoking the new listener immediately", () => {
    const doubled = vi.fn((s: { count: number }) => s.count * 2);
    const { getState, setState, subscribe } = createStore<{ count: number }, { doubled: number }>({
      state: { count: 1 },
      derived: { doubled },
    });
    doubled.mockClear();

    setState({ count: 5 });
    expect(doubled).not.toHaveBeenCalled();

    const listener = vi.fn();
    subscribe(listener);

    expect(listener).not.toHaveBeenCalled();
    expect(getState().doubled).toBe(10);
    expect(doubled).toHaveBeenCalledTimes(1);
  });

  it("computes at most once per state change no matter how often it is read", () => {
    const doubled = vi.fn((s: { count: number }) => s.count * 2);
    const { getState, setState, subscribe } = createStore<{ count: number }, { doubled: number }>({
      state: { count: 1 },
      derived: { doubled },
    });
    subscribe(vi.fn());
    doubled.mockClear();

    setState({ count: 2 });
    expect(getState().doubled).toBe(4);
    expect(getState().doubled).toBe(4);
    expect(doubled).toHaveBeenCalledTimes(1);

    setState({ count: 3 });
    expect(getState().doubled).toBe(6);
    expect(doubled).toHaveBeenCalledTimes(2);
  });

  it("falls back to deferred recomputation after the last listener unsubscribes", () => {
    const doubled = vi.fn((s: { count: number }) => s.count * 2);
    const { getState, setState, subscribe } = createStore<{ count: number }, { doubled: number }>({
      state: { count: 1 },
      derived: { doubled },
    });
    const unsubscribe = subscribe(vi.fn());
    unsubscribe();
    doubled.mockClear();

    setState({ count: 9 });

    expect(doubled).not.toHaveBeenCalled();
    expect(getState().doubled).toBe(18);
  });

  it("an afterSetState plugin can read fresh derived values from the snapshot it receives", () => {
    const doubled = vi.fn((s: { count: number }) => s.count * 2);
    const seen: number[] = [];
    const { setState } = createStore<{ count: number }, { doubled: number }>({
      state: { count: 1 },
      derived: { doubled },
      plugins: [{ afterSetState: (s) => seen.push((s as { doubled: number }).doubled) }],
    });
    doubled.mockClear();

    setState({ count: 2 });

    expect(seen).toEqual([4]);
    expect(doubled).toHaveBeenCalledTimes(1);
  });

  it("an afterSetState plugin that does not read derived values does not trigger computation", () => {
    const doubled = vi.fn((s: { count: number }) => s.count * 2);
    const afterSetState = vi.fn();
    const { getState, setState } = createStore<{ count: number }, { doubled: number }>({
      state: { count: 1 },
      derived: { doubled },
      plugins: [{ afterSetState: () => afterSetState() }],
    });
    doubled.mockClear();

    setState({ count: 2 });

    expect(afterSetState).toHaveBeenCalledTimes(1);
    expect(doubled).not.toHaveBeenCalled();
    expect(getState().doubled).toBe(4);
  });

  it("surfaces a CircularDependencyError on the read of the cyclic key, not on setState", () => {
    const { getState, setState } = createStore<{ flag: boolean }, { a: number; b: number }>({
      state: { flag: false },
      derived: {
        a: (s) => (s.flag ? s.b + 1 : 0),
        b: (s) => (s.flag ? s.a + 1 : 0),
      },
    });

    expect(() => setState({ flag: true })).not.toThrow();
    expect(() => getState().a).toThrow(new CircularDependencyError(["a", "b", "a"]));
  });
});

// ─── circular dependency detection ────────────────────────────────────────────

describe("circular dependency detection", () => {
  // Derived values are lazy in every mode, so a cycle surfaces on the read that
  // walks into it rather than at createStore. The message still names the whole
  // chain, which is the part that makes it actionable.
  it("throws for a 2-node cycle on read", () => {
    const { getState } = createStore<Record<string, never>, { a: number; b: number }>({
      state: {},
      derived: {
        a: (s) => s.b + 1,
        b: (s) => s.a + 1,
      },
    });

    expect(() => getState().a).toThrow(new CircularDependencyError(["a", "b", "a"]));
  });

  it("throws with the full chain for a 3-node cycle", () => {
    const { getState } = createStore<Record<string, never>, { A: number; B: number; C: number }>({
      state: {},
      derived: {
        A: (s) => s.B + 1,
        B: (s) => s.C + 1,
        C: (s) => s.A + 1,
      },
    });

    expect(() => getState().A).toThrow(new CircularDependencyError(["A", "B", "C", "A"]));
  });

  it("reports the chain from whichever key the read entered on", () => {
    const { getState } = createStore<Record<string, never>, { A: number; B: number; C: number }>({
      state: {},
      derived: {
        A: (s) => s.B + 1,
        B: (s) => s.C + 1,
        C: (s) => s.A + 1,
      },
    });

    expect(() => getState().B).toThrow(new CircularDependencyError(["B", "C", "A", "B"]));
  });

  it("throws for a derived key that depends on itself", () => {
    const { getState } = createStore<Record<string, never>, { a: number }>({
      state: {},
      derived: { a: (s) => s.a + 1 },
    });

    expect(() => getState().a).toThrow(new CircularDependencyError(["a", "a"]));
  });

  it("creating a store with a cyclic config does not throw on its own", () => {
    const create = () =>
      createStore<Record<string, never>, { a: number; b: number }>({
        state: {},
        derived: { a: (s) => s.b + 1, b: (s) => s.a + 1 },
      });

    expect(create).not.toThrow();
  });

  it("throws on read once a cycle only manifests via a later setState", () => {
    const { getState, setState, subscribe } = createStore<
      { flag: boolean },
      { a: number; b: number }
    >({
      state: { flag: false },
      derived: {
        a: (s) => (s.flag ? s.b + 1 : 0),
        b: (s) => (s.flag ? s.a + 1 : 0),
      },
    });
    subscribe(vi.fn());
    setState({ flag: true });

    expect(() => getState().a).toThrow(new CircularDependencyError(["a", "b", "a"]));
  });

  it("behaves the same in production builds", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const store = createStore<{ a: number }, { b: number; c: number }>({
        state: { a: 1 },
        derived: { b: (s) => s.c, c: (s) => s.b },
      });
      expect(() => store.getState().b).toThrow(CircularDependencyError);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not throw for a non-cyclic diamond of dependencies", () => {
    const create = () =>
      createStore<{ n: number }, { a: number; b: number; c: number; d: number }>({
        state: { n: 1 },
        derived: {
          a: (s) => s.n + 1,
          b: (s) => s.a + 1,
          c: (s) => s.a + 2,
          d: (s) => s.b + s.c,
        },
      });

    expect(create).not.toThrow();
  });
});

// ─── action ───────────────────────────────────────────────────────────────────

describe("action context", () => {
  it("provides get for reading current state inside an action", () => {
    const store = createStore({ state: { count: 5, snapshot: 0 } });
    const { record } = store.actions({
      record: ({ set, get }) => set({ snapshot: get().count }),
    });

    record();

    expect(store.getState().snapshot).toBe(5);
  });

  it("get reflects earlier writes within the same action", () => {
    const store = createStore({ state: { count: 1, seen: 0 } });
    const { bump } = store.actions({
      bump: ({ set, get }) => {
        set({ count: 10 });
        set({ seen: get().count });
      },
    });

    bump();

    expect(store.getState().seen).toBe(10);
  });

  it("get reads fresh state after an await in an async action", async () => {
    const store = createStore({ state: { count: 1, seen: 0 } });
    const { probe } = store.actions({
      probe: async ({ set, get }) => {
        await Promise.resolve();
        set({ seen: get().count });
      },
    });

    const promise = probe();
    store.setState({ count: 42 });
    await promise;

    expect(store.getState().seen).toBe(42);
  });

  it("get sees derived values", () => {
    const store = createStore<{ count: number; copy: number }, { doubled: number }>({
      state: { count: 3, copy: 0 },
      derived: { doubled: (s) => s.count * 2 },
    });
    const { snap } = store.actions({
      snap: ({ set, get }) => set({ copy: get().doubled }),
    });

    snap();

    expect(store.getState().copy).toBe(6);
  });
});

describe("action", () => {
  it("sync action updates state", () => {
    const { getState, actions } = createStore({ state: { count: 0 } });
    const { inc } = actions({
      inc: ({ set }) => set((s) => ({ count: s.count + 1 })),
    });
    inc();
    expect(getState().count).toBe(1);
  });

  it("sync action receives current state", () => {
    const { getState, setState, actions } = createStore({
      state: { count: 5 },
    });
    const { inc } = actions({
      inc: ({ set }) => set((s) => ({ count: s.count + 1 })),
    });
    setState({ count: 10 });
    inc();
    expect(getState().count).toBe(11);
  });

  it("sync action supports extra arguments", () => {
    const { getState, actions } = createStore({ state: { count: 0 } });
    const { add } = actions({
      add: ({ set }, amount: number) => set((s) => ({ count: s.count + amount })),
    });
    add(5);
    expect(getState().count).toBe(5);
    add(3);
    expect(getState().count).toBe(8);
  });

  it("sync action notifies subscribers", () => {
    const { subscribe, actions } = createStore({ state: { count: 0 } });
    const listener = vi.fn();
    subscribe(listener);
    const { inc } = actions({
      inc: ({ set }) => set((s) => ({ count: s.count + 1 })),
    });
    inc();
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ count: 1 }));
  });

  it("async action can call setState multiple times", async () => {
    const { getState, actions } = createStore({
      state: { loading: false, value: "" },
    });
    const { load } = actions({
      load: async ({ set }) => {
        set({ loading: true });
        await Promise.resolve();
        set({ loading: false, value: "done" });
      },
    });
    await load();
    expect(getState().loading).toBe(false);
    expect(getState().value).toBe("done");
  });

  it("async action supports extra arguments", async () => {
    const { getState, actions } = createStore({ state: { value: 0 } });
    const { setTo } = actions({
      setTo: async ({ set }, n: number) => {
        await Promise.resolve();
        set({ value: n });
      },
    });
    await setTo(42);
    expect(getState().value).toBe(42);
  });

  it("sync action returns its return value to the caller", () => {
    const { actions } = createStore({ state: { last: "" } });
    const { createItem } = actions({
      createItem: ({ set }, title: string) => {
        set({ last: title });
        return `id-${title}`;
      },
    });

    expect(createItem("a")).toBe("id-a");
  });

  it("async action resolves with its return value", async () => {
    const { actions } = createStore({ state: { last: "" } });
    const { createItem } = actions({
      createItem: async ({ set }, title: string) => {
        await Promise.resolve();
        set({ last: title });
        return `id-${title}`;
      },
    });

    await expect(createItem("a")).resolves.toBe("id-a");
  });

  it("async action returns a promise", () => {
    const { actions } = createStore({ state: { done: false } });
    const { run } = actions({
      run: async ({ set }) => {
        set({ done: true });
      },
    });
    expect(run()).toBeInstanceOf(Promise);
  });

  it("async action notifies subscribers after each setState call", async () => {
    const { subscribe, actions } = createStore({ state: { step: 0 } });
    const steps: number[] = [];
    subscribe((s) => steps.push(s.step));
    const { run } = actions({
      run: async ({ set }) => {
        set({ step: 1 });
        await Promise.resolve();
        set({ step: 2 });
      },
    });
    await run();
    expect(steps).toEqual([1, 2]);
  });

  it("new action starts with idle status and no error", () => {
    const { actions } = createStore({ state: { count: 0 } });
    const { inc } = actions({
      inc: ({ set }) => set((s) => ({ count: s.count + 1 })),
    });
    expect(inc.getMeta()).toEqual({ status: "idle", error: undefined });
  });

  it("sync action reaches success status after completing", () => {
    const { actions } = createStore({ state: { count: 0 } });
    const { inc } = actions({
      inc: ({ set }) => set((s) => ({ count: s.count + 1 })),
    });
    inc();
    expect(inc.getMeta()).toEqual({ status: "success", error: undefined });
  });

  it("sync action that throws sets error status and rethrows", () => {
    const { actions } = createStore({ state: { count: 0 } });
    const { boom } = actions({
      boom: () => {
        throw new Error("nope");
      },
    });
    expect(() => boom()).toThrow("nope");
    expect(boom.getMeta()).toEqual({
      status: "error",
      error: new Error("nope"),
    });
  });

  it("async action meta transitions pending then success", async () => {
    const { actions } = createStore({ state: { value: "" } });
    const seen: string[] = [];
    const { load } = actions({
      load: async ({ set }) => {
        await Promise.resolve();
        set({ value: "done" });
      },
    });
    load.subscribeMeta((meta) => seen.push(meta.status));
    const promise = load();
    expect(load.getMeta()).toEqual({ status: "pending", error: undefined });
    await promise;
    expect(load.getMeta()).toEqual({ status: "success", error: undefined });
    expect(seen).toEqual(["pending", "success"]);
  });

  it("does not notify meta subscribers when a redundant status update is set", async () => {
    const { actions } = createStore({ state: { value: "" } });
    const seen: string[] = [];
    const { load } = actions({
      load: async ({ set }) => {
        await Promise.resolve();
        set({ value: "done" });
      },
    });
    load.subscribeMeta((meta) => seen.push(meta.status));

    // Starting a second call while the first is still pending re-sets
    // { status: "pending", error: undefined }, which is already the current
    // meta, so the second call's initial notification is a no-op; likewise
    // its trailing success notification once the first call already settled.
    const first = load();
    const second = load();
    await Promise.all([first, second]);

    expect(seen).toEqual(["pending", "success"]);
  });

  it("async action that rejects sets error status and still rejects the returned promise", async () => {
    const { actions } = createStore({ state: { value: "" } });
    const failure = new Error("network down");
    const { load } = actions({
      load: async () => {
        await Promise.resolve();
        throw failure;
      },
    });
    await expect(load()).rejects.toThrow("network down");
    expect(load.getMeta()).toEqual({ status: "error", error: failure });
  });
});

// ─── plugins ──────────────────────────────────────────────────────────────────

describe("plugins", () => {
  it("calls onInit once with the store as its only argument", () => {
    const onInit = vi.fn();
    const plugin: StoicPlugin<{ count: number }> = { onInit };
    const store = createStore<{ count: number }, { doubled: number }>({
      state: { count: 0 },
      derived: { doubled: (s) => s.count * 2 },
      plugins: [plugin as StoicPlugin<{ count: number }, { count: number; doubled: number }>],
    });
    expect(onInit).toHaveBeenCalledOnce();
    expect(onInit.mock.calls[0]).toHaveLength(1);
    expect(onInit).toHaveBeenCalledWith(
      expect.objectContaining({ getState: expect.any(Function) }),
    );
    // Derived values are lazy, so an untouched snapshot carries only raw keys
    // as own properties; `doubled` resolves through the prototype getter.
    const state = onInit.mock.calls[0]?.[0].getState();
    expect(state).toEqual({ count: 0 });
    expect(state.doubled).toBe(0);
    store.destroy();
  });

  it("keeps derived keys off the public store object", () => {
    const store = createStore<{ count: number }, { doubled: number }>({
      state: { count: 0 },
      derived: { doubled: (s) => s.count * 2 },
    });
    expect("derivedKeys" in store).toBe(false);
    store.destroy();
  });

  it("calls afterSetState with the merged state", () => {
    const calls: string[] = [];
    const plugin: StoicPlugin<{ count: number; name: string }> = {
      afterSetState: (state) => calls.push(`after:${JSON.stringify(state)}`),
    };
    const store = createStore({
      state: { count: 0, name: "stoic" },
      plugins: [plugin],
    });
    store.setState({ count: 1 });
    expect(calls).toEqual(['after:{"count":1,"name":"stoic"}']);
    store.destroy();
  });

  it("calls afterSetState with the args of the action behind the write, and none for a direct setState", () => {
    const calls: unknown[] = [];
    const plugin: StoicPlugin<{ count: number }> = {
      afterSetState(_state, actionName, actionArgs) {
        calls.push([actionName, actionArgs]);
      },
    };
    const store = createStore({ state: { count: 0 }, plugins: [plugin] });
    const { inc } = store.actions({
      inc: ({ set }, by: number) => set((s) => ({ count: s.count + by })),
    });

    inc(5);
    store.setState({ count: 99 });

    expect(calls).toEqual([
      ["inc", [5]],
      [undefined, undefined],
    ]);
    store.destroy();
  });

  it("calls beforeAction/afterAction around a sync action with matching context", () => {
    const calls: unknown[] = [];
    const plugin: StoicPlugin<{ count: number }> = {
      beforeAction: (ctx) => calls.push(["before", ctx.name, ctx.args]),
      afterAction: (ctx) => calls.push(["after", ctx.name, ctx.state]),
    };
    const store = createStore({ state: { count: 0 }, plugins: [plugin] });
    const { inc } = store.actions({
      inc: ({ set }, by: number) => set((s) => ({ count: s.count + by })),
    });
    inc(5);
    expect(calls).toEqual([
      ["before", "inc", [5]],
      ["after", "inc", { count: 5 }],
    ]);
    store.destroy();
  });

  it("calls beforeAction/afterAction for multiple actions registered in one call", () => {
    const calls: unknown[] = [];
    const plugin: StoicPlugin<{ count: number }> = {
      beforeAction: (ctx) => calls.push(["before", ctx.name, ctx.args]),
      afterAction: (ctx) => calls.push(["after", ctx.name, ctx.state]),
    };
    const store = createStore({ state: { count: 0 }, plugins: [plugin] });
    const { inc, dec } = store.actions({
      inc: ({ set }, by: number) => set((s) => ({ count: s.count + by })),
      dec: ({ set }, by: number) => set((s) => ({ count: s.count - by })),
    });
    inc(5);
    dec(2);
    expect(calls).toEqual([
      ["before", "inc", [5]],
      ["after", "inc", { count: 5 }],
      ["before", "dec", [2]],
      ["after", "dec", { count: 3 }],
    ]);
    store.destroy();
  });

  it("awaits async actions before calling afterAction", async () => {
    const calls: unknown[] = [];
    const plugin: StoicPlugin<{ value: string }> = {
      beforeAction: (ctx) => calls.push(["before", ctx.name]),
      afterAction: (ctx) => calls.push(["after", ctx.name, ctx.state]),
    };
    const store = createStore({ state: { value: "" }, plugins: [plugin] });
    const { load } = store.actions({
      load: async ({ set }) => {
        await Promise.resolve();
        set({ value: "done" });
      },
    });
    await load();
    expect(calls).toEqual([
      ["before", "load"],
      ["after", "load", { value: "done" }],
    ]);
    store.destroy();
  });

  it("calls afterAction even when a sync action throws", () => {
    const calls: unknown[] = [];
    const plugin: StoicPlugin<{ count: number }> = {
      beforeAction: (ctx) => calls.push(["before", ctx.name]),
      afterAction: (ctx) => calls.push(["after", ctx.name]),
    };
    const store = createStore({ state: { count: 0 }, plugins: [plugin] });
    const { fail } = store.actions({
      fail: () => {
        throw new Error("boom");
      },
    });
    expect(() => fail()).toThrow("boom");
    expect(calls).toEqual([
      ["before", "fail"],
      ["after", "fail"],
    ]);
    store.destroy();
  });

  it("calls afterAction even when an async action rejects", async () => {
    const calls: unknown[] = [];
    const plugin: StoicPlugin<{ count: number }> = {
      beforeAction: (ctx) => calls.push(["before", ctx.name]),
      afterAction: (ctx) => calls.push(["after", ctx.name]),
    };
    const store = createStore({ state: { count: 0 }, plugins: [plugin] });
    const { fail } = store.actions({
      fail: async () => {
        await Promise.resolve();
        throw new Error("boom");
      },
    });
    await expect(fail()).rejects.toThrow("boom");
    expect(calls).toEqual([
      ["before", "fail"],
      ["after", "fail"],
    ]);
    store.destroy();
  });

  it("does not call afterAction for an action that settles after destroy()", async () => {
    const afterAction = vi.fn();
    const onDestroy = vi.fn();
    const plugin: StoicPlugin<{ count: number }> = { afterAction, onDestroy };
    const store = createStore({ state: { count: 0 }, plugins: [plugin] });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { slow } = store.actions({
      slow: async () => {
        await gate;
      },
    });

    const pending = slow();
    store.destroy();
    release();
    await pending;

    expect(onDestroy).toHaveBeenCalledOnce();
    expect(afterAction).not.toHaveBeenCalled();
  });

  it("does not call beforeAction for an action invoked after destroy()", () => {
    const beforeAction = vi.fn();
    const plugin: StoicPlugin<{ count: number }> = { beforeAction };
    const store = createStore({ state: { count: 0 }, plugins: [plugin] });
    const { noop } = store.actions({ noop: () => {} });

    store.destroy();
    noop();

    expect(beforeAction).not.toHaveBeenCalled();
    // Meta still settles — handles outlive the store, like afterAction's contract.
    expect(noop.getMeta().status).toBe("success");
  });

  it("does not call afterSetState when destroy() runs inside the batch that changed state", () => {
    const afterSetState = vi.fn();
    const onDestroy = vi.fn();
    const plugin: StoicPlugin<{ count: number }> = { afterSetState, onDestroy };
    const store = createStore({ state: { count: 0 }, plugins: [plugin] });

    store.batch(() => {
      store.setState({ count: 1 });
      store.destroy();
    });

    expect(onDestroy).toHaveBeenCalledOnce();
    expect(afterSetState).not.toHaveBeenCalled();
  });

  it("calls onDestroy and stops notifying listeners after destroy()", () => {
    const onDestroy = vi.fn();
    const plugin: StoicPlugin<{ count: number }> = { onDestroy };
    const store = createStore({ state: { count: 0 }, plugins: [plugin] });
    const listener = vi.fn();
    store.subscribe(listener);

    store.destroy();
    expect(onDestroy).toHaveBeenCalledOnce();

    store.setState({ count: 1 });
    expect(listener).not.toHaveBeenCalled();
  });
});

// ─── useStore hook ────────────────────────────────────────────────────────────

/** Minimal renderHook using React 19's createRoot + act. */
function renderHook<T>(fn: () => T): { get: () => T; unmount: () => void } {
  let latest!: T;
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function Component() {
    latest = fn();
    return null;
  }

  act(() => {
    root.render(<Component />);
  });

  return {
    get: () => latest,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("useStore", () => {
  it("returns full state without a selector", () => {
    const store = createStore({ state: { count: 0, label: "hello" } });
    const hook = renderHook(() => useStore(store));
    expect(hook.get()).toEqual({ count: 0, label: "hello" });
    hook.unmount();
  });

  it("returns selected slice with a selector", () => {
    const store = createStore({ state: { count: 7, label: "hello" } });
    const hook = renderHook(() => useStore(store, (s) => s.count));
    expect(hook.get()).toBe(7);
    hook.unmount();
  });

  it("updates when selected state changes", () => {
    const store = createStore({ state: { count: 0 } });
    const hook = renderHook(() => useStore(store, (s) => s.count));
    expect(hook.get()).toBe(0);

    act(() => {
      store.setState({ count: 5 });
    });

    expect(hook.get()).toBe(5);
    hook.unmount();
  });

  it("does not re-render when unselected state changes", () => {
    const store = createStore({ state: { count: 0, name: "stoic" } });
    const renders = vi.fn();

    const hook = renderHook(() => {
      renders();
      return useStore(store, (s) => s.count);
    });

    const before = renders.mock.calls.length;

    act(() => {
      store.setState({ name: "updated" });
    });

    expect(renders.mock.calls.length).toBe(before);
    expect(hook.get()).toBe(0);
    hook.unmount();
  });

  it("uses custom equality to suppress re-renders", () => {
    const store = createStore({ state: { items: [1, 2, 3] } });
    const renders = vi.fn();

    const hook = renderHook(() => {
      renders();
      return useStore(
        store,
        (s) => s.items,
        (a, b) => a.length === b.length,
      );
    });

    const ref = hook.get();
    const before = renders.mock.calls.length;

    act(() => {
      // Same length → custom equality returns true → no re-render
      store.setState({ items: [4, 5, 6] });
    });

    expect(renders.mock.calls.length).toBe(before);
    expect(hook.get()).toBe(ref); // same reference
    hook.unmount();
  });

  it("with shallow equality, suppresses re-renders for object-literal selectors", () => {
    const store = createStore({
      state: { subtotal: 10, total: 12, unrelated: 0 },
    });
    const renders = vi.fn();

    const hook = renderHook(() => {
      renders();
      return useStore(store, (s) => ({ subtotal: s.subtotal, total: s.total }), shallow);
    });

    const ref = hook.get();
    const before = renders.mock.calls.length;

    act(() => {
      // Unrelated field changes; subtotal/total stay the same → shallow
      // equality suppresses the re-render and keeps the same reference.
      store.setState({ unrelated: 1 });
    });

    expect(renders.mock.calls.length).toBe(before);
    expect(hook.get()).toBe(ref);

    act(() => {
      store.setState({ subtotal: 20 });
    });

    expect(renders.mock.calls.length).toBe(before + 1);
    expect(hook.get()).toEqual({ subtotal: 20, total: 12 });
    hook.unmount();
  });

  it("re-reads through a selector that changes between renders", () => {
    const store = createStore({ state: { a: 1, b: 2 } });
    let latest = 0;

    function Component({ which }: { which: "a" | "b" }) {
      latest = useStore(store, (s) => s[which]);
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<Component which="a" />));
    expect(latest).toBe(1);

    act(() => root.render(<Component which="b" />));
    expect(latest).toBe(2);

    // The new selector must also keep tracking store updates.
    act(() => {
      store.setState({ b: 20 });
    });
    expect(latest).toBe(20);

    act(() => root.unmount());
    container.remove();
  });

  it("tracks a different store when the store argument changes between renders", () => {
    const storeA = createStore({ state: { count: 1 } });
    const storeB = createStore({ state: { count: 10 } });
    let latest = 0;

    function Component({ store }: { store: typeof storeA }) {
      latest = useStore(store, (s) => s.count);
      return null;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<Component store={storeA} />));
    expect(latest).toBe(1);

    act(() => root.render(<Component store={storeB} />));
    expect(latest).toBe(10);

    // Updates to the newly-passed store are tracked...
    act(() => {
      storeB.setState({ count: 11 });
    });
    expect(latest).toBe(11);

    // ...and updates to the old store no longer reach the component.
    act(() => {
      storeA.setState({ count: 2 });
    });
    expect(latest).toBe(11);

    act(() => root.unmount());
    container.remove();
  });

  it("does not re-render children when a change only touches unrelated derived values", () => {
    // Mirrors the shopping-cart example: a parent selects `items` plus a derived
    // count, while an unrelated raw key feeds a *different* derived value. The
    // parent (and therefore its children) must not re-render.
    const store = createStore<
      { items: { id: string; quantity: number }[]; shippingMethod: string },
      { totalItems: number; shippingCost: number }
    >({
      state: { items: [{ id: "a", quantity: 2 }], shippingMethod: "standard" },
      derived: {
        totalItems: ({ items }) => items.reduce((n, i) => n + i.quantity, 0),
        shippingCost: ({ shippingMethod }) => (shippingMethod === "express" ? 24.99 : 9.99),
      },
    });

    const childRenders = vi.fn();

    function Child({ id }: { id: string }) {
      childRenders();
      return <li>{id}</li>;
    }

    const parentRenders = vi.fn();

    function Parent() {
      parentRenders();
      const { items } = useStore(
        store,
        (s) => ({ items: s.items, totalItems: s.totalItems }),
        shallow,
      );
      return (
        <ul>
          {items.map((i) => (
            <Child key={i.id} id={i.id} />
          ))}
        </ul>
      );
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(<Parent />));

    const parentBefore = parentRenders.mock.calls.length;
    const childBefore = childRenders.mock.calls.length;
    const itemsBefore = store.getState().items;

    act(() => {
      store.setState({ shippingMethod: "express" });
    });

    // shippingCost recomputed, but items/totalItems untouched → nothing re-renders.
    expect(store.getState().shippingCost).toBe(24.99);
    expect(store.getState().items).toBe(itemsBefore);
    expect(parentRenders.mock.calls.length).toBe(parentBefore);
    expect(childRenders.mock.calls.length).toBe(childBefore);

    act(() => root.unmount());
    container.remove();
  });
});

describe("store-bound wrapper hooks", () => {
  // `const useCart = (sel) => useStore(cart, sel)` is the documented way to
  // get a store-specific hook. That only works while the store methods never
  // read `this`, so the store can be closed over and passed by reference.
  it("a wrapper hook around useStore tracks the store", () => {
    const store = createStore({ state: { count: 7 } });
    const useCount = () => useStore(store, (s) => s.count);

    const hook = renderHook(() => useCount());
    expect(hook.get()).toBe(7);

    act(() => {
      store.setState({ count: 8 });
    });
    expect(hook.get()).toBe(8);
    hook.unmount();
  });

  it("a wrapper hook around useActionMeta tracks the handle", async () => {
    const store = createStore({ state: { value: "" } });
    const { load } = store.actions({
      load: async ({ set }) => {
        await Promise.resolve();
        set({ value: "done" });
      },
    });
    const useLoadMeta = () => useActionMeta(load);

    const hook = renderHook(() => useLoadMeta());
    expect(hook.get().status).toBe("idle");

    await act(async () => {
      await load();
    });
    expect(hook.get().status).toBe("success");
    hook.unmount();
  });
});

describe("useStore with a throwing derived value", () => {
  class Boundary extends React.Component<{ children?: React.ReactNode }, { error: unknown }> {
    override state = { error: null as unknown };
    static getDerivedStateFromError(error: unknown) {
      return { error };
    }
    override render() {
      const { error } = this.state;
      if (error) return <span>caught:{(error as Error).name}</span>;
      return this.props.children;
    }
  }

  it("surfaces a CircularDependencyError from a selector to the nearest error boundary", () => {
    const store = createStore<{ flag: boolean }, { a: number; b: number }>({
      state: { flag: false },
      derived: {
        a: (s) => (s.flag ? s.b + 1 : 0),
        b: (s) => (s.flag ? s.a + 1 : 0),
      },
    });

    function View() {
      return <span>value:{useStore(store, (s) => s.a)}</span>;
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    act(() =>
      root.render(
        <Boundary>
          <View />
        </Boundary>,
      ),
    );
    expect(container.textContent).toBe("value:0");

    act(() => {
      store.setState({ flag: true });
    });

    expect(container.textContent).toBe("caught:CircularDependencyError");

    errors.mockRestore();
    act(() => root.unmount());
    container.remove();
  });
});

describe("useStore SSR", () => {
  it("uses the selected state as the server snapshot when rendered on the server", () => {
    const store = createStore({ state: { count: 42, label: "server" } });

    function Component() {
      const count = useStore(store, (s) => s.count);
      return <div>{count}</div>;
    }

    const html = renderToString(<Component />);
    expect(html).toContain("42");
  });

  it("caches the server snapshot so object-literal selectors can hydrate", () => {
    const store = createStore({
      state: { count: 42, label: "server", other: 0 },
    });

    function Component() {
      const { count, label } = useStore(
        store,
        (s) => ({ count: s.count, label: s.label }),
        shallow,
      );
      return (
        <div>
          {count}
          {label}
        </div>
      );
    }

    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = renderToString(<Component />);

    // An uncached getServerSnapshot returns a fresh object on every call, which
    // React detects during hydration ("The result of getServerSnapshot should be
    // cached to avoid an infinite loop").
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    let root!: ReturnType<typeof hydrateRoot>;
    act(() => {
      root = hydrateRoot(container, <Component />);
    });

    const messages = errors.mock.calls.map((c) => String(c[0])).join("\n");
    errors.mockRestore();

    expect(messages).not.toContain("getServerSnapshot should be cached");
    expect(container.textContent).toContain("42");

    act(() => root.unmount());
    container.remove();
  });
});

describe("useMeta", () => {
  it("re-renders through pending, then success", async () => {
    const store = createStore({ state: { value: "" } });
    const { load } = store.actions({
      load: async ({ set }) => {
        await Promise.resolve();
        set({ value: "done" });
      },
    });
    const hook = renderHook(() => useActionMeta(load));
    expect(hook.get()).toEqual({ status: "idle", error: undefined });

    let promise!: Promise<void>;
    act(() => {
      promise = load();
    });
    expect(hook.get()).toEqual({ status: "pending", error: undefined });

    await act(async () => {
      await promise;
    });
    expect(hook.get()).toEqual({ status: "success", error: undefined });
    hook.unmount();
  });

  it("re-renders to error status when the action rejects", async () => {
    const store = createStore({ state: { value: "" } });
    const failure = new Error("nope");
    const { load } = store.actions({
      load: async () => {
        await Promise.resolve();
        throw failure;
      },
    });
    const hook = renderHook(() => useActionMeta(load));

    await act(async () => {
      await load().catch(() => {});
    });

    expect(hook.get()).toEqual({ status: "error", error: failure });
    hook.unmount();
  });
});

describe("shallow", () => {
  it("returns true for objects with the same keys/values", () => {
    expect(shallow({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
  });

  it("returns false when a key is missing or added", () => {
    expect(shallow({ a: 1, b: 2 }, { a: 1, c: 2 })).toBe(false);
    expect(shallow({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("returns false when a value differs", () => {
    expect(shallow({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
  });

  it("falls back to Object.is for primitives", () => {
    expect(shallow(1, 1)).toBe(true);
    expect(shallow(1, 2)).toBe(false);
    expect(shallow(Number.NaN, Number.NaN)).toBe(true);
    expect(shallow(null, null)).toBe(true);
    expect(shallow(null, {})).toBe(false);
    expect(shallow(undefined, undefined)).toBe(true);
  });

  it("returns true for the same reference", () => {
    const obj = { a: 1 };
    expect(shallow(obj, obj)).toBe(true);
  });

  it("does not recurse into nested objects", () => {
    expect(shallow({ a: { x: 1 } }, { a: { x: 1 } })).toBe(false);
  });

  it("compares Maps by size and entries", () => {
    expect(shallow(new Map([["a", 1]]), new Map([["a", 1]]))).toBe(true);
    expect(shallow(new Map([["a", 1]]), new Map([["a", 2]]))).toBe(false);
    expect(shallow(new Map([["a", 1]]), new Map([["b", 1]]))).toBe(false);
    expect(
      shallow(
        new Map([["a", 1]]),
        new Map([
          ["a", 1],
          ["b", 2],
        ]),
      ),
    ).toBe(false);
  });

  it("compares Sets by size and membership", () => {
    expect(shallow(new Set([1, 2]), new Set([2, 1]))).toBe(true);
    expect(shallow(new Set([1, 2]), new Set([1, 3]))).toBe(false);
    expect(shallow(new Set([1]), new Set([1, 2]))).toBe(false);
  });

  it("does not report distinct Dates, RegExps, or class instances as equal", () => {
    // These have no own enumerable keys, so a naive key comparison would call
    // any two of them equal — hiding real changes from selectors.
    expect(shallow(new Date(1000), new Date(2000))).toBe(false);
    expect(shallow(/a/, /b/)).toBe(false);
    class Box {
      constructor(public value: number) {}
    }
    expect(shallow(new Box(1), new Box(1))).toBe(false);
  });

  it("compares a plain object against a non-plain object as unequal", () => {
    expect(shallow<unknown>({}, new Date(0))).toBe(false);
    expect(shallow<unknown>(new Map(), {})).toBe(false);
  });

  it("still compares arrays element-wise", () => {
    expect(shallow([1, 2], [1, 2])).toBe(true);
    expect(shallow([1, 2], [2, 1])).toBe(false);
    expect(shallow([1], [1, 2])).toBe(false);
  });
});

// ─── pull-based derived engine ────────────────────────────────────────────────

describe("derived declaration order", () => {
  it("resolves a derivation reading a later-declared derived key", () => {
    const { getState, setState } = createStore<
      { n: number },
      { quadruple: number; double: number }
    >({
      state: { n: 1 },
      derived: {
        quadruple: (s) => s.double * 2,
        double: (s) => s.n * 2,
      },
    });
    expect(getState().quadruple).toBe(4);

    setState({ n: 5 });
    expect(getState().double).toBe(10);
    expect(getState().quadruple).toBe(20);
  });

  it("resolves a 3-deep chain declared in reverse order", () => {
    const { getState, setState } = createStore<{ n: number }, { c: number; b: number; a: number }>({
      state: { n: 1 },
      derived: {
        c: (s) => s.b + 1,
        b: (s) => s.a + 1,
        a: (s) => s.n + 1,
      },
    });
    expect(getState().c).toBe(4);
    setState({ n: 10 });
    expect(getState().c).toBe(13);
  });
});

describe("cycle detection on every read", () => {
  it("throws on every read of a cyclic derived key, not just the first", () => {
    const { getState, setState } = createStore<{ flag: boolean }, { a: number; b: number }>({
      state: { flag: false },
      derived: {
        a: (s) => (s.flag ? s.b + 1 : 0),
        b: (s) => (s.flag ? s.a + 1 : 0),
      },
    });

    setState({ flag: true });
    expect(() => getState().a).toThrow(CircularDependencyError);
    expect(() => getState().a).toThrow(CircularDependencyError);
    expect(() => getState().b).toThrow(CircularDependencyError);
  });

  it("recovers with correct values once the cycle is removed", () => {
    const { getState, setState } = createStore<
      { flag: boolean; n: number },
      { a: number; b: number }
    >({
      state: { flag: false, n: 1 },
      derived: {
        a: (s) => (s.flag ? s.b + 1 : s.n),
        b: (s) => (s.flag ? s.a + 1 : s.n * 10),
      },
    });

    setState({ flag: true });
    expect(() => getState().a).toThrow(CircularDependencyError);

    setState({ flag: false, n: 2 });
    expect(getState().a).toBe(2);
    expect(getState().b).toBe(20);
  });
});

describe("store.batch", () => {
  it("notifies listeners once for multiple setState calls", () => {
    const store = createStore({ state: { count: 0 } });
    const listener = vi.fn();
    store.subscribe(listener);

    store.batch(() => {
      store.setState({ count: 1 });
      store.setState((s) => ({ count: s.count + 1 }));
      store.setState((s) => ({ count: s.count + 1 }));
    });

    expect(store.getState().count).toBe(3);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("getState inside a batch is internally consistent (raw and derived agree)", () => {
    const store = createStore<{ count: number }, { doubled: number }>({
      state: { count: 1 },
      derived: { doubled: (s) => s.count * 2 },
    });
    store.subscribe(vi.fn());

    store.batch(() => {
      store.setState({ count: 10 });
      const s = store.getState();
      expect(s.count).toBe(10);
      expect(s.doubled).toBe(20);
    });

    expect(store.getState().doubled).toBe(20);
  });

  it("does not flush until the outermost of nested batch calls ends", () => {
    const store = createStore({ state: { count: 0 } });
    const listener = vi.fn();
    store.subscribe(listener);

    store.batch(() => {
      store.setState({ count: 1 });
      store.batch(() => {
        store.setState({ count: 2 });
      });
      expect(listener).not.toHaveBeenCalled();
      store.setState({ count: 3 });
    });

    expect(store.getState().count).toBe(3);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("still notifies once if the callback throws after a setState", () => {
    const store = createStore({ state: { count: 0 } });
    const listener = vi.fn();
    store.subscribe(listener);

    expect(() =>
      store.batch(() => {
        store.setState({ count: 1 });
        throw new Error("boom");
      }),
    ).toThrow("boom");

    expect(store.getState().count).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("does not notify listeners when the batch performed no state change", () => {
    const store = createStore({ state: { count: 0 } });
    const listener = vi.fn();
    store.subscribe(listener);

    store.batch(() => {});
    store.batch(() => {
      store.setState({ count: 0 });
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it("returns the callback's return value", () => {
    const store = createStore({ state: { count: 0 } });
    expect(store.batch(() => 42)).toBe(42);
  });

  it("coalesces an async action's post-await writes, still attributed to the action", async () => {
    const writes: [state: unknown, actionName: string | undefined][] = [];
    const plugin: StoicPlugin<{ a: number; b: number; c: number }> = {
      afterSetState: (state, actionName) => writes.push([{ ...state }, actionName]),
    };
    const store = createStore({ state: { a: 0, b: 0, c: 0 }, plugins: [plugin] });
    const listener = vi.fn();
    store.subscribe(listener);

    const { load } = store.actions({
      load: async ({ set }) => {
        set({ a: 1 });
        await Promise.resolve();
        store.batch(() => {
          set({ b: 1 });
          set({ c: 1 });
        });
      },
    });

    await load();

    // One notification for the pre-await write, one for the whole batch.
    expect(listener).toHaveBeenCalledTimes(2);
    expect(writes).toEqual([
      [{ a: 1, b: 0, c: 0 }, "load"],
      [{ a: 1, b: 1, c: 1 }, "load"],
    ]);
    store.destroy();
  });
});

describe("no-op setState", () => {
  it("does not notify listeners when no key actually changed", () => {
    const store = createStore({ state: { count: 0, name: "stoic" } });
    const listener = vi.fn();
    store.subscribe(listener);

    store.setState({ count: 0 });
    store.setState({ count: 0, name: "stoic" });
    store.setState({});

    expect(listener).not.toHaveBeenCalled();
  });

  it("keeps the same state reference when no key actually changed", () => {
    const store = createStore({ state: { count: 0 } });
    const before = store.getState();
    store.setState({ count: 0 });
    expect(store.getState()).toBe(before);
  });
});

describe("subscriber exceptions", () => {
  it("a throwing subscriber stops later subscribers and propagates to the setState caller", () => {
    const store = createStore({ state: { n: 0 } });
    const later = vi.fn();
    store.subscribe(() => {
      throw new Error("subscriber boom");
    });
    store.subscribe(later);

    expect(() => store.setState({ n: 1 })).toThrow("subscriber boom");
    // The state change itself is committed before notification.
    expect(store.getState().n).toBe(1);
    expect(later).not.toHaveBeenCalled();
  });
});

describe("re-entrant updates during notification", () => {
  it("warns in dev when a plugin updates state from afterSetState but still converges", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let store!: ReturnType<typeof createStore<{ count: number; mirror: number }>>;
    store = createStore<{ count: number; mirror: number }>({
      state: { count: 0, mirror: 0 },
      plugins: [
        {
          afterSetState(state) {
            if (state.mirror !== state.count) store.setState({ mirror: state.count });
          },
        },
      ],
    });

    store.setState({ count: 3 });

    expect(store.getState()).toEqual({ count: 3, mirror: 3 });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("re-entrant"));
    warnSpy.mockRestore();
  });

  it("throws instead of overflowing when a listener updates state unconditionally", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createStore({ state: { count: 0 } });
    store.subscribe((s) => {
      store.setState({ count: s.count + 1 });
    });

    expect(() => store.setState({ count: 1 })).toThrow(/maximum update depth/);
    warnSpy.mockRestore();
  });

  it("notifies each listener after the writer exactly once with the final state", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createStore<{ count: number; mirror: number }>({
      state: { count: 0, mirror: 0 },
    });

    const before: number[][] = [];
    const after: number[][] = [];
    store.subscribe((s) => before.push([s.count, s.mirror]));
    store.subscribe((s) => {
      if (s.mirror !== s.count) store.setState({ mirror: s.count });
    });
    store.subscribe((s) => after.push([s.count, s.mirror]));

    store.setState({ count: 3 });

    // The listener ordered before the writer genuinely observed two states.
    expect(before).toEqual([
      [3, 0],
      [3, 3],
    ]);
    // The one after it must see the final state once — not the same state twice.
    expect(after).toEqual([[3, 3]]);
    warnSpy.mockRestore();
  });

  it("runs afterSetState once per plugin when another plugin writes during the hook", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const later = vi.fn();
    let store!: ReturnType<typeof createStore<{ count: number; mirror: number }>>;
    store = createStore<{ count: number; mirror: number }>({
      state: { count: 0, mirror: 0 },
      plugins: [
        {
          afterSetState(state) {
            if (state.mirror !== state.count) store.setState({ mirror: state.count });
          },
        },
        { afterSetState: later },
      ],
    });

    store.setState({ count: 2 });

    expect(store.getState()).toEqual({ count: 2, mirror: 2 });
    expect(later).toHaveBeenCalledTimes(1);
    expect(later).toHaveBeenCalledWith({ count: 2, mirror: 2 }, undefined, undefined);
    warnSpy.mockRestore();
  });

  it("does not re-notify when the re-entrant write happens inside a batch", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createStore<{ count: number; mirror: number }>({
      state: { count: 0, mirror: 0 },
    });

    const after: number[][] = [];
    store.subscribe((s) => {
      if (s.mirror !== s.count) {
        store.batch(() => {
          store.setState({ mirror: s.count });
        });
      }
    });
    store.subscribe((s) => after.push([s.count, s.mirror]));

    store.setState({ count: 5 });

    expect(after).toEqual([[5, 5]]);
    warnSpy.mockRestore();
  });

  it("leaves a no-op re-entrant write from a listener notifying normally", () => {
    const store = createStore<{ count: number; other: number }>({ state: { count: 0, other: 7 } });

    const after: number[] = [];
    store.subscribe(() => {
      // Writes the value the key already holds, so no new snapshot is minted
      // and the outer pass must run to completion.
      store.setState({ other: 7 });
    });
    store.subscribe((s) => after.push(s.count));

    store.setState({ count: 1 });

    expect(after).toEqual([1]);
  });
});

describe("prototype-named state keys", () => {
  it("sets a state key that shadows an Object.prototype member", () => {
    const store = createStore<{ toString: string; count: number }>({
      state: { toString: "initial", count: 0 },
    });

    store.setState({ toString: "updated" });

    expect(store.getState().toString).toBe("updated");
  });
});

describe("state/derived key collision", () => {
  it("throws at creation when a key is declared in both state and derived", () => {
    expect(() =>
      createStore<{ total: number }, { total: number }>({
        state: { total: 1 },
        derived: { total: () => 2 },
      }),
    ).toThrow(/"total".*both/);
  });

  it("does not throw when state and derived keys are disjoint", () => {
    expect(() =>
      createStore<{ count: number }, { doubled: number }>({
        state: { count: 1 },
        derived: { doubled: (s) => s.count * 2 },
      }),
    ).not.toThrow();
  });
});

describe("duplicate action registration", () => {
  it("warns in dev when a second actions() call reuses an action name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createStore({ state: { n: 0 } });

    store.actions({ bump: ({ set }) => set((s) => ({ n: s.n + 1 })) });
    expect(warn).not.toHaveBeenCalled();

    store.actions({ bump: ({ set }) => set((s) => ({ n: s.n + 2 })) });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"bump"'));
    warn.mockRestore();
  });

  it("does not warn for distinct names across actions() calls", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createStore({ state: { n: 0 } });

    store.actions({ bump: ({ set }) => set((s) => ({ n: s.n + 1 })) });
    store.actions({ reset: ({ set }) => set({ n: 0 }) });

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("setState with derived keys", () => {
  it("ignores writes to derived keys and keeps the computed value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = createStore<{ count: number }, { doubled: number }>({
      state: { count: 3 },
      derived: { doubled: (s) => s.count * 2 },
    });

    store.setState({ doubled: 999 } as never);

    expect(store.getState().doubled).toBe(6);
    store.setState({ count: 5 });
    expect(store.getState().doubled).toBe(10);
    warn.mockRestore();
  });
});

describe("action meta latest-call-wins", () => {
  it("reflects the outcome of the most recent call even if an older call settles later", async () => {
    const { actions } = createStore({ state: { value: "" } });
    let resolveFirst!: () => void;
    let call = 0;
    const { load } = actions({
      load: async () => {
        call++;
        if (call === 1) {
          await new Promise<void>((resolve) => {
            resolveFirst = resolve;
          });
        }
      },
    });

    const first = load();
    const second = load();
    await second;

    // The newest call already succeeded; its outcome must win immediately.
    expect(load.getMeta().status).toBe("success");

    resolveFirst();
    await first;
    // The stale first call settling later must not overwrite the newer outcome.
    expect(load.getMeta().status).toBe("success");
  });
});

describe("action abort signal", () => {
  it("aborts the previous call's signal when the action is called again", async () => {
    const { actions } = createStore({ state: { value: "" } });
    const signals: AbortSignal[] = [];
    let resolveFirst!: () => void;
    const { load } = actions({
      load: async ({ signal }) => {
        signals.push(signal);
        if (signals.length === 1) {
          await new Promise<void>((resolve) => {
            resolveFirst = resolve;
          });
        }
      },
    });

    const first = load();
    const second = load();

    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(false);

    resolveFirst();
    await Promise.all([first, second]);
  });

  it("does not abort the signal of a call that already settled", async () => {
    const { actions } = createStore({ state: { value: "" } });
    const signals: AbortSignal[] = [];
    const { load } = actions({
      load: async ({ signal }) => {
        signals.push(signal);
      },
    });

    await load();
    await load();

    expect(signals[0]?.aborted).toBe(false);
    expect(signals[1]?.aborted).toBe(false);
  });

  it("aborts in-flight signals when the store is destroyed", async () => {
    const store = createStore({ state: { value: "" } });
    let signal!: AbortSignal;
    let resolve!: () => void;
    const { load } = store.actions({
      load: async (ctx) => {
        signal = ctx.signal;
        await new Promise<void>((r) => {
          resolve = r;
        });
      },
    });

    const pending = load();
    expect(signal.aborted).toBe(false);

    store.destroy();
    expect(signal.aborted).toBe(true);

    resolve();
    await pending;
  });

  it("hands an already-aborted signal to a call that first reads it after a newer call started", async () => {
    const { actions } = createStore({ state: { value: "" } });
    const signals: AbortSignal[] = [];
    const gates: (() => void)[] = [];
    const hang = () =>
      new Promise<void>((resolve) => {
        gates.push(resolve);
      });
    const { load } = actions({
      load: async (ctx, readEarly: boolean) => {
        if (!readEarly) await hang();
        signals.push(ctx.signal);
        await hang();
      },
    });

    const first = load(false); // defers its signal read past the next call
    const second = load(true); // signals[0]
    gates[0]?.(); // let the first call resume and read its signal → signals[1]
    await Promise.resolve();

    // The first call is stale (a newer call already started), so its signal is
    // born aborted — and it must not hijack the abort slot from the second call.
    expect(signals[1]?.aborted).toBe(true);

    const third = load(true); // signals[2]

    // The third call supersedes the second — the newest in-flight call, not
    // the already-stale first one.
    expect(signals[0]?.aborted).toBe(true);
    expect(signals[2]?.aborted).toBe(false);

    for (const release of gates) release();
    await Promise.all([first, second, third]);
  });

  it("hands an already-aborted signal to an action called after destroy()", () => {
    const store = createStore({ state: { value: "" } });
    let signal!: AbortSignal;
    const { load } = store.actions({
      load: (ctx) => {
        signal = ctx.signal;
      },
    });

    store.destroy();
    load();

    expect(signal.aborted).toBe(true);
  });

  it("aborts independently per action", async () => {
    const { actions } = createStore({ state: { value: "" } });
    let signalA!: AbortSignal;
    const signalsB: AbortSignal[] = [];
    const resolvers: (() => void)[] = [];
    const hang = () =>
      new Promise<void>((resolve) => {
        resolvers.push(resolve);
      });
    const { loadA, loadB } = actions({
      loadA: async ({ signal }) => {
        signalA = signal;
        await hang();
      },
      loadB: async ({ signal }) => {
        signalsB.push(signal);
        await hang();
      },
    });

    const pendingA = loadA();
    const firstB = loadB();
    const secondB = loadB();

    // loadB's second call aborts only loadB's first signal, never loadA's.
    expect(signalsB[0]?.aborted).toBe(true);
    expect(signalsB[1]?.aborted).toBe(false);
    expect(signalA.aborted).toBe(false);

    for (const resolve of resolvers) resolve();
    await Promise.all([pendingA, firstB, secondB]);
  });

  it("a call that never reads the signal does not disturb later calls", async () => {
    const { actions } = createStore({ state: { value: "" } });
    let signal: AbortSignal | undefined;
    let read = false;
    const { load } = actions({
      load: async (ctx) => {
        if (read) signal = ctx.signal;
      },
    });

    await load();
    read = true;
    await load();

    expect(signal?.aborted).toBe(false);
  });

  it("a stale call rejecting on abort does not overwrite the newer call's meta", async () => {
    const { actions } = createStore({ state: { value: "" } });
    let call = 0;
    const { load } = actions({
      load: async ({ signal }) => {
        if (++call === 1) {
          await new Promise<void>((_, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        }
      },
    });

    const first = load();
    const firstRejection = expect(first).rejects.toMatchObject({ name: "AbortError" });

    await load();
    expect(load.getMeta().status).toBe("success");

    // The aborted first call rejected and settled; its outcome must not
    // overwrite the newer call's meta.
    await firstRejection;
    expect(load.getMeta().status).toBe("success");
  });

  it("exposes an unaborted signal to synchronous actions", () => {
    const { actions } = createStore({ state: { value: "" } });
    const { tick } = actions({
      tick: ({ signal }) => signal.aborted,
    });

    expect(tick()).toBe(false);
    expect(tick()).toBe(false);
  });
});

describe("regressions", () => {
  it("action meta stays pending while an overlapping call is still in flight", async () => {
    const { actions } = createStore({ state: { value: "" } });
    let resolveSecond!: () => void;
    let call = 0;
    const { load } = actions({
      load: async () => {
        call++;
        if (call === 1) {
          await Promise.resolve();
        } else {
          await new Promise<void>((resolve) => {
            resolveSecond = resolve;
          });
        }
      },
    });

    const first = load();
    const second = load();
    await first;

    expect(load.getMeta().status).toBe("pending");

    resolveSecond();
    await second;
    expect(load.getMeta().status).toBe("success");
  });

  it("functional setState sees fresh derived values while unobserved", () => {
    const { getState, setState } = createStore<
      { count: number; snapshot: number },
      { doubled: number }
    >({
      state: { count: 1, snapshot: 0 },
      derived: { doubled: (s) => s.count * 2 },
    });

    // No listeners: derived recomputation is deferred after this write.
    setState({ count: 5 });
    setState((s) => ({ snapshot: s.doubled }));

    expect(getState().snapshot).toBe(10);
  });

  it("recovers derived recomputation after a derived function throws", () => {
    let shouldThrow = false;
    const store = createStore<{ count: number }, { doubled: number }>({
      state: { count: 1 },
      derived: {
        doubled: (s) => {
          if (shouldThrow) throw new Error("boom");
          return s.count * 2;
        },
      },
    });
    const unsubscribe = store.subscribe(() => {});

    shouldThrow = true;
    store.setState({ count: 2 });
    expect(() => store.getState().doubled).toThrow("boom");

    shouldThrow = false;
    expect(store.getState().doubled).toBe(4);
    unsubscribe();
    store.destroy();
  });
});
