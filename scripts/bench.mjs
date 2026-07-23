// Isolated A/B benchmark runner for the built `dist`.
//
// `vitest bench` runs every case in one process, where composite cases (batch,
// fan-out, actions) pick up phantom ±7–27% swings that reverse in clean runs.
// This runner spawns one child process per case instead, so a case only ever
// shares an isolate with itself.
//
//   node scripts/bench.mjs                     run every case, print a table
//   node scripts/bench.mjs --save base.json    …and write the numbers to a file
//   node scripts/bench.mjs --base base.json    …and diff against an earlier run
//   node scripts/bench.mjs --case set:derived-read2   run one case (used internally)
//   node scripts/bench.mjs --filter action     run only cases matching a substring
//
// Always `yarn build` first — the cases import ../dist/index.js.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);

// ─── case definitions ─────────────────────────────────────────────────────────
// Each case builds its own fixtures in `setup` (untimed) and returns the
// function to time. `iters` is tuned so every case runs for roughly a tenth of
// a second per round; a case must return a number so the accumulator keeps the
// work observably live.

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
  // and every per-request SSR store actually does. PROTO_CACHE is keyed on
  // config identity today, so this never hits it.
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
};

// ─── single-case runner (child process) ───────────────────────────────────────

async function runCase(name) {
  const { createStore } = await import("../dist/index.js");
  const def = CASES[name];
  if (def === undefined) throw new Error(`unknown case: ${name}`);

  const fn = def.setup(createStore);
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
