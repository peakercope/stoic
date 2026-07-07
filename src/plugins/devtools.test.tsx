import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "../stoic";
import { devtools } from "./devtools";

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
      increment: (setState) => {
        setState((s) => ({ count: s.count + 1 }));
      },
    });

    actions.increment();

    expect(extension.send).toHaveBeenCalledWith({ type: "increment" }, { count: 1 });
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

  it("does nothing when the devtools extension is not present", () => {
    const store = createStore({
      state: { count: 0 },
      plugins: [devtools<{ count: number }>({})],
    });

    expect(() => store.setState({ count: 1 })).not.toThrow();
    store.destroy();
  });
});
