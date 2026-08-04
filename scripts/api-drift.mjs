// Fails when a public export is missing from docs/api-reference.md.
//
//   node scripts/api-drift.mjs
//
// Always `yarn build` first — this reads the generated `.d.ts` of every entry
// point, which is the authoritative public surface. Reading the built types
// rather than parsing `src/` means a re-export added anywhere still shows up,
// and it can't disagree with what consumers actually get.
//
// The reference is hand-written, which is why this exists: nothing else fails
// when an export lands undocumented. "The API is the whole product", so a new
// name reaching npm without a reference entry should cost a red build.
//
// This is a tripwire, not a proof of documentation quality. It checks that the
// name appears somewhere in the reference — not that what's written about it is
// any good, and not the reverse direction (a documented name that no longer
// exists), because plenty of legitimate prose mentions types by name.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Mirrors package.json#exports, like scripts/size.mjs. Adding an entry point
// means adding it here too.
const ENTRIES = {
  "stoic-store": "dist/index.d.ts",
  "stoic-store/react": "dist/react.d.ts",
  "stoic-store/tools": "dist/tools.d.ts",
  "stoic-store/plugins": "dist/plugins.d.ts",
  "stoic-store/plugins/persist": "dist/plugins/persist.d.ts",
  "stoic-store/plugins/devtools": "dist/plugins/devtools.d.ts",
};

const REFERENCE = "docs/api-reference.md";

// `export { a, type B, c as d }` — including the `… from "./x"` form. Anchored
// on `export` so the `import { … }` line a bundled .d.ts opens with is skipped.
const EXPORT_BLOCK = /\bexport\s*\{([^}]*)\}/g;

function exportedNames(file) {
  const source = readFileSync(join(ROOT, file), "utf8");
  const names = new Set();
  for (const [, body] of source.matchAll(EXPORT_BLOCK)) {
    for (const entry of body.split(",")) {
      const specifier = entry.trim().replace(/^type\s+/, "");
      if (specifier === "") continue;
      // `a as b` exports the name `b`; a bare `a` exports `a`.
      const alias = specifier.split(/\s+as\s+/);
      const name = (alias[1] ?? alias[0]).trim();
      if (name !== "" && name !== "default") names.add(name);
    }
  }
  return names;
}

const reference = readFileSync(join(ROOT, REFERENCE), "utf8");
const documented = (name) => new RegExp(`\\b${name}\\b`).test(reference);

let missing = 0;
for (const [specifier, file] of Object.entries(ENTRIES)) {
  const undocumented = [...exportedNames(file)].filter((name) => !documented(name)).sort();
  if (undocumented.length === 0) {
    console.log(`ok       ${specifier}`);
    continue;
  }
  missing += undocumented.length;
  console.log(`MISSING  ${specifier}: ${undocumented.join(", ")}`);
}

if (missing > 0) {
  console.error(
    `\n${missing} public export(s) are not mentioned in ${REFERENCE}.\n` +
      "Document them there, or stop exporting them from an entry point.",
  );
  process.exit(1);
}
console.log(`\nevery public export appears in ${REFERENCE}`);
