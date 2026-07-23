// Typechecks each example with its *own* toolchain.
//
// The examples are standalone apps with their own node_modules and their own
// pinned TypeScript, plus Vite ambient types for things like `import "./styles.css"`.
// Running the repo's tsc against them reports errors that don't exist for the example itself,
// so each one is spawned with its directory as the working directory.
//
// They are worth checking at all because the root tsconfig sets
// `include: ["src"]`: an API change can break every example without
// `yarn typecheck` noticing.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const examplesDir = join(root, "examples");

const examples = readdirSync(examplesDir, { withFileTypes: true })
  .filter(
    (entry) => entry.isDirectory() && existsSync(join(examplesDir, entry.name, "tsconfig.json")),
  )
  .map((entry) => entry.name);

let failed = 0;
for (const name of examples) {
  const cwd = join(examplesDir, name);
  process.stdout.write(`typecheck ${name}... `);
  const result = spawnSync("npx", ["tsc", "--noEmit", "-p", "tsconfig.json"], {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  if (result.status === 0) {
    console.log("ok");
  } else {
    failed++;
    console.log("FAILED");
    process.stdout.write(`${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} example(s) failed to typecheck.`);
  process.exit(1);
}
