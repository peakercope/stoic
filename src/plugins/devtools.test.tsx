import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "../stoic";
import { devtools } from "./devtools";
import { persist } from "./persist";

type Listener = (message: {
  type: string;
  state?: string;
  payload?: { type: string; nextLiftedState?: { computedStates?: { state?: unknown }[] } };
}) => void;

function installFakeExtension() {
  const init = vi.fn();
  const send = vi.fn();
  const unsubscribe = vi.fn();
  let listener: Listener | undefined;

  const connect = vi.fn(() => ({
    init,
    send,
    unsubscribe,
    subscribe: (l: Listener) => {
      listener = l;
      return unsubscribe;
    },
  }));

  (window as unknown as { __REDUX_DEVTOOLS_EXTENSION__?: unknown }).__REDUX_DEVTOOLS_EXTENSION__ = {
    connect,
  };

  return {
    init,
    send,
    unsubscribe,
    connect,
    emit: (message: Parameters<Listener>[0]) => listener?.(message),
  };
}

describe("devtools", () => {
  afterEach(() => {
    (window as unknown as { __REDUX_DEVTOOLS_EXTENSION__?: unknown }).__REDUX_DEVTOOLS_EXTENSION__ =
      undefined;
  });

  it("connects and initializes with the starting state", () => {
    const extension = installFakeExtension();

    const store = createStore({
      state: { count: 0 },
      plugins: [devtools<{ count: number }>({ name: "counter" })],
    });

    expect(extension.connect).toHaveBeenCalledWith({ name: "counter" });
    expect(extension.init).toHaveBeenCalledWith({ count: 0 });
    store.destroy();
  });

  it("tags a setState made inside an action with the action's name", () => {
    const extension = installFakeExtension();

    const store = createStore({
      state: { count: 0 },
      plugins: [devtools<{ count: number }>({})],
    });

    const actions = store.actions({
      increment: ({ set }) => {
        set((s) => ({ count: s.count + 1 }));
      },
    });

    actions.increment();

    expect(extension.send).toHaveBeenCalledWith({ type: "increment", args: [] }, { count: 1 });
    store.destroy();
  });

  it("sends the arguments an action was invoked with", () => {
    const extension = installFakeExtension();

    const store = createStore({
      state: { items: [] as { id: string; qty: number }[] },
      plugins: [devtools<{ items: { id: string; qty: number }[] }>({})],
    });

    const { addItem } = store.actions({
      addItem: ({ set }, id: string, qty: number) => {
        set((s) => ({ items: [...s.items, { id, qty }] }));
      },
    });

    addItem("a1", 2);

    expect(extension.send).toHaveBeenCalledWith(
      { type: "addItem", args: ["a1", 2] },
      { items: [{ id: "a1", qty: 2 }] },
    );
    store.destroy();
  });

  it("sends object arguments as-is", () => {
    const extension = installFakeExtension();

    const store = createStore({
      state: { count: 0 },
      plugins: [devtools<{ count: number }>({})],
    });

    const { addAll } = store.actions({
      addAll: ({ set }, amounts: number[]) => {
        set((s) => ({ count: s.count + amounts.reduce((a, b) => a + b, 0) }));
      },
    });

    addAll([1, 2]);

    expect(extension.send).toHaveBeenCalledWith({ type: "addAll", args: [[1, 2]] }, { count: 3 });
    store.destroy();
  });

  it("sends one entry per batch, carrying the args of the last state-changing write", () => {
    const extension = installFakeExtension();

    const store = createStore({
      state: { a: 0, b: 0 },
      plugins: [devtools<{ a: number; b: number }>({})],
    });

    const { setA, setB } = store.actions({
      setA: ({ set }, a: number) => set({ a }),
      setB: ({ set }, b: number) => set({ b }),
    });

    store.batch(() => {
      setA(1);
      setB(2);
    });

    expect(extension.send).toHaveBeenCalledTimes(1);
    expect(extension.send).toHaveBeenCalledWith({ type: "setB", args: [2] }, { a: 1, b: 2 });
    store.destroy();
  });

  it("tags a direct setState call outside of an action as anonymous", () => {
    const extension = installFakeExtension();

    const store = createStore({
      state: { count: 0 },
      plugins: [devtools<{ count: number }>({})],
    });

    store.setState({ count: 5 });

    expect(extension.send).toHaveBeenCalledWith({ type: "anonymous" }, { count: 5 });
    store.destroy();
  });

  it("attributes post-await writes of overlapping async actions to the right action", async () => {
    const extension = installFakeExtension();

    const store = createStore({
      state: { a: 0, b: 0 },
      plugins: [devtools<{ a: number; b: number }>({})],
    });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { slow, fast } = store.actions({
      slow: async ({ set }, a: number) => {
        await gate;
        set({ a });
      },
      fast: async ({ set }, b: number) => {
        set({ b });
      },
    });

    const slowPromise = slow(1);
    await fast(1);
    release();
    await slowPromise;

    expect(extension.send).toHaveBeenCalledWith({ type: "fast", args: [1] }, { a: 0, b: 1 });
    expect(extension.send).toHaveBeenCalledWith({ type: "slow", args: [1] }, { a: 1, b: 1 });
    store.destroy();
  });

  it("keeps unrelated writes anonymous while an async action is in flight", async () => {
    const extension = installFakeExtension();

    const store = createStore({
      state: { a: 0, b: 0 },
      plugins: [devtools<{ a: number; b: number }>({})],
    });

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { slow } = store.actions({
      slow: async ({ set }) => {
        await gate;
        set({ a: 1 });
      },
    });

    const slowPromise = slow();
    store.setState({ b: 1 });
    release();
    await slowPromise;

    expect(extension.send).toHaveBeenCalledWith({ type: "anonymous" }, { a: 0, b: 1 });
    expect(extension.send).toHaveBeenCalledWith({ type: "slow", args: [] }, { a: 1, b: 1 });
    store.destroy();
  });

  it("applies a JUMP_TO_STATE message via setState without re-sending to devtools", () => {
    const extension = installFakeExtension();

    const store = createStore({
      state: { count: 0 },
      plugins: [devtools<{ count: number }>({})],
    });

    extension.send.mockClear();

    extension.emit({
      type: "DISPATCH",
      state: JSON.stringify({ count: 42 }),
      payload: { type: "JUMP_TO_STATE" },
    });

    expect(store.getState()).toEqual({ count: 42 });
    expect(extension.send).not.toHaveBeenCalled();
    store.destroy();
  });

  it("re-initializes the connection with the current state on RESET", () => {
    const extension = installFakeExtension();

    const store = createStore({
      state: { count: 0 },
      plugins: [devtools<{ count: number }>({})],
    });

    store.setState({ count: 9 });
    extension.init.mockClear();

    extension.emit({ type: "DISPATCH", payload: { type: "RESET" } });

    expect(store.getState()).toEqual({ count: 0 });
    expect(extension.init).toHaveBeenCalledWith({ count: 0 });
    store.destroy();
  });

  it("unsubscribes from the devtools connection on destroy", () => {
    const extension = installFakeExtension();

    const store = createStore({
      state: { count: 0 },
      plugins: [devtools<{ count: number }>({})],
    });

    store.destroy();

    expect(extension.unsubscribe).toHaveBeenCalled();
  });

  it("gives simultaneously-created unnamed stores distinct devtools instance names", () => {
    const extension = installFakeExtension();

    const storeA = createStore({
      state: { count: 0 },
      plugins: [devtools<{ count: number }>({})],
    });
    const storeB = createStore({
      state: { count: 0 },
      plugins: [devtools<{ count: number }>({})],
    });

    const calls = extension.connect.mock.calls as { name: string }[][];
    expect(calls[0]?.[0]?.name).not.toEqual(calls[1]?.[0]?.name);

    storeA.destroy();
    storeB.destroy();
  });

  it("composes with persist on the same store: both observe one update, derived stays out of storage", () => {
    const extension = installFakeExtension();

    const store = createStore<{ count: number }, { doubled: number }>({
      state: { count: 0 },
      derived: { doubled: (s) => s.count * 2 },
      plugins: [
        persist<{ count: number }>({ key: "composed-storage" }),
        devtools<{ count: number }, { count: number; doubled: number }>({}),
      ],
    });
    const { inc } = store.actions({
      inc: ({ set }) => set((s) => ({ count: s.count + 1 })),
    });

    inc();

    expect(JSON.parse(localStorage.getItem("composed-storage") as string)).toEqual({ count: 1 });
    expect(extension.send).toHaveBeenCalledTimes(1);
    expect(extension.send).toHaveBeenCalledWith(
      { type: "inc", args: [] },
      expect.objectContaining({ count: 1 }),
    );
    expect(store.getState().doubled).toBe(2);
    localStorage.removeItem("composed-storage");
    store.destroy();
  });

  it("does nothing when the devtools extension is not present", () => {
    const store = createStore({
      state: { count: 0 },
      plugins: [devtools<{ count: number }>({})],
    });

    expect(() => store.setState({ count: 1 })).not.toThrow();
    store.destroy();
  });
});
