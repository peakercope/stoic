// Bundle-size report for the built `dist/prod`. Companion to bench.mjs — same
// flags, same "save a baseline, then diff it" workflow.
//
//   node scripts/size.mjs                       print the table
//   node scripts/size.mjs --save size.json      …and write the numbers to a file
//   node scripts/size.mjs --base size.json      …and diff against an earlier run
//   node scripts/size.mjs --filter react        only entries matching a substring
//   node scripts/size.mjs --base size.json --max-growth 64
//                                               …and exit 1 if an entry grew by
//                                               more than 64 gzip bytes
//
// Always `yarn build` first — this reads dist/prod.
//
// Sizes are per *entry point*, not per file: an entry is measured together with
// every chunk it statically pulls in, which is what a consumer importing that
// specifier actually pays. Keying the report on entries rather than filenames
// also keeps a saved baseline comparable, since the shared chunk carries a
// content hash that changes whenever its contents do.
//
// Gzip is the headline number because that is how the file crosses the wire.
// The concatenated-then-gzipped total approximates what a bundler emits far
// better than summing each chunk's gzip would.

import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "dist", "prod");

// The fixed public entry points, mirroring package.json#exports. Adding one
// here without adding it there (and to tsdown.config.ts) is a bug.
const ENTRIES = {
  ".": "index.js",
  "./react": "react.js",
  "./tools": "tools.js",
  "./plugins": "plugins.js",
  "./plugins/persist": "plugins/persist.js",
  "./plugins/devtools": "plugins/devtools.js",
};

// Matches the specifier of a re-`export … from`, an `import … from`, or a bare
// side-effect `import`. Written to survive minified output, where the clause
// runs straight into the keyword with no space: `import{n as e,t}from"./x.js"`.
// `\bfrom` still finds that, since `}` ends a word.
const SPECIFIER = /(?:\bfrom\s*|(?:^|[;\s])import\s*)["']([^"']+)["']/g;

// Every chunk the entry reaches, entry included. Relative specifiers only —
// a bare one is an external (react), which the consumer already has.
function chunksFor(entryFile) {
  const seen = new Set();
  const queue = [entryFile];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(join(DIST, file), "utf8");
    for (const [, specifier] of source.matchAll(SPECIFIER)) {
      if (!specifier.startsWith(".")) continue;
      queue.push(relative(DIST, resolve(DIST, dirname(file), specifier)));
    }
  }
  return [...seen].sort();
}

function measure(filter) {
  const results = {};
  for (const [name, file] of Object.entries(ENTRIES)) {
    if (filter && !name.includes(filter)) continue;
    const chunks = chunksFor(file);
    const source = chunks.map((chunk) => readFileSync(join(DIST, chunk))).join("\n");
    results[name] = {
      raw: Buffer.byteLength(source),
      gzip: gzipSync(source, { level: 9 }).length,
      chunks: chunks.length,
    };
  }
  return results;
}

const fmt = (bytes) => `${(bytes / 1024).toFixed(2)} kB`;

function report(results, base) {
  const names = Object.keys(results);
  if (names.length === 0) {
    console.log("no entries matched (--filter is a plain substring, not a regex)");
    return [];
  }
  const grown = [];
  const width = Math.max(...names.map((n) => n.length), "entry".length);
  console.log(
    `\n${"entry".padEnd(width)}  ${"raw".padStart(9)}  ${"gzip".padStart(9)}${base ? "  vs base" : ""}`,
  );
  console.log("-".repeat(width + (base ? 34 : 22)));
  for (const name of names) {
    const { raw, gzip } = results[name];
    let delta = "";
    const previous = base?.[name]?.gzip;
    if (previous !== undefined) {
      const diff = gzip - previous;
      // Bytes, not percent: the entries differ by an order of magnitude in
      // size, so the same percentage means very different things across rows.
      // Anything at all is a signal — unlike a timing, a byte count is exact.
      delta = diff === 0 ? "  —" : `  ${diff > 0 ? "+" : ""}${diff} B${diff > 0 ? " !" : " *"}`;
      if (diff > 0) grown.push({ name, diff });
    }
    console.log(`${name.padEnd(width)}  ${fmt(raw).padStart(9)}  ${fmt(gzip).padStart(9)}${delta}`);
  }
  if (base) console.log("\n* smaller   ! larger   (gzip bytes; exact, not sampled)");
  return grown;
}

const argv = process.argv.slice(2);
const arg = (flag) => {
  const i = argv.indexOf(flag);
  return i === -1 ? undefined : argv[i + 1];
};

const results = measure(arg("--filter"));
const basePath = arg("--base");
const grown = report(results, basePath ? JSON.parse(readFileSync(basePath, "utf8")) : undefined);

const savePath = arg("--save");
if (savePath) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(savePath, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`\nsaved to ${savePath}`);
}

// The CI gate. A budget rather than zero tolerance: minifier and bundler
// upgrades move these numbers by a few bytes on their own, and a check that
// cries wolf on every dependency bump gets ignored — which is worse than not
// having one. Growth beyond the budget is a deliberate decision, so it should
// cost a baseline update and show up in review as one.
const maxGrowth = arg("--max-growth");
if (maxGrowth !== undefined && grown.length > 0) {
  const budget = Number(maxGrowth);
  const over = grown.filter(({ diff }) => diff > budget);
  if (over.length > 0) {
    console.error(
      `\nbundle size regression (budget ${budget} B gzip):\n` +
        over.map(({ name, diff }) => `  ${name}  +${diff} B`).join("\n") +
        "\n\nIf the growth is intended, re-save the baseline:\n" +
        `  yarn size --save ${basePath ?? "size-baseline.json"}`,
    );
    process.exit(1);
  }
}
