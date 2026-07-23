// Runs every case in one process, so composite cases pick up cross-case noise.
// For any contested number use `node scripts/bench.mjs`, which runs one child
// process per case and is what the perf work in this repo is measured with.
import { bench, describe } from "vitest";
// @ts-expect-error - built output, only present after `yarn build`
import { createStore } from "../dist/index.js";

type State = { count: number; name: string; other: number };

const derivedConfig = {
  double: (s: State) => s.count * 2,
  label: (s: State & { double: number }) => `${s.name}:${s.double}`,
  total: (s: State) => s.count + s.other,
};

// Eight derived keys over eight raw keys, each depending on exactly one of
// them. Writing `a0` leaves seven provably unaffected — the shape a real app
// has, and the one the rest of this file never exercises.
type FanoutState = { a0: number; a1: number; a2: number; a3: number };
const fanoutState = (): FanoutState => ({ a0: 0, a1: 1, a2: 2, a3: 3 });
const fanoutDerived = {
  d0: (s: FanoutState) => s.a0 * 2,
  d1: (s: FanoutState) => s.a1 * 2,
  d2: (s: FanoutState) => s.a2 * 2,
  d3: (s: FanoutState) => s.a3 * 2,
};

describe("create", () => {
  bench("state-only (3 keys)", () => {
    createStore({ state: { count: 0, name: "a", other: 1 } });
  });

  bench("3 derived keys", () => {
    createStore({ state: { count: 0, name: "a", other: 1 }, derived: derivedConfig });
  });

  // A factory building its derived config inline — what every
  // createStoreContext store and every per-request server store does.
  bench("3 derived keys, inline config", () => {
    createStore({
      state: { count: 0, name: "a", other: 1 },
      derived: {
        double: (s: State) => s.count * 2,
        label: (s: State & { double: number }) => `${s.name}:${s.double}`,
        total: (s: State) => s.count + s.other,
      },
    });
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
    for (let l = 0; l < 64; l++) store.subscribe(() => {});
    bench("state-only, 64 listeners", () => {
      store.setState({ count: i++ });
    });
  }

  {
    const store = createStore({ state: fanoutState(), derived: fanoutDerived });
    store.subscribe(() => {});
    let sink = 0;
    bench("write 1 raw key, read 4 derived (3 unaffected)", () => {
      store.setState({ a0: i++ });
      const s = store.getState();
      sink += s.d0 + s.d1 + s.d2 + s.d3;
      if (sink === -1) console.log(sink);
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
  //@ts-expect-error
  const { inc } = store.actions({ inc: (ctx) => ctx.set({ count: ctx.get().count + 1 }) });
  bench("sync action invocation", () => {
    inc();
  });

  const { incAsync } = store.actions({
    //@ts-expect-error
    incAsync: async (ctx) => ctx.set({ count: ctx.get().count + 1 }),
  });
  bench("async action invocation", async () => {
    await incAsync();
  });
});
