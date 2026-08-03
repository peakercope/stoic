// Isolated A/B benchmark runner for the built `dist`. The only benchmark
// harness in this repo.
//
// Running every case in one process lets composite cases (batch, fan-out,
// actions) pick up phantom ±7–27% swings that reverse in clean runs. This
// runner spawns one child process per case instead, so a case only ever shares
// an isolate with itself.
//
//   node scripts/bench.mjs                     run every case, print a table
//   node scripts/bench.mjs --save base.json    …and write the numbers to a file
//   node scripts/bench.mjs --base base.json    …and diff against an earlier run
//   node scripts/bench.mjs --case set:derived-read2   run one case (used internally)
//   node scripts/bench.mjs --filter action     run only cases matching a substring
//
// Always `yarn build` first — the cases import ../dist/index.js (and, for the
// `render:` cases, ../dist/react.js).

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);

// ─── case definitions ─────────────────────────────────────────────────────────
// Each case builds its own fixtures in `setup` (untimed) and returns the
// function to time. `iters` is tuned so every case runs for roughly a tenth of
// a second per round; a case must return a number so the accumulator keeps the
// work observably live.
//
// A case declaring `needs: "react"` gets a second `setup` argument carrying a
// DOM, React, and the built `useStore` — see makeReactCtx.

const state3 = () => ({ count: 0, name: "a", other: 1 });

const derived3 = {
  double: (s) => s.count * 2,
  label: (s) => `${s.name}:${s.double}`,
  total: (s) => s.count + s.other,
};

// Eight derived keys over eight raw keys, each depending on exactly one raw
// key. Writing `a0` leaves seven of them provably unaffected — the shape a
// push-based staleness graph is supposed to exploit, and the one shape the
// existing suite never measures.
const fanoutState = () => ({ a0: 0, a1: 1, a2: 2, a3: 3, a4: 4, a5: 5, a6: 6, a7: 7 });
const fanoutDerived = {
  d0: (s) => s.a0 * 2,
  d1: (s) => s.a1 * 2,
  d2: (s) => s.a2 * 2,
  d3: (s) => s.a3 * 2,
  d4: (s) => s.a4 * 2,
  d5: (s) => s.a5 * 2,
  d6: (s) => s.a6 * 2,
  d7: (s) => s.a7 * 2,
};

// Sixty-four raw keys, one per subscribed component in the fan-out cases below.
// A real tree subscribes far more components than a store has derived cells,
// and the per-notify cost scales with the former, not the latter.
const wideState = (n) => {
  const state = {};
  for (let i = 0; i < n; i++) state[`a${i}`] = i;
  return state;
};

// Subscribes one listener per key, each running a selector and bailing on an
// equality check — what `useStore` does for every mounted component on every
// notify. The selector is compiled rather than closed over a key variable so
// the property access is the literal `s.a3` form a consumer would write.
const subscribeSelectors = (store, keys) => {
  for (const key of keys) {
    const selector = new Function("s", `return s.${key}`);
    let prev = selector(store.getState());
    store.subscribe((s) => {
      const next = selector(s);
      if (!Object.is(prev, next)) prev = next;
    });
  }
};

const CASES = {
  // ── creation ──
  "create:state-only": {
    iters: 1e6,
    setup: (createStore) => () => {
      const s = createStore({ state: { count: 0, name: "a", other: 1 } });
      return s === undefined ? 1 : 0;
    },
  },
  "create:derived-shared": {
    iters: 5e5,
    setup: (createStore) => () => {
      const s = createStore({ state: { count: 0, name: "a", other: 1 }, derived: derived3 });
      return s === undefined ? 1 : 0;
    },
  },
  // Distinct config object per store — what every `createStoreContext` factory
  // and every per-request SSR store actually does. The snapshot-class cache is
  // keyed on derived key names, so this still hits it; the case pins the cost
  // of the per-call config and derived-fn allocations on top of that.
  "create:derived-inline": {
    iters: 3e5,
    setup: (createStore) => () => {
      const s = createStore({
        state: { count: 0, name: "a", other: 1 },
        derived: {
          double: (x) => x.count * 2,
          label: (x) => `${x.name}:${x.double}`,
          total: (x) => x.count + x.other,
        },
      });
      return s === undefined ? 1 : 0;
    },
  },

  // ── setState ──
  "set:state-only-1l": {
    iters: 5e6,
    setup: (createStore) => {
      const store = createStore({ state: state3() });
      store.subscribe(() => {});
      let i = 0;
      return () => {
        store.setState({ count: i++ });
        return 0;
      };
    },
  },
  "set:state-only-8l": {
    iters: 2e6,
    setup: (createStore) => {
      const store = createStore({ state: state3() });
      for (let l = 0; l < 8; l++) store.subscribe(() => {});
      let i = 0;
      return () => {
        store.setState({ count: i++ });
        return 0;
      };
    },
  },
  // A React app of any size has far more than eight live subscribers, and
  // per-listener dispatch cost is what scales there.
  "set:state-only-64l": {
    iters: 5e5,
    setup: (createStore) => {
      const store = createStore({ state: state3() });
      for (let l = 0; l < 64; l++) store.subscribe(() => {});
      let i = 0;
      return () => {
        store.setState({ count: i++ });
        return 0;
      };
    },
  },
  "set:derived-unread": {
    iters: 3e6,
    setup: (createStore) => {
      const store = createStore({ state: state3(), derived: derived3 });
      store.subscribe(() => {});
      let i = 0;
      return () => {
        store.setState({ count: i++ });
        return 0;
      };
    },
  },
  "set:derived-read2": {
    iters: 1e6,
    setup: (createStore) => {
      const store = createStore({ state: state3(), derived: derived3 });
      store.subscribe(() => {});
      let i = 0;
      return () => {
        store.setState({ count: i++ });
        const s = store.getState();
        return s.double + s.total;
      };
    },
  },
  "set:selector-style": {
    iters: 1e6,
    setup: (createStore) => {
      const store = createStore({ state: state3(), derived: derived3 });
      let i = 0;
      return () => {
        store.setState({ count: i++ });
        const s = store.getState();
        return s.double + s.count + s.other;
      };
    },
  },
  "set:derived-chain": {
    iters: 1e6,
    setup: (createStore) => {
      const store = createStore({ state: state3(), derived: derived3 });
      store.subscribe(() => {});
      let i = 0;
      return () => {
        store.setState({ count: i++ });
        return store.getState().label.length;
      };
    },
  },
  "set:batch10": {
    iters: 5e5,
    setup: (createStore) => {
      const store = createStore({ state: state3() });
      store.subscribe(() => {});
      let i = 0;
      return () => {
        store.batch(() => {
          for (let n = 0; n < 10; n++) store.setState({ count: i++ });
        });
        return 0;
      };
    },
  },

  // Eight raw keys rather than three: the snapshot clone is the bulk of a
  // derived store's write cost, and `Object.assign` versus a keyed loop only
  // diverges once the source map is wide enough for the per-key transition
  // lookups to show up.
  "set:derived-8raw": {
    iters: 1e6,
    setup: (createStore) => {
      const store = createStore({
        state: fanoutState(),
        derived: { d0: (s) => s.a0 * 2, d1: (s) => s.a1 * 2, d2: (s) => s.a0 + s.a1 },
      });
      store.subscribe(() => {});
      let i = 0;
      return () => {
        store.setState({ a0: i++ });
        return 0;
      };
    },
  },

  // ── subscription churn ──
  // A route change unmounts a whole subtree at once, so unsubscribe arrives in
  // bursts rather than one at a time. Nothing else in the suite measures it,
  // which let an O(n) scan plus an O(n) compaction *per* unsubscribe go unseen.
  "unsub:mass-unmount-256": {
    iters: 2e3,
    setup: (createStore) => {
      const store = createStore({ state: state3() });
      // Distinct functions, allocated once outside the timed loop: subscribing
      // the *same* function 256 times would make an indexOf-based unsubscribe
      // hit index 0 every time and hide exactly the cost this case exists for.
      const listeners = Array.from({ length: 256 }, () => () => {});
      const unsubs = new Array(256);
      return () => {
        for (let i = 0; i < 256; i++) unsubs[i] = store.subscribe(listeners[i]);
        for (let i = 0; i < 256; i++) unsubs[i]();
        return 0;
      };
    },
  },

  // ── derived fan-out: write one raw key, read all eight derived ──
  "fanout:8derived-1changed": {
    iters: 5e5,
    setup: (createStore) => {
      const store = createStore({ state: fanoutState(), derived: fanoutDerived });
      store.subscribe(() => {});
      let i = 0;
      return () => {
        store.setState({ a0: i++ });
        const s = store.getState();
        return s.d0 + s.d1 + s.d2 + s.d3 + s.d4 + s.d5 + s.d6 + s.d7;
      };
    },
  },

  // ── subscriber fan-out: what a notify costs once a tree is mounted ──
  // Every subscribed component re-runs its selector on every store write and
  // bails on the equality check — that O(components) cost is what `useStore`
  // actually spends per write, and nothing else in the suite measures it.
  // Modelled without React on purpose: React's own per-commit work is in the
  // µs range and would bury a ns-scale signal (the `render:` cases below cover
  // the end-to-end number at that coarser resolution).
  //
  // The pair isolates the two halves. `-1changed` is the realistic shape — one
  // component's slice moves and 63 selectors run only to bail — while the
  // unsuffixed case makes all 64 selections change, so none of them bail.
  // Both cases subscribe 64 selectors that differ only in which key they read,
  // so the pair isolates bail-vs-change and nothing else. `subscribeSelectors`
  // compiles each one to a literal property access, because a closure over a
  // computed key (`s[k]`) is a different and much slower access in V8 than the
  // `s => s.count` consumers actually write — measuring that instead would put
  // a 3.6x artifact between two cases meant to be read against each other.
  "notify:selector-fanout-64": {
    iters: 2e5,
    setup: (createStore) => {
      const store = createStore({ state: wideState(64) });
      // Every selector reads the key the timed write touches: nothing bails.
      subscribeSelectors(store, new Array(64).fill("a0"));
      let i = 0;
      return () => {
        store.setState({ a0: i++ });
        return 0;
      };
    },
  },
  "notify:selector-fanout-64-1changed": {
    iters: 2e5,
    setup: (createStore) => {
      const store = createStore({ state: wideState(64) });
      // One selector per key, so 63 of them run only to bail — the shape a
      // mounted tree actually has.
      subscribeSelectors(
        store,
        Array.from({ length: 64 }, (_, n) => `a${n}`),
      );
      let i = 0;
      return () => {
        store.setState({ a0: i++ });
        return 0;
      };
    },
  },

  // ── reads ──
  "read:repeat-derived": {
    iters: 1e7,
    setup: (createStore) => {
      const store = createStore({ state: state3(), derived: derived3 });
      const snap = store.getState();
      return () => snap.double;
    },
  },

  // ── actions ──
  "action:sync": {
    iters: 3e6,
    setup: (createStore) => {
      const store = createStore({ state: state3() });
      const { inc } = store.actions({ inc: (ctx) => ctx.set({ count: ctx.get().count + 1 }) });
      return () => {
        inc();
        return 0;
      };
    },
  },
  "action:sync-1arg": {
    iters: 3e6,
    setup: (createStore) => {
      const store = createStore({ state: state3() });
      const { add } = store.actions({ add: (ctx, n) => ctx.set({ count: ctx.get().count + n }) });
      return () => {
        add(1);
        return 0;
      };
    },
  },
  // With an afterSetState plugin attached, attribution is live and the per-call
  // `set` closure cannot be elided — the slow half of the action path.
  "action:sync-plugin": {
    iters: 2e6,
    setup: (createStore) => {
      let seen = 0;
      const store = createStore({
        state: state3(),
        plugins: [
          {
            afterSetState(_s, name) {
              if (name !== undefined) seen++;
            },
          },
        ],
      });
      const { inc } = store.actions({ inc: (ctx) => ctx.set({ count: ctx.get().count + 1 }) });
      return () => {
        inc();
        return seen & 0;
      };
    },
  },
  "action:async": {
    iters: 2e5,
    async: true,
    setup: (createStore) => {
      const store = createStore({ state: state3() });
      const { incAsync } = store.actions({
        incAsync: async (ctx) => ctx.set({ count: ctx.get().count + 1 }),
      });
      return async () => {
        await incAsync();
        return 0;
      };
    },
  },

  // ── React: the binding, end to end ──
  // Coarser than the `notify:` cases — React's per-commit work is µs-scale and
  // partly masks a ns-scale delta — so these confirm a win survives in the
  // units a consumer feels, rather than being the instrument that detects it.
  //
  // Selectors are written inline, because that is what consumers write and
  // because a memo keyed on selector identity is worthless for exactly that
  // shape.
  "render:mount-64": {
    iters: 2e3,
    needs: "react",
    setup: (createStore, { createElement, createRoot, flushSync, useStore, document }) => {
      const store = createStore({ state: wideState(64) });
      const Leaf = ({ k }) =>
        createElement(
          "span",
          null,
          useStore(store, (s) => s[k]),
        );
      const App = () => {
        const kids = [];
        for (let i = 0; i < 64; i++) kids.push(createElement(Leaf, { key: i, k: `a${i}` }));
        return createElement("div", null, kids);
      };
      return () => {
        // A fresh container per iteration: reusing one across mount/unmount
        // cycles makes React warn about re-rooting a used node.
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        flushSync(() => root.render(createElement(App)));
        // Outside flushSync — unmounting synchronously from inside a flush
        // warns about tearing down a root mid-render.
        root.unmount();
        container.remove();
        return 0;
      };
    },
  },
  "render:update-64-1changed": {
    iters: 2e4,
    needs: "react",
    setup: (createStore, { createElement, createRoot, flushSync, useStore, document }) => {
      const store = createStore({ state: wideState(64) });
      const Leaf = ({ k }) =>
        createElement(
          "span",
          null,
          useStore(store, (s) => s[k]),
        );
      const App = () => {
        const kids = [];
        for (let i = 0; i < 64; i++) kids.push(createElement(Leaf, { key: i, k: `a${i}` }));
        return createElement("div", null, kids);
      };
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      flushSync(() => root.render(createElement(App)));
      let i = 0;
      return () => {
        // 64 subscribers wake, 63 bail on equality, 1 re-renders.
        flushSync(() => store.setState({ a0: i++ }));
        return 0;
      };
    },
  },
  // No store write at all: a parent re-render drags 64 `useStore` calls through
  // a render each. This is the case that isolates the per-render cost of the
  // binding itself — an unstable `getSnapshot` identity makes React schedule a
  // passive effect and re-run the selector once more on every one of them.
  "render:rerender-parent-64": {
    iters: 2e4,
    needs: "react",
    setup: (createStore, { createElement, createRoot, flushSync, useStore, document }) => {
      const store = createStore({ state: wideState(64) });
      // A second store drives the parent, so the timed loop re-renders the tree
      // without touching the store the leaves read.
      const tick = createStore({ state: { n: 0 } });
      const Leaf = ({ k }) =>
        createElement(
          "span",
          null,
          useStore(store, (s) => s[k]),
        );
      const App = () => {
        useStore(tick, (s) => s.n);
        const kids = [];
        for (let i = 0; i < 64; i++) kids.push(createElement(Leaf, { key: i, k: `a${i}` }));
        return createElement("div", null, kids);
      };
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      flushSync(() => root.render(createElement(App)));
      let i = 0;
      return () => {
        flushSync(() => tick.setState({ n: i++ }));
        return 0;
      };
    },
  },
};

// ─── React context (built only for cases that ask for it) ─────────────────────

// Installing a DOM and loading react-dom costs ~100 ms and permanently dirties
// the global object, so it happens lazily and only for `needs: "react"` cases.
// Every case already runs in its own child process, so nothing else can see it.
async function makeReactCtx() {
  const { GlobalWindow } = await import("happy-dom");
  const win = new GlobalWindow({ url: "http://localhost" });

  // Node defines some of these (navigator) as getter-only on globalThis, so a
  // plain assignment throws.
  const put = (key, value) =>
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });

  for (const key of Object.getOwnPropertyNames(win)) {
    if (key in globalThis) continue;
    try {
      put(key, win[key]);
    } catch {}
  }
  put("window", win);
  put("document", win.document);
  put("navigator", win.navigator);
  // `act` is not used — its own bookkeeping is heavier than what these cases
  // measure — so tell React not to expect it.
  put("IS_REACT_ACT_ENVIRONMENT", false);

  // Imported after the globals land: react-dom reads them at module scope.
  const { createElement } = await import("react");
  const { createRoot } = await import("react-dom/client");
  const { flushSync } = await import("react-dom");
  const { useStore } = await import("../dist/react.js");

  return { createElement, createRoot, flushSync, useStore, document: win.document };
}

// ─── single-case runner (child process) ───────────────────────────────────────

async function runCase(name) {
  const { createStore } = await import("../dist/index.js");
  const def = CASES[name];
  if (def === undefined) throw new Error(`unknown case: ${name}`);

  const ctx = def.needs === "react" ? await makeReactCtx() : undefined;
  const fn = def.setup(createStore, ctx);
  const iters = def.iters;

  const round = def.async
    ? async () => {
        let sink = 0;
        const start = process.hrtime.bigint();
        for (let i = 0; i < iters; i++) sink += await fn();
        const end = process.hrtime.bigint();
        return { ns: Number(end - start) / iters, sink };
      }
    : async () => {
        let sink = 0;
        const start = process.hrtime.bigint();
        for (let i = 0; i < iters; i++) sink += fn();
        const end = process.hrtime.bigint();
        return { ns: Number(end - start) / iters, sink };
      };

  // One warmup round to let TurboFan settle, then three timed rounds. The
  // fastest round is the signal: slower rounds are GC and scheduler noise, and
  // averaging them just mixes noise back in.
  await round();
  let best = Infinity;
  let sink = 0;
  for (let r = 0; r < 3; r++) {
    const result = await round();
    if (result.ns < best) best = result.ns;
    sink += result.sink;
  }

  // Keeps the accumulator observably live without printing on the happy path.
  if (!Number.isFinite(sink)) console.error("sink");
  process.stdout.write(JSON.stringify({ name, ns: best }));
}

// ─── orchestrator (parent process) ────────────────────────────────────────────

function runAll(filter) {
  const results = {};
  for (const name of Object.keys(CASES)) {
    if (filter && !name.includes(filter)) continue;
    const child = spawnSync(process.execPath, [SELF, "--case", name], {
      encoding: "utf8",
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? "production" },
    });
    if (child.status !== 0) {
      console.error(`${name}: FAILED\n${child.stderr}`);
      continue;
    }
    results[name] = JSON.parse(child.stdout).ns;
  }
  return results;
}

const fmt = (ns) => (ns >= 1000 ? `${(ns / 1000).toFixed(2)} µs` : `${ns.toFixed(1)} ns`);

function report(results, base) {
  const names = Object.keys(results);
  if (names.length === 0) {
    console.log("no cases matched (--filter is a plain substring, not a regex)");
    return;
  }
  const width = Math.max(...names.map((n) => n.length));
  console.log(`\n${"case".padEnd(width)}  ${"ns/op".padStart(10)}${base ? "  vs base" : ""}`);
  console.log("-".repeat(width + (base ? 22 : 12)));
  for (const name of names) {
    const ns = results[name];
    let delta = "";
    if (base && base[name] !== undefined) {
      const pct = ((ns - base[name]) / base[name]) * 100;
      const sign = pct > 0 ? "+" : "";
      // Cross-run variance is 2–5%; anything under 10% is not a signal.
      const mark = Math.abs(pct) < 10 ? " " : pct < 0 ? "*" : "!";
      delta = `  ${sign}${pct.toFixed(1)}%${mark}`;
    }
    console.log(`${name.padEnd(width)}  ${fmt(ns).padStart(10)}${delta}`);
  }
  if (base) console.log("\n* faster by >10%   ! slower by >10%   (blank = within noise)");
}

const argv = process.argv.slice(2);
const arg = (flag) => {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
};

const single = arg("--case");
if (single) {
  await runCase(single);
} else {
  const results = runAll(arg("--filter"));
  const basePath = arg("--base");
  const base = basePath ? JSON.parse(readFileSync(basePath, "utf8")) : undefined;
  report(results, base);
  const savePath = arg("--save");
  if (savePath) {
    writeFileSync(savePath, `${JSON.stringify(results, null, 2)}\n`);
    console.log(`\nsaved to ${savePath}`);
  }
}
