import { act } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CircularDependencyError,
  createStore,
  type SetState,
  type StoicPlugin,
} from "../src/stoic";
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
    expect(subtotal).toHaveBeenCalledTimes(1);

    setState({ tax: 0.2 });

    expect(subtotal).toHaveBeenCalledTimes(1);
    expect(getState().subtotal).toBe(20);
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

    expect(subtotal).toHaveBeenCalledTimes(1);
    expect(total).toHaveBeenCalledTimes(1);
    expect(finalPrice).toHaveBeenCalledTimes(1);
    expect(getState().finalPrice).toBeCloseTo(200 * (1 + 0.1) * (1 - 0.05));
  });

  it("only recomputes the directly-dependent derived value for a leaf field change", () => {
    const subtotal = vi.fn((s: { price: number; count: number }) => s.price * s.count);
    const total = vi.fn((s: { subtotal: number; tax: number }) => s.subtotal * (1 + s.tax));
    const finalPrice = vi.fn(
      (s: { total: number; discount: number }) => s.total * (1 - s.discount),
    );
    const { setState, subscribe } = createStore<
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

    setState({ discount: 0.1 });

    expect(subtotal).not.toHaveBeenCalled();
    expect(total).not.toHaveBeenCalled();
    expect(finalPrice).toHaveBeenCalledTimes(1);
  });

  it("does not cascade when a recomputed derived value is unchanged", () => {
    const parity = vi.fn((s: { n: number }) => s.n % 2);
    const label = vi.fn((s: { parity: number }) => (s.parity === 0 ? "even" : "odd"));
    const { setState, subscribe } = createStore<{ n: number }, { parity: number; label: string }>({
      state: { n: 2 },
      derived: {
        parity: (s) => parity(s),
        label: (s) => label(s),
      },
    });
    subscribe(vi.fn());
    parity.mockClear();
    label.mockClear();

    setState({ n: 4 });

    expect(parity).toHaveBeenCalledTimes(1);
    expect(label).not.toHaveBeenCalled();
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

  it("recomputes eagerly on every setState once a listener is attached", () => {
    const doubled = vi.fn((s: { count: number }) => s.count * 2);
    const { setState, subscribe } = createStore<{ count: number }, { doubled: number }>({
      state: { count: 1 },
      derived: { doubled },
    });
    subscribe(vi.fn());
    doubled.mockClear();

    setState({ count: 2 });
    expect(doubled).toHaveBeenCalledTimes(1);

    setState({ count: 3 });
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

  it("a plugin implementing afterSetState forces eager recomputation with no listeners", () => {
    const doubled = vi.fn((s: { count: number }) => s.count * 2);
    const afterSetState = vi.fn();
    const { setState } = createStore<{ count: number }, { doubled: number }>({
      state: { count: 1 },
      derived: { doubled },
      plugins: [{ afterSetState }],
    });
    doubled.mockClear();
    afterSetState.mockClear();

    setState({ count: 2 });

    expect(doubled).toHaveBeenCalledTimes(1);
    expect(afterSetState).toHaveBeenCalledWith(expect.objectContaining({ count: 2, doubled: 4 }));
  });

  it("a plugin without afterSetState does not force eager recomputation", () => {
    const doubled = vi.fn((s: { count: number }) => s.count * 2);
    const onDestroy = vi.fn();
    const { getState, setState } = createStore<{ count: number }, { doubled: number }>({
      state: { count: 1 },
      derived: { doubled },
      plugins: [{ onDestroy }],
    });
    doubled.mockClear();

    setState({ count: 2 });

    expect(doubled).not.toHaveBeenCalled();
    expect(getState().doubled).toBe(4);
  });

  it("defers the CircularDependencyError throw to the next getState() when unobserved", () => {
    const { getState, setState } = createStore<{ flag: boolean }, { a: number; b: number }>({
      state: { flag: false },
      derived: {
        a: (s) => (s.flag ? s.b + 1 : 0),
        b: (s) => (s.flag ? s.a + 1 : 0),
      },
    });

    expect(() => setState({ flag: true })).not.toThrow();
    expect(() => getState()).toThrow(new CircularDependencyError(["a", "b", "a"]));
  });
});

// ─── circular dependency detection ────────────────────────────────────────────

describe("circular dependency detection", () => {
  it("throws for a 2-node cycle at creation", () => {
    const create = () =>
      createStore<Record<string, never>, { a: number; b: number }>({
        state: {},
        derived: {
          a: (s) => s.b + 1,
          b: (s) => s.a + 1,
        },
      });

    expect(create).toThrow(new CircularDependencyError(["a", "b", "a"]));
  });

  it("throws with the full chain for a 3-node cycle", () => {
    const create = () =>
      createStore<Record<string, never>, { A: number; B: number; C: number }>({
        state: {},
        derived: {
          A: (s) => s.B + 1,
          B: (s) => s.C + 1,
          C: (s) => s.A + 1,
        },
      });

    expect(create).toThrow(new CircularDependencyError(["A", "B", "C", "A"]));
  });

  it("throws for a derived key that depends on itself", () => {
    const create = () =>
      createStore<Record<string, never>, { a: number }>({
        state: {},
        derived: { a: (s) => s.a + 1 },
      });

    expect(create).toThrow(new CircularDependencyError(["a", "a"]));
  });

  it("throws once a cycle only manifests via a later setState, observed by a listener", () => {
    const { setState, subscribe } = createStore<{ flag: boolean }, { a: number; b: number }>({
      state: { flag: false },
      derived: {
        a: (s) => (s.flag ? s.b + 1 : 0),
        b: (s) => (s.flag ? s.a + 1 : 0),
      },
    });
    subscribe(vi.fn());

    expect(() => setState({ flag: true })).toThrow(new CircularDependencyError(["a", "b", "a"]));
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

describe("action", () => {
  it("sync action updates state", () => {
    const { getState, actions } = createStore({ state: { count: 0 } });
    const { inc } = actions({
      inc: (setState) => setState((s) => ({ count: s.count + 1 })),
    });
    inc();
    expect(getState().count).toBe(1);
  });

  it("sync action receives current state", () => {
    const { getState, setState, actions } = createStore({
      state: { count: 5 },
    });
    const { inc } = actions({
      inc: (setState) => setState((s) => ({ count: s.count + 1 })),
    });
    setState({ count: 10 });
    inc();
    expect(getState().count).toBe(11);
  });

  it("sync action supports extra arguments", () => {
    const { getState, actions } = createStore({ state: { count: 0 } });
    const { add } = actions({
      add: (setState, amount: number) => setState((s) => ({ count: s.count + amount })),
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
      inc: (setState) => setState((s) => ({ count: s.count + 1 })),
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
      load: async (setState: SetState<{ loading: boolean; value: string }>) => {
        setState({ loading: true });
        await Promise.resolve();
        setState({ loading: false, value: "done" });
      },
    });
    await load();
    expect(getState().loading).toBe(false);
    expect(getState().value).toBe("done");
  });

  it("async action supports extra arguments", async () => {
    const { getState, actions } = createStore({ state: { value: 0 } });
    const { setTo } = actions({
      setTo: async (setState: SetState<{ value: number }>, n: number) => {
        await Promise.resolve();
        setState({ value: n });
      },
    });
    await setTo(42);
    expect(getState().value).toBe(42);
  });

  it("async action returns a promise", () => {
    const { actions } = createStore({ state: { done: false } });
    const { run } = actions({
      run: async (setState: SetState<{ done: boolean }>) => {
        setState({ done: true });
      },
    });
    expect(run()).toBeInstanceOf(Promise);
  });

  it("async action notifies subscribers after each setState call", async () => {
    const { subscribe, actions } = createStore({ state: { step: 0 } });
    const steps: number[] = [];
    subscribe((s) => steps.push(s.step));
    const { run } = actions({
      run: async (setState: SetState<{ step: number }>) => {
        setState({ step: 1 });
        await Promise.resolve();
        setState({ step: 2 });
      },
    });
    await run();
    expect(steps).toEqual([1, 2]);
  });

  it("new action starts with idle status and no error", () => {
    const { actions } = createStore({ state: { count: 0 } });
    const { inc } = actions({
      inc: (setState) => setState((s) => ({ count: s.count + 1 })),
    });
    expect(inc.getMeta()).toEqual({ status: "idle", error: undefined });
  });

  it("sync action reaches success status after completing", () => {
    const { actions } = createStore({ state: { count: 0 } });
    const { inc } = actions({
      inc: (setState) => setState((s) => ({ count: s.count + 1 })),
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
      load: async (setState: SetState<{ value: string }>) => {
        await Promise.resolve();
        setState({ value: "done" });
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
      load: async (setState: SetState<{ value: string }>) => {
        await Promise.resolve();
        setState({ value: "done" });
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
  it("calls onInit once with the store", () => {
    const onInit = vi.fn();
    const plugin: StoicPlugin<{ count: number }> = { onInit };
    const store = createStore({ state: { count: 0 }, plugins: [plugin] });
    expect(onInit).toHaveBeenCalledOnce();
    expect(onInit).toHaveBeenCalledWith(
      expect.objectContaining({ getState: expect.any(Function) }),
    );
    expect(onInit.mock.calls[0]?.[0].getState()).toEqual({ count: 0 });
    store.destroy();
  });

  it("calls beforeSetState with the raw partial and afterSetState with merged state", () => {
    const calls: string[] = [];
    const plugin: StoicPlugin<{ count: number; name: string }> = {
      beforeSetState: (next) => calls.push(`before:${JSON.stringify(next)}`),
      afterSetState: (state) => calls.push(`after:${JSON.stringify(state)}`),
    };
    const store = createStore({
      state: { count: 0, name: "stoic" },
      plugins: [plugin],
    });
    store.setState({ count: 1 });
    expect(calls).toEqual(['before:{"count":1}', 'after:{"count":1,"name":"stoic"}']);
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
      inc: (setState, by: number) => setState((s) => ({ count: s.count + by })),
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
      inc: (setState, by: number) => setState((s) => ({ count: s.count + by })),
      dec: (setState, by: number) => setState((s) => ({ count: s.count - by })),
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
      load: async (setState: SetState<{ value: string }>) => {
        await Promise.resolve();
        setState({ value: "done" });
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
    const hook = renderHook(() => store.useStore());
    expect(hook.get()).toEqual({ count: 0, label: "hello" });
    hook.unmount();
  });

  it("returns selected slice with a selector", () => {
    const store = createStore({ state: { count: 7, label: "hello" } });
    const hook = renderHook(() => store.useStore((s) => s.count));
    expect(hook.get()).toBe(7);
    hook.unmount();
  });

  it("updates when selected state changes", () => {
    const store = createStore({ state: { count: 0 } });
    const hook = renderHook(() => store.useStore((s) => s.count));
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
      return store.useStore((s) => s.count);
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
      return store.useStore(
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
      return store.useStore((s) => ({ subtotal: s.subtotal, total: s.total }), shallow);
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
      const { items } = store.useStore(
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

describe("useStore SSR", () => {
  it("uses the selected state as the server snapshot when rendered on the server", () => {
    const store = createStore({ state: { count: 42, label: "server" } });

    function Component() {
      const count = store.useStore((s) => s.count);
      return <div>{count}</div>;
    }

    const html = renderToString(<Component />);
    expect(html).toContain("42");
  });

  it("caches the server snapshot so object-literal selectors can hydrate", () => {
    const store = createStore({ state: { count: 42, label: "server", other: 0 } });

    function Component() {
      const { count, label } = store.useStore((s) => ({ count: s.count, label: s.label }), shallow);
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
      load: async (setState: SetState<{ value: string }>) => {
        await Promise.resolve();
        setState({ value: "done" });
      },
    });
    const hook = renderHook(() => load.useMeta());
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
    const hook = renderHook(() => load.useMeta());

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
});
