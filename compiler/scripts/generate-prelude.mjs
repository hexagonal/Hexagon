/**
 * Regenerates `src/prelude-sources.ts` from the canonical files in `stdlib/`.
 *
 * `compileProject` is filesystem-free, so each prelude module's text has to be
 * embedded in the compiler as real TypeScript — the build is plain `tsc`, with
 * no bundler transform to inline it. Transcribing by hand was tolerable for
 * three short unions and is not for `Seq.hex`, so the embedding is generated and
 * the conformance drift guard checks the result.
 *
 * The list of members lives in `src/prelude.ts`; this script only supplies their
 * text. Regenerate with `npm run generate:prelude`.
 */

import { readFile, writeFile } from "node:fs/promises";

const BASENAMES = ["Prelude.hex", "Option.hex", "Result.hex"];

const destination = new URL("../src/prelude-sources.ts", import.meta.url);
const lines = [
  "/**",
  " * Embedded copies of the canonical `stdlib/` prelude sources. Do not edit by hand.",
  " * Regenerate with `npm run generate:prelude`; a conformance test asserts these",
  " * never drift from the originals.",
  " */",
  "",
  "export const PRELUDE_SOURCES: Readonly<Record<string, string>> = {",
];

for (const basename of BASENAMES) {
  const source = await readFile(new URL(`../../stdlib/${basename}`, import.meta.url), "utf8");
  lines.push(`  ${JSON.stringify(basename)}:`);
  const textLines = source.split("\n");
  // Keep one JS string literal per source line so diffs of this generated file
  // stay readable and reviewable rather than collapsing to one enormous line.
  const pieces = textLines.slice(0, -1).map((line) => `${JSON.stringify(`${line}\n`)}`);
  if (textLines[textLines.length - 1] !== "") pieces.push(JSON.stringify(textLines[textLines.length - 1]));
  lines.push(pieces.map((piece, index) => `    ${index === 0 ? "" : "+ "}${piece}`).join("\n") + ",");
}

lines.push("};", "");

await writeFile(destination, lines.join("\n"));
console.log(`wrote ${BASENAMES.length} prelude sources`);
