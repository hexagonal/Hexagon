import { describe, expect, test } from "vitest";

import {
  compileProject,
  emitTypeScriptPreview,
  Source,
  type CompiledProject,
} from "../index";
import { typeScriptErrors } from "../support/typescript-check.js";

/**
 * Conformance for FFI Part 1 §4.1's `Array(a)` row (issue #228): a borrowed
 * foreign JS array faces TypeScript as `ReadonlyArray<a>`. The emitter wrote
 * the mutable `Array<a>`, which handed a JavaScript consumer the mutation
 * surface Part 2 §6.1 and §13 say the value does not have.
 *
 * The spelling is the cheap half. What the row is *for* is what `tsc` does with
 * it, so the mutation refusals, the read access, and the widening below are run
 * through the real compiler rather than matched as substrings.
 *
 * `Node(a)` keeps its own mutable `Array<a>`, deliberately: that is the honest
 * shape of the hidden trie node, it reaches no shipped `.d.ts` (an export that
 * would expose it is a hard error), and `node.test.ts` owns it.
 */

function project(files: Readonly<Record<string, string>>): CompiledProject {
  const compiled = compileProject(
    Object.entries(files).map(([path, text], index) =>
      new Source.File(Source.fileId(index), path, text)
    ),
  );
  expect(compiled.diagnostics).toEqual([]);
  return compiled;
}

/** The one module of a single-file program at `/src/main.hex`. */
function module(source: string): CompiledProject["modules"][number] {
  const found = project({ "/src/main.hex": "module Main\n\n" + source }).modules
    .find(({ source: file }) => file.path === "/src/main.hex");
  if (found === undefined) throw new Error("no /src/main.hex in the compiled project");
  return found;
}

/** The generated `.d.ts` text of a one-module program. */
function declarations(source: string): string {
  return module(source).declarations.text;
}

/** The inspection-only preview text — the Playground's declarations pane. */
function preview(source: string): string {
  return emitTypeScriptPreview(module(source).core).text;
}

/** Every diagnostic of a single-module compile, as messages. */
function diagnose(source: string): readonly string[] {
  return compileProject([new Source.File(Source.fileId(0), "/src/main.hex", "module Main\n\n" + source)])
    .diagnostics.map(({ message }) => message);
}

/**
 * Issue #228's own program: an `Array(Int)` arriving through an extern, then
 * standing in the two positions a shipped `.d.ts` has — `declare const`, and a
 * function's parameter and result. `pass` adds the binder position.
 */
const BORROWED = 'extern from "./rows.js"\n' +
  "    fun rows(): Array(Int)\n" +
  "\n" +
  "export let first: Array(Int) = rows!()\n" +
  "export let head(xs: Array(Int)): Array(Int) = xs\n" +
  "export fun pass(xs: Array(a)): Array(a) = xs\n";

/** The emitted `.d.ts` of `BORROWED`, plus whatever consumer files a test adds. */
function emittedFiles(
  extra: Readonly<Record<string, string>> = {},
): Readonly<Record<string, string>> {
  return { "main.d.ts": declarations(BORROWED), ...extra };
}

describe("the face is `ReadonlyArray<a>` in every position", () => {
  test("an extern-returned value: the `declare const` position", () => {
    expect(declarations(BORROWED)).toContain(
      "export declare const first: ReadonlyArray<number>;",
    );
  });

  test("parameter and result positions both take it", () => {
    expect(declarations(BORROWED)).toContain(
      "export declare const head: (xs: ReadonlyArray<number>) => ReadonlyArray<number>;",
    );
  });

  test("a generic function's binder survives beside the face", () => {
    expect(declarations(BORROWED)).toContain(
      "export declare function pass<a>(xs: ReadonlyArray<a>): ReadonlyArray<a>;",
    );
  });

  test("nesting renders both layers", () => {
    expect(
      declarations(
        'extern from "./rows.js"\n' +
          "    fun grid(): Array(Array(Int))\n" +
          "\n" +
          "export let cells: Array(Array(Int)) = grid!()\n",
      ),
    ).toContain("export declare const cells: ReadonlyArray<ReadonlyArray<number>>;");
  });

  // The mutable spelling must be gone, not merely outnumbered: `ReadonlyArray<`
  // contains `Array<`, so the check has to exclude that prefix explicitly.
  test("no mutable `Array<` survives anywhere in the declarations", () => {
    expect(declarations(BORROWED)).not.toMatch(/(?<!Readonly)Array</);
  });

  // Modules §5.5: `Array` is a fallback consulted after declarations, so a user
  // record of that name is an ordinary nominal type and this row never reaches
  // it. Its face is its own name — mutable-looking, and correctly so.
  test("a user `record Array(a)` occludes the intrinsic and keeps its own face", () => {
    const text = declarations(
      "export record Array(a) = { item: a }\n" +
        "export fun wrap(item: Int): Array(Int) = Array({ item = item })\n",
    );
    expect(text).toContain("export type Array<a> = { item: a };");
    expect(text).toContain("export declare function wrap(item: number): Array<number>;");
    expect(text).not.toContain("ReadonlyArray");
  });
});

describe("the mutation surface is gone, by `tsc`", () => {
  test("the emitted declarations compile on their own", async () => {
    expect(await typeScriptErrors(emittedFiles())).toEqual([]);
  });

  // The three writes issue #228 names. The codes are what this `tsc` actually
  // emitted: TypeScript refuses the two methods by absence and the index
  // assignment by the readonly index signature, which are different errors.
  test("`push`, index assignment, and `sort` are all refused", async () => {
    const errors = await typeScriptErrors(emittedFiles({
      "consumer.ts": 'import { first } from "./main.js";\n' +
        "first.push(4);\n" +
        "first[0] = 9;\n" +
        "first.sort();\n",
    }));
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain("error TS2339");
    expect(errors[0]).toContain("push");
    expect(errors[1]).toContain("error TS2542");
    expect(errors[2]).toContain("error TS2339");
    expect(errors[2]).toContain("sort");
  });

  // The other half of the row: readonly is not useless. Everything a borrowed
  // view legitimately offers — indexing, length, iteration, copying out — still
  // typechecks, so the face narrows the surface without closing the door.
  test("read access, iteration, and copying out all compile clean", async () => {
    expect(
      await typeScriptErrors(emittedFiles({
        "consumer.ts": 'import { first, head } from "./main.js";\n' +
          "export const one: number | undefined = first[0];\n" +
          "export const size: number = first.length;\n" +
          "export function total(): number {\n" +
          "  let sum = 0;\n" +
          "  for (const n of head(first)) sum += n;\n" +
          "  return sum;\n" +
          "}\n" +
          "export const copy: number[] = Array.from(first);\n",
      })),
    ).toEqual([]);
  });
});

describe("the covariance hole is closed at the immutable spelling", () => {
  // FFI Part 7 §14.1's third row. The `never` instantiation is reached through
  // the emitted generic face rather than through an exported `Array(a)`-typed
  // *value*: no such value can be written, which the next test verifies rather
  // than assumes. Widening is accepted — and, unlike the mutable spelling, is
  // sound, because the widened value has nothing to write through.
  test("`ReadonlyArray<never>` widens to `ReadonlyArray<number>`, and stays unwritable", async () => {
    const errors = await typeScriptErrors(emittedFiles({
      "consumer.ts": 'import { pass } from "./main.js";\n' +
        "export const ns: ReadonlyArray<number> = pass<never>([]);\n" +
        "ns.push(1);\n",
    }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("error TS2339");
    expect(errors[0]).toContain("push");
  });

  test("no `Array(a)`-typed value can be exported: generic externs are not in v1", () => {
    expect(
      diagnose('extern from "./rows.js"\n    fun none(): Array(a)\n'),
    ).toContain("generic extern declarations are not part of Hexagon v1");
  });
});

describe("nothing but declaration text changes", () => {
  test("the emitted JavaScript is the same program, and names no face", () => {
    const javascript = module(BORROWED).javascript.text;
    expect(javascript).toBe(
      'import { rows } from "./rows.js";\n' +
        "const first = rows();\n" +
        "const head = xs => xs;\n" +
        "function pass(xs) {\n" +
        "  return xs;\n" +
        "}\n" +
        "export { first };\n" +
        "export { head };\n" +
        "export { pass };\n",
    );
    expect(javascript).not.toContain("ReadonlyArray");
  });
});

describe("the inspection preview renders the same face", () => {
  test("the Playground's declarations pane shows `ReadonlyArray<number>`", () => {
    const text = preview(BORROWED);
    expect(text).toContain("declare function rows(): ReadonlyArray<number>;");
    expect(text).toContain("export declare const first: ReadonlyArray<number>;");
    expect(text).not.toMatch(/(?<!Readonly)Array</);
  });
});
