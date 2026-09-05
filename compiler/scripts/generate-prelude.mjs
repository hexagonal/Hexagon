/**
 * Regenerates the compiler's embedded copy of the standard library:
 * `src/stdlib-sources.ts` from every `.hex` file under `stdlib/`.
 *
 * The standard library is the package `Hex` **in full** — the prelude members
 * in bare scope (Modules §5.5), the runtime modules the emitted program runs
 * on, and the rest reachable by `import Rat` / `import Hex.Rat` (Packages §2.4,
 * §3.2). All three are embedded here, because `compileProject` is
 * filesystem-free and each module's text has to be real TypeScript: the build
 * is plain `tsc`, with no bundler transform to inline it. Transcribing by hand
 * was tolerable for three short unions and is not for `Seq.hex` or
 * `Runtime/VectorTrie.hex`, so the embedding is generated and the conformance
 * drift guard checks the result.
 *
 * The **keys are declared module names**, not file names: `Rat`,
 * `Runtime.VectorTrie`. A module's identity is the name its header declares
 * (Modules §1) and the directory under `stdlib/` is our filing convention
 * (§9.2), so the one place the two could disagree is checked here rather than
 * left for the compiler to trip over.
 *
 * Which list a module belongs to lives in `src/prelude.ts` (the ordered prelude
 * set, and the rest of `Hex` derived from it) and `src/runtime-modules.ts`;
 * this script only supplies their text. Regenerate with
 * `npm run generate:prelude`.
 */

import { readdir, readFile, writeFile } from "node:fs/promises";

const STDLIB = new URL("../../stdlib/", import.meta.url);

/** Every `.hex` file under `stdlib/`, as `[declared name, repository path]`. */
async function modules(directory = "", prefix = "") {
  const entries = await readdir(new URL(directory, STDLIB), { withFileTypes: true });
  const found = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isDirectory()) {
      found.push(...await modules(`${directory}${entry.name}/`, `${prefix}${entry.name}.`));
      continue;
    }
    if (!entry.name.endsWith(".hex")) continue;
    found.push({
      name: `${prefix}${entry.name.slice(0, -".hex".length)}`,
      path: `${directory}${entry.name}`,
    });
  }
  return found;
}

const found = await modules();

const lines = [
  "/**",
  " * Embedded copies of the canonical `stdlib/` sources, keyed by **declared",
  " * module name** (Modules §1). Do not edit by hand.",
  " * Regenerate with `npm run generate:prelude`; a conformance test asserts these",
  " * never drift from the originals.",
  " */",
  "",
  "export const STDLIB_SOURCES: Readonly<Record<string, string>> = {",
];

for (const { name, path } of found) {
  const source = await readFile(new URL(path, STDLIB), "utf8");
  const declared = /^module\s+([^\s]+)/u.exec(source)?.[1];
  if (declared !== name) {
    throw new Error(
      `stdlib/${path} declares \`module ${declared}\`; its place under stdlib/ says \`${name}\``,
    );
  }
  lines.push(`  ${JSON.stringify(name)}:`);
  const textLines = source.split("\n");
  // Keep one JS string literal per source line so diffs of this generated file
  // stay readable and reviewable rather than collapsing to one enormous line.
  const pieces = textLines.slice(0, -1).map((line) => `${JSON.stringify(`${line}\n`)}`);
  if (textLines[textLines.length - 1] !== "") pieces.push(JSON.stringify(textLines[textLines.length - 1]));
  lines.push(pieces.map((piece, index) => `    ${index === 0 ? "" : "+ "}${piece}`).join("\n") + ",");
}

lines.push("};", "");

await writeFile(new URL("../src/stdlib-sources.ts", import.meta.url), lines.join("\n"));
console.log(`wrote ${found.length} standard-library sources`);
