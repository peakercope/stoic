import { bench, describe } from "vitest";
import { createStore } from "../dist/index.js";

type State = { count: number; name: string; other: number };

const derivedConfig = {
  double: (s: State) => s.count * 2,
  label: (s: State & { double: number }) => `${s.name}:${s.double}`,
  total: (s: State) => s.count + s.other,
};

describe("create", () => {
  bench("state-only (3 keys)", () => {
    createStore({ state: { count: 0, name: "a", other: 1 } });
  });

  bench("3 derived keys", () => {
    createStore({ state: { count: 0, name: "a", other: 1 }, derived: derivedConfig });
  });
});

describe("setState", () => {
  let i = 0;

  {
    const store = createStore({ state: { count: 0, name: "a", other: 1 } });
    store.subscribe(() => {});
    bench("state-only, 1 listener", () => {
      store.setState({ count: i++ });
    });
  }

  {
    const store = createStore({ state: { count: 0, name: "a", other: 1 }, derived: derivedConfig });
    store.subscribe(() => {});
    bench("with derived (unread)", () => {
      store.setState({ count: i++ });
    });
  }

  {
    const store = createStore({ state: { count: 0, name: "a", other: 1 }, derived: derivedConfig });
    store.subscribe(() => {});
    let sink = 0;
    bench("setState + read 2 derived", () => {
      store.setState({ count: i++ });
      const s = store.getState();
      sink += s.double + s.total;
      if (sink === -1) console.log(sink);
    });
  }

  {
    const store = createStore({ state: { count: 0, name: "a", other: 1 }, derived: derivedConfig });
    let sink = 0;
    bench("selector-style raw read on fresh snapshot", () => {
      store.setState({ count: i++ });
      const s = store.getState();
      sink += s.double; // pin one derived key…
      sink += s.count + s.other; // …then read raw keys on the pinned snapshot
      if (sink === -1) console.log(sink);
    });
  }

  {
    const store = createStore({ state: { count: 0, name: "a", other: 1 }, derived: derivedConfig });
    store.subscribe(() => {});
    let sink = 0;
    bench("derived chain recompute (label → double)", () => {
      store.setState({ count: i++ });
      sink += store.getState().label.length;
      if (sink === -1) console.log(sink);
    });
  }

  {
    const store = createStore({ state: { count: 0, name: "a", other: 1 } });
    for (let l = 0; l < 8; l++) store.subscribe(() => {});
    bench("state-only, 8 listeners", () => {
      store.setState({ count: i++ });
    });
  }

  {
    const store = createStore({ state: { count: 0, name: "a", other: 1 } });
    store.subscribe(() => {});
    bench("batch of 10 setStates", () => {
      store.batch(() => {
        for (let n = 0; n < 10; n++) store.setState({ count: i++ });
      });
    });
  }
});

describe("read", () => {
  {
    const store = createStore({ state: { count: 0, name: "a", other: 1 }, derived: derivedConfig });
    const snap = store.getState();
    let sink = 0;
    bench("repeat derived read, same snapshot", () => {
      sink += snap.double;
      if (sink === -1) console.log(sink);
    });
  }
});

describe("actions", () => {
  const store = createStore({ state: { count: 0, name: "a", other: 1 } });
  const { inc } = store.actions({ inc: ({ set, get }) => set({ count: get().count + 1 }) });
  bench("sync action invocation", () => {
    inc();
  });

  const { incAsync } = store.actions({
    incAsync: async ({ set, get }) => set({ count: get().count + 1 }),
  });
  bench("async action invocation", async () => {
    await incAsync();
  });
});
