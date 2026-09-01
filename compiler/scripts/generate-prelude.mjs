/**
 * Regenerates the compiler's embedded copies of the canonical `.hex` sources it
 * injects into every project: `src/prelude-sources.ts` from `stdlib/`, and
 * `src/runtime-sources.ts` from `runtime/`.
 *
 * `compileProject` is filesystem-free, so each injected module's text has to be
 * embedded in the compiler as real TypeScript — the build is plain `tsc`, with
 * no bundler transform to inline it. Transcribing by hand was tolerable for
 * three short unions and is not for `Seq.hex` or `VectorTrie.hex`, so the
 * embedding is generated and the conformance drift guard checks the result.
 *
 * The member lists live in `src/prelude.ts` and `src/runtime-modules.ts`; this
 * script only supplies their text. Regenerate with `npm run generate:prelude`.
 */

import { readFile, writeFile } from "node:fs/promises";

const EMBEDDINGS = [
  {
    directory: "stdlib",
    destination: "prelude-sources.ts",
    binding: "PRELUDE_SOURCES",
    what: "prelude",
    basenames: [
      "Show.hex",
      "Num.hex",
      "Signed.hex",
      "Frac.hex",
      "Pow.hex",
      "Concat.hex",
      "Bool.hex",
      "Eq.hex",
      "Hash.hex",
      "Prelude.hex",
      "Ord.hex",
      "Integral.hex",
      "Option.hex",
      "BigInt.hex",
      "Int.hex",
      "Nat.hex",
      "Float.hex",
      "Seq.hex",
      "String.hex",
      "Iterable.hex",
      "Result.hex",
      "Vector.hex",
      "Map.hex",
      "Set.hex",
      "Stream.hex",
      "Array.hex",
      "JsKind.hex",
      "JsPathSegment.hex",
      "JsConversionReason.hex",
      "JsValue.hex",
      "Debug.hex",
    ],
  },
  {
    directory: "runtime",
    destination: "runtime-sources.ts",
    binding: "RUNTIME_SOURCES",
    what: "runtime",
    basenames: ["VectorTrie.hex", "HashTrie.hex"],
  },
];

for (const { directory, destination, binding, what, basenames } of EMBEDDINGS) {
  const lines = [
    "/**",
    ` * Embedded copies of the canonical \`${directory}/\` ${what} sources. Do not edit by hand.`,
    " * Regenerate with `npm run generate:prelude`; a conformance test asserts these",
    " * never drift from the originals.",
    " */",
    "",
    `export const ${binding}: Readonly<Record<string, string>> = {`,
  ];

  for (const basename of basenames) {
    const source = await readFile(new URL(`../../${directory}/${basename}`, import.meta.url), "utf8");
    lines.push(`  ${JSON.stringify(basename)}:`);
    const textLines = source.split("\n");
    // Keep one JS string literal per source line so diffs of this generated file
    // stay readable and reviewable rather than collapsing to one enormous line.
    const pieces = textLines.slice(0, -1).map((line) => `${JSON.stringify(`${line}\n`)}`);
    if (textLines[textLines.length - 1] !== "") pieces.push(JSON.stringify(textLines[textLines.length - 1]));
    lines.push(pieces.map((piece, index) => `    ${index === 0 ? "" : "+ "}${piece}`).join("\n") + ",");
  }

  lines.push("};", "");

  await writeFile(new URL(`../src/${destination}`, import.meta.url), lines.join("\n"));
  console.log(`wrote ${basenames.length} ${what} source${basenames.length === 1 ? "" : "s"}`);
}
