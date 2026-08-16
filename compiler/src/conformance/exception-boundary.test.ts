import { describe, expect, test } from "vitest";

import { moduleBrandIdentity } from "../project.js";
import { compileFiles, projectDiagnostics, runProject } from "../support/test-project.js";
import { typeScriptErrors } from "../support/typescript-check.js";

/**
 * Conformance for the **exception boundary**: the three rulings that finish the
 * exceptions arc's compiler work, and that only make sense read together.
 *
 * - **#488, the brand carries the declaring module** (Exceptions §7.1). `$hex`
 *   stops being the sentinel `true` and becomes the declaring module's identity
 *   — its project-root-relative path, or its canonical injected name for a
 *   prelude member. Discrimination is then the (module, name) pair (§7.4), and
 *   two modules declaring one exception name stop sharing a representation.
 * - **#478, boundary guards** (Exceptions §7.6, FFI Part 7 §6). Every exported
 *   exception constructor carries `is`, and a module exporting one publishes
 *   `isHexError`; both are manufactured for the JS consumer, and neither exists
 *   on the Hexagon side.
 * - **#479, the throws manifest** (Doc Comments §6.1, §7.4). The recognized
 *   sentence ``Throws `X` when …`` in doc content derives an `@throws` tag in
 *   the JSDoc block of an exported declaration, in both artifacts.
 *
 * The pieces interlock at the brand: a guard's body, a catch arm's test, and a
 * `.d.ts` face all spell the same literal, so a defect in one is a defect the
 * others have to agree with.
 */

function javascriptOf(
  files: readonly (readonly [string, string])[],
  path: string,
): string {
  const project = compileFiles(files);
  expect(project.diagnostics).toEqual([]);
  return project.modules.find(({ source }) => source.path === path)!.javascript.text;
}

function declarationsOf(
  files: readonly (readonly [string, string])[],
  path: string,
): string {
  const project = compileFiles(files);
  expect(project.diagnostics).toEqual([]);
  return project.modules.find(({ source }) => source.path === path)!.declarations.text;
}

describe("the brand is the declaring module's path identity (#488, §7.1)", () => {
  test("a root-level module brands its name; a nested one brands its path", () => {
    const files = [
      ["/errors.hex", "export exception Boom(code: Int)\n"],
      ["/client/failures.hex", "export exception Splat(code: Int)\n"],
      ["/main.hex",
        "import { Boom } from \"./errors\"\n" +
        "import { Splat } from \"./client/failures\"\n" +
        "export fun a(): Int =\n" +
        "    try\n" +
        "        throw(Boom(1))\n" +
        "    catch\n" +
        "        Boom(c) => c\n" +
        "export fun b(): Int =\n" +
        "    try\n" +
        "        throw(Splat(2))\n" +
        "    catch\n" +
        "        Splat(c) => c\n"],
    ] as const;

    // Forward slashes, no leading slash, `.hex` dropped — Modules §2's "a
    // module's identity is its path", rendered.
    expect(javascriptOf(files, "/errors.hex")).toContain('{ $hex: "errors", name: __name }');
    expect(javascriptOf(files, "/client/failures.hex"))
      .toContain('{ $hex: "client/failures", name: __name }');
  });

  test("the identity is relative to the project root, not absolute", () => {
    // Every file under `/src`, so the root is `/src` and nothing in the brand
    // records where the host unpacked the program.
    const files = [
      ["/src/client/failures.hex", "export exception Splat(code: Int)\n"],
      ["/src/main.hex",
        "import { Splat } from \"./client/failures\"\n" +
        "export fun b(): Int =\n" +
        "    try\n" +
        "        throw(Splat(2))\n" +
        "    catch\n" +
        "        Splat(c) => c\n"],
    ] as const;

    expect(javascriptOf(files, "/src/client/failures.hex"))
      .toContain('{ $hex: "client/failures", name: __name }');
  });

  test("an injected prelude module brands its canonical injected name", () => {
    // `stdlib/Vector.hex` is the prelude's `Vector` wherever its file sits, so
    // its brand is the injected name and not the path the injection took. The
    // arm below is written in `/src/main.hex` and still tests `"Vector"`.
    const files = [
      ["/src/main.hex",
        "export fun guarded(v: Vector(Int)): Int =\n" +
        "    try\n" +
        "        v.at(9)\n" +
        "    catch\n" +
        "        Vector.IndexError(index, size) => index + size\n"],
    ] as const;

    expect(javascriptOf(files, "/src/main.hex")).toContain('$hex === "Vector"');
  });

  test("a helper that raises a prelude exception brands the declaring module", async () => {
    // The bounds check is inlined into the *consumer*, and the exception is
    // still `Vector`'s. Branding the emitting module here would put every
    // `Vector.IndexError` arm in the program permanently past it.
    const files = [["/deep/reader.hex",
      "let values: Vector(Int) = [10, 20]\n" +
      "export let boom: Int = values[9]\n"]] as const;

    expect(javascriptOf(files, "/deep/reader.hex")).toContain('__error.$hex = "Vector"');
    await expect(runProject(files, { entry: "/deep/reader.hex" })).rejects.toThrowError(
      expect.objectContaining({ name: "IndexError", $hex: "Vector" }),
    );
  });

  test("the `.d.ts` face publishes the brand as the literal a JS caller copies", () => {
    const files = [
      ["/client/failures.hex", "export exception Splat(code: Int)\n"],
      ["/main.hex",
        "import { Splat } from \"./client/failures\"\n" +
        "export fun b(): Int =\n" +
        "    try\n" +
        "        throw(Splat(2))\n" +
        "    catch\n" +
        "        Splat(c) => c\n"],
    ] as const;

    expect(declarationsOf(files, "/client/failures.hex")).toContain(
      'export type Splat = Error & { readonly $hex: "client/failures"; ' +
        'readonly name: "Splat"; readonly code: number };',
    );
  });

  test("the rendering is canonical: a host separator never reaches the brand", () => {
    // The brand is compiled into emitted JavaScript and into a `.d.ts` literal a
    // consumer copies, so a separator that varied with the build machine would
    // be a real incompatibility. This suite cannot run on Windows, so the
    // rendering is exercised directly with the input that platform produces.
    expect(moduleBrandIdentity("C:\\app\\client\\errors.hex", "C:\\app", false))
      .toBe("client/errors");
    expect(moduleBrandIdentity("C:\\app\\Vector.hex", "C:\\app", true)).toBe("Vector");
    // And the POSIX rendering of the same project is the same string, which is
    // the whole claim.
    expect(moduleBrandIdentity("/app/client/errors.hex", "/app", false))
      .toBe("client/errors");
  });

  test("no brand ascends out of the project root", () => {
    // `root` is `commonRoot`, a prefix of every source path in the program, so
    // the relativization is a plain suffix with no ascent to express. Pinned so
    // it stays true: a `../`-prefixed brand would be neither unique nor a name
    // a JS consumer could copy, and the non-prefix branch below is defensive
    // only — reached by no compilation.
    for (
      const [path, root] of [
        ["/app/src/errors.hex", "/app/src"],
        ["/errors.hex", ""],
        ["/other/errors.hex", "/app"],
        ["errors.hex", "/app"],
      ] as const
    ) {
      const identity = moduleBrandIdentity(path, root, false);
      expect(identity.startsWith("../")).toBe(false);
      expect(identity.startsWith("/")).toBe(false);
    }
  });

  test("stage 1 is a class test: `Exn` faces any string brand", () => {
    // §7.5's `Exn` position. The brand is data now, so the face that admits
    // *any* Hexagon exception says `string` — the shape `isHexError` narrows to.
    const files = [
      ["/main.hex",
        "export exception Boom(code: Int)\n" +
        "export fun rethrow(e: Exn): Exn = e\n"],
    ] as const;

    expect(declarationsOf(files, "/main.hex")).toContain(
      "readonly $hex: string; readonly name: string",
    );
  });
});

describe("boundary guards (#478, §7.6)", () => {
  const guarded = [
    ["/errors.hex",
      "export exception ParseError(line: Int, message: String)\n" +
      "export exception NotFound\n" +
      "exception Hidden(code: Int)\n" +
      "export fun conceal(code: Int): Int =\n" +
      "    try\n" +
      "        throw(Hidden(code))\n" +
      "    catch\n" +
      "        Hidden(c) => c\n"],
    ["/other.hex", "export exception ParseError(line: Int, message: String)\n"],
    ["/main.hex", "export let seed: Int = 1\n"],
  ] as const;

  test("every exported constructor gains `is`, the nullary one included", () => {
    const javascript = javascriptOf(guarded, "/errors.hex");

    expect(javascript).toContain(
      'ParseError.is = (__error) => __error != null && __error.$hex === "errors"' +
        ' && __error.name === "ParseError";',
    );
    expect(javascript).toContain(
      'NotFound.is = (__error) => __error != null && __error.$hex === "errors"' +
        ' && __error.name === "NotFound";',
    );
  });

  test("an unexported exception gains none — the guard is a boundary artifact", () => {
    expect(javascriptOf(guarded, "/errors.hex")).not.toContain("Hidden.is");
  });

  test("a module exporting an exception exports `isHexError`, once", () => {
    const javascript = javascriptOf(guarded, "/errors.hex");

    expect(javascript).toContain(
      "export const isHexError = (__error) => __error != null " +
        '&& typeof __error.$hex === "string";',
    );
    expect(javascript.match(/isHexError/gu)).toHaveLength(1);
  });

  test("a module with no exported exception exports no guard", () => {
    // `Hidden` is private, so nothing of this module's crosses as an exception
    // and the stage-1 question has no consumer here.
    const javascript = javascriptOf([
      ["/quiet.hex",
        "exception Hidden(code: Int)\n" +
        "export fun conceal(code: Int): Int =\n" +
        "    try\n" +
        "        throw(Hidden(code))\n" +
        "    catch\n" +
        "        Hidden(c) => c\n"],
      ["/main.hex", "export let seed: Int = 1\n"],
    ], "/quiet.hex");

    expect(javascript).not.toContain("isHexError");
  });

  test("the guards certify the (module, name) pair at run time", async () => {
    const exports = await runProject(guarded, { entry: "/errors.hex" });
    const is = (exports["ParseError"] as { is: (value: unknown) => boolean }).is;
    const notFound = (exports["NotFound"] as { is: (value: unknown) => boolean }).is;
    const isHexError = exports["isHexError"] as (value: unknown) => boolean;
    const parse = exports["ParseError"] as (line: number, message: string) => unknown;

    expect(is(parse(3, "bad"))).toBe(true);
    expect(notFound(parse(3, "bad"))).toBe(false);
    expect(isHexError(parse(3, "bad"))).toBe(true);

    // §7.1's spoofing tier, unchanged: a foreign `Error` wearing the name is
    // unbranded, so both stages refuse it — and so does `throw null`.
    expect(is(Object.assign(new Error("bad"), { name: "ParseError" }))).toBe(false);
    expect(isHexError(new Error("bad"))).toBe(false);
    expect(isHexError(null)).toBe(false);
    expect(isHexError("oops")).toBe(false);
  });

  test("another module's exception of the same name is not this one's", async () => {
    const exports = await runProject(guarded, { entry: "/errors.hex" });
    const foreign = await runProject(guarded, { entry: "/other.hex" });
    const theirs = (foreign["ParseError"] as (line: number, message: string) => unknown)(1, "x");

    expect((exports["ParseError"] as { is: (value: unknown) => boolean }).is(theirs)).toBe(false);
    // Domestic all the same: it is a Hexagon exception, just not this one.
    expect((exports["isHexError"] as (value: unknown) => boolean)(theirs)).toBe(true);
  });

  test("the `.d.ts` merges a namespace onto the constructor function", () => {
    const declarations = declarationsOf(guarded, "/errors.hex");

    expect(declarations).toContain(
      "export declare function ParseError(line: number, message: string): ParseError;\n" +
        "export declare namespace ParseError {\n" +
        "  function is(__error: unknown): __error is ParseError;\n" +
        "}",
    );
    expect(declarations).toContain(
      "export declare function NotFound(): NotFound;\n" +
        "export declare namespace NotFound {\n" +
        "  function is(__error: unknown): __error is NotFound;\n" +
        "}",
    );
    expect(declarations).toContain(
      "export declare function isHexError(__error: unknown): __error is Error & " +
        "{ readonly $hex: string; readonly name: string };",
    );
    expect(declarations).not.toContain("Hidden");
  });

  test("a TypeScript consumer narrows through both guards", async () => {
    // The whole point of the namespace merge: `.is` is a type predicate, so the
    // branch below reaches `line` without a cast, and `isHexError`'s negation
    // is the foreign branch.
    expect(await typeScriptErrors({
      "errors.d.ts": declarationsOf(guarded, "/errors.hex"),
      "consumer.ts": [
        'import { ParseError, isHexError } from "./errors.js";',
        "export function describe(thrown: unknown): string {",
        "  if (ParseError.is(thrown)) return `line ${thrown.line}: ${thrown.message}`;",
        "  if (isHexError(thrown)) return thrown.name;",
        '  return "foreign";',
        "}",
      ].join("\n"),
    })).toEqual([]);
  });

  test("`isHexError` colliding with an explicit export is a hard error", () => {
    // FFI Part 7 §11's one owned error: the guard is a fixed public face, so it
    // cannot be moved aside by a probe and the source's name cannot be moved
    // aside silently. Both sites are named; the fix is a source rename.
    expect(projectDiagnostics(
      "export exception Boom(code: Int)\n" +
      "export fun isHexError(value: Int): Bool = value > 0\n",
    )).toEqual([
      "generated guard `isHexError` conflicts with exported `isHexError`; rename the export",
    ]);
  });

  test("and so is one with a private binding of the name", () => {
    // The same collision in the emitted module, which has one name space: two
    // `isHexError` declarations is not a program. The family's other wording.
    expect(projectDiagnostics(
      "export exception Boom(code: Int)\n" +
      "let isHexError = 1\n" +
      "export let seed: Int = isHexError\n",
    )).toEqual([
      "generated guard `isHexError` conflicts with binding `isHexError`; rename the declaration",
    ]);
  });

  test("and so is one with an import that binds the name", () => {
    // An import binds a module-level name in the emitted JavaScript exactly as a
    // declaration does. Without this the module compiled clean and emitted both
    // the import line and `export const isHexError = …` — a duplicate
    // declaration, and a `SyntaxError` before a line of it ran.
    expect(compileFiles([
      ["/lib.hex", "export let isHexError: Int = 1\n"],
      ["/main.hex",
        "import { isHexError } from \"./lib\"\n" +
        "export exception Boom(code: Int)\n" +
        "export let seed: Int = isHexError\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      "generated guard `isHexError` conflicts with binding `isHexError`; rename the declaration",
    ]);
  });

  test("an aliased import is the same collision — the alias is the binding", () => {
    // The spelling the source chose, not the one the exporter published. An
    // alias can name anything, so the rule reads locals and never imported
    // names.
    expect(compileFiles([
      ["/lib.hex", "export let seed: Int = 1\n"],
      ["/main.hex",
        "import { seed as isHexError } from \"./lib\"\n" +
        "export exception Boom(code: Int)\n" +
        "export let value: Int = isHexError\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      "generated guard `isHexError` conflicts with binding `isHexError`; rename the declaration",
    ]);
  });

  test("an importing module that exports no exception is untouched", () => {
    expect(compileFiles([
      ["/lib.hex", "export let seed: Int = 1\n"],
      ["/main.hex",
        "import { seed as isHexError } from \"./lib\"\n" +
        "export let value: Int = isHexError\n"],
    ]).diagnostics).toEqual([]);
  });

  test("a module exporting no exception may bind the name freely", () => {
    expect(projectDiagnostics(
      "export fun isHexError(value: Int): Bool = value > 0\n",
    )).toEqual([]);
  });
});

describe("the throws manifest (#479, Doc Comments §6.1/§7.4)", () => {
  const derived = (source: string): string =>
    declarationsOf([["/main.hex", source]], "/main.hex");

  // Doc Comments §11's manifest block, snippet for snippet.
  test("a recognized sentence rides verbatim and derives its tag", () => {
    const source =
      "(** Parses. Throws `ParseError` when the input is malformed. *)\n" +
      "export exception ParseError(line: Int)\n" +
      "(** Parses. Throws `ParseError` when the input is malformed. *)\n" +
      "export fun parse(text: String): Int = throw(ParseError(1))\n";
    const files = [["/main.hex", source]] as const;

    for (const artifact of [javascriptOf(files, "/main.hex"), declarationsOf(files, "/main.hex")]) {
      expect(artifact).toContain("Parses. Throws `ParseError` when the input is malformed.");
      expect(artifact).toContain("@throws {ParseError} when the input is malformed");
    }
  });

  test("a manifest head inside the condition refuses the sentence entirely", () => {
    // Not one mangled tag: none. One sentence per exception is the grammar.
    const declarations = derived(
      "(** Throws `ParseError` when a, and `IndexError` when b. *)\n" +
      "export fun bad(text: String): Int = 0\n",
    );

    expect(declarations).toContain("Throws `ParseError` when a, and `IndexError` when b.");
    expect(declarations).not.toContain("@throws");
  });

  test("a lowercase name is ordinary prose", () => {
    const declarations = derived(
      "(** Throws `parseError` when lowercase. *)\n" +
      "export fun odd(text: String): Int = 0\n",
    );

    expect(declarations).toContain("Throws `parseError` when lowercase.");
    expect(declarations).not.toContain("@throws");
  });

  test("an unexported declaration keeps the sentence and derives nothing", () => {
    // §7.4's ground: the tag is consumer-boundary documentation, and the `.js`
    // binding of an unexported term is not a consumer surface.
    const javascript = javascriptOf([
      ["/main.hex",
        "(** Throws `ParseError` when the input is malformed. *)\n" +
        "fun helper(text: String): Int = 0\n" +
        "export let seed: Int = helper(\"\")\n"],
    ], "/main.hex");

    expect(javascript).toContain("Throws `ParseError` when the input is malformed.");
    expect(javascript).not.toContain("@throws");
  });

  test("a dotted name inside the condition is not the sentence's period", () => {
    // The sentence ends at *its* period, and a dot inside an inline code span is
    // not one. Stopping at the first dot emitted `@throws {IndexError} when
    // `Vector` — a tag truncated mid-span, with a dangling backtick in it.
    const declarations = derived(
      "(** Reads. Throws `IndexError` when `Vector.at` receives an index out of range. *)\n" +
      "export fun read(index: Int): Int = index\n",
    );

    expect(declarations).toContain(
      "@throws {IndexError} when `Vector.at` receives an index out of range\n",
    );
    expect(declarations).not.toContain("when `Vector\n");
  });

  test("a decimal in plain prose is not the sentence's period", () => {
    // The period is a dot *followed by whitespace or the end of the content*;
    // anything else after it is interior. Without that edge the decimal ended
    // the sentence and the tag read "when the timeout exceeds 1".
    const declarations = derived(
      "(** Waits. Throws `IndexError` when the timeout exceeds 1.5 seconds. *)\n" +
      "export fun wait(index: Int): Int = index\n",
    );

    expect(declarations).toContain(
      "@throws {IndexError} when the timeout exceeds 1.5 seconds\n",
    );
    expect(declarations).not.toContain("when the timeout exceeds 1\n");
  });

  test("a dotted name written as prose is not the sentence's period either", () => {
    // Same rule, no code span to lean on: what disqualifies the interior dot is
    // the letter after it, not the span the pin above happens to sit inside.
    const declarations = derived(
      "(** Reads. Throws `IndexError` when Vector.at receives a bad index. *)\n" +
      "export fun read(index: Int): Int = index\n",
    );

    expect(declarations).toContain(
      "@throws {IndexError} when Vector.at receives a bad index\n",
    );
    expect(declarations).not.toContain("when Vector\n");
  });

  test("a decimal sentence with no period at all fires nothing", () => {
    // The conservative direction, and the companion to the pin above: the dot
    // that used to terminate here is interior now, and no qualifying dot
    // follows it before the paragraph ends — which here is the end of the
    // content — so the answer is no tag rather than the truncated one this once
    // derived. That is the whole of the rule: a missing period fires nothing
    // when nothing else in the *paragraph* qualifies, and otherwise reads on to
    // the next dot that does (the two pins below hold both halves).
    const declarations = derived(
      "(** Waits. Throws `IndexError` when the timeout exceeds 1.5 seconds *)\n" +
      "export fun wait(index: Int): Int = index\n",
    );

    expect(declarations).toContain("when the timeout exceeds 1.5 seconds");
    expect(declarations).not.toContain("@throws");
  });

  test("a sentence never crosses a blank line, so a paragraph break fires nothing", () => {
    // The bound that keeps the deviation local. Without it the missing period
    // annexed the paragraphs after it and derived a tag out of prose that was
    // never the manifest — the next paragraph's own sentence supplying the
    // terminator.
    const declarations = derived(
      "(** Throws `IndexError` when the timeout exceeds 1.5 seconds\n" +
      "\n" +
      "    See the manual for details. More. *)\n" +
      "export fun wait(index: Int): Int = index\n",
    );

    expect(declarations).not.toContain("@throws");
    expect(declarations).not.toContain(
      "@throws {IndexError} when the timeout exceeds 1.5 seconds See the manual for details",
    );
  });

  test("within one paragraph, a missing period reads on to the next qualifying dot", () => {
    // The honest other half: a line break is not a paragraph break, so the
    // sentence runs over the wrap and ends at the first dot that qualifies. The
    // condition is longer than the author's own sentence — which is what makes
    // the blank-line bound above matter, and is as far as the deviation reaches.
    const declarations = derived(
      "(** Throws `IndexError` when the timeout exceeds 1.5 seconds\n" +
      "    See the manual for details. More. *)\n" +
      "export fun wait(index: Int): Int = index\n",
    );

    expect(declarations).toContain(
      "@throws {IndexError} when the timeout exceeds 1.5 seconds See the manual for details\n",
    );
    expect(declarations).not.toContain(
      "@throws {IndexError} when the timeout exceeds 1.5 seconds\n",
    );
  });

  test("a closing mark after the dot does not unseat the period", () => {
    // Emphasis is house prose, not a deviation: the whitespace the period needs
    // may arrive across the closing `**`, and the marks ride outside the
    // condition. Reading the dot as interior lost the tag in silence — the
    // sentence emitted exactly as written, and only the `.d.ts` was poorer.
    const declarations = derived(
      "(** **Throws `IndexError` when the index is bad.** The caller must check first. *)\n" +
      "export fun read(index: Int): Int = index\n",
    );

    expect(declarations).toContain("@throws {IndexError} when the index is bad\n");
    expect(declarations).not.toContain("@throws {IndexError} when the index is bad.**");
  });

  test("two emphasized manifests in one block derive both tags", () => {
    // The silent loss doubled: a block documenting two exceptions in the
    // paragraph style lost both, and each half of the pin fails on its own.
    const declarations = derived(
      "(** **Throws `IndexError` when the index is out of range.**\n" +
      "\n" +
      "    **Throws `SliceError` when the window descends.** *)\n" +
      "export fun slice(index: Int): Int = index\n",
    );

    expect(declarations).toContain("@throws {IndexError} when the index is out of range\n");
    expect(declarations).toContain("@throws {SliceError} when the window descends\n");
  });

  test("a dot before a closing paren at the end of the content terminates", () => {
    // The closers are a run and may end the content themselves: what follows
    // the skipped marks is nothing at all, which is the other half of the
    // whitespace condition.
    const declarations = derived(
      "(** Reads. (Throws `IndexError` when the index is bad.) *)\n" +
      "export fun read(index: Int): Int = index\n",
    );

    expect(declarations).toContain("@throws {IndexError} when the index is bad\n");
    expect(declarations).not.toContain("@throws {IndexError} when the index is bad.)");
  });

  test("a run of dots is never the period, closing marks or no", () => {
    // The two rules compose in the order that matters: the run disqualifies its
    // last dot before the closer skip could rescue it, so `...)` is interior and
    // the sentence still ends at the later qualifying dot.
    const declarations = derived(
      "(** Throws `IndexError` when the index is bad (bad...) and more. Done. *)\n" +
      "export fun read(index: Int): Int = index\n",
    );

    expect(declarations).toContain(
      "@throws {IndexError} when the index is bad (bad...) and more\n",
    );
    expect(declarations).not.toContain("@throws {IndexError} when the index is bad..\n");
  });

  test("a run of dots is never the sentence's period", () => {
    // An ellipsis is interior, so the sentence ends at the *later* qualifying
    // dot. The run's last dot has whitespace after it and would otherwise
    // qualify on its own, carrying the leading two into the tag as `bad..` —
    // a malformed tag line in the shipped `.d.ts`.
    const declarations = derived(
      "(** Throws `IndexError` when the index is bad... and more. Done. *)\n" +
      "export fun read(index: Int): Int = index\n",
    );

    expect(declarations).toContain(
      "@throws {IndexError} when the index is bad... and more\n",
    );
    expect(declarations).not.toContain("bad..\n");
  });

  test("an exotic spacing character after the dot does not end the sentence", () => {
    // Whitespace is the closed set the source language admits (Lexer §2.2): a
    // space, a tab, a line ending. A non-breaking space is none of them, so the
    // dot before it is interior and nothing fires — where `\s` would have
    // matched it and derived a tag off a separator no reader can see.
    // Spelled as an escape here because the hazard is exactly that it looks
    // like a space in the source it came from.
    const nbsp = "\u{00A0}";
    const declarations = derived(
      `(** Throws \`IndexError\` when the index is bad.${nbsp}And more *)\n` +
      "export fun read(index: Int): Int = index\n",
    );

    expect(declarations).toContain(`when the index is bad.${nbsp}And more`);
    expect(declarations).not.toContain("@throws");
  });

  test("a nested manifest head past an interior dot still refuses", () => {
    // The truncation was not only cosmetic: the refusal was run over the
    // shortened span, so an early dot carried a second head past the check.
    const declarations = derived(
      "(** Throws `IndexError` when `Vector.at` is bad, and `SliceError` when the window descends. *)\n" +
      "export fun read(index: Int): Int = index\n",
    );

    expect(declarations).toContain("Throws `IndexError` when `Vector.at` is bad");
    expect(declarations).not.toContain("@throws");
  });

  test("an unbalanced inline code span is ordinary prose", () => {
    // The deriver never guesses: backticks that do not pair leave the sentence
    // with no terminator this rule can trust, so no tag is derived at all.
    const declarations = derived(
      "(** Throws `IndexError` when `index is out of range. *)\n" +
      "export fun read(index: Int): Int = index\n",
    );

    expect(declarations).toContain("Throws `IndexError` when `index is out of range.");
    expect(declarations).not.toContain("@throws");
  });

  test("a sentence without a period fires nothing", () => {
    expect(derived(
      "(** Throws `ParseError` when the input is malformed *)\n" +
      "export fun odd(text: String): Int = 0\n",
    )).not.toContain("@throws");
  });

  test("a manifest inside a fenced code block is code, not prose", () => {
    const declarations = derived(
      "(** How to document a throwing function:\n" +
      "\n" +
      "    ```\n" +
      "    Throws `ParseError` when the input is malformed.\n" +
      "    ```\n" +
      "*)\n" +
      "export fun explain(text: String): Int = 0\n",
    );

    expect(declarations).toContain("Throws `ParseError` when the input is malformed.");
    expect(declarations).not.toContain("@throws");
  });

  test("several exceptions take several sentences, and each derives a tag", () => {
    const declarations = derived(
      "(** Reads a slice.\n" +
      "\n" +
      "    Throws `IndexError` when the index is out of range. Throws\n" +
      "    `SliceError` when the window descends. *)\n" +
      "export fun slice(text: String): Int = 0\n",
    );

    expect(declarations).toContain("@throws {IndexError} when the index is out of range\n");
    expect(declarations).toContain("@throws {SliceError} when the window descends\n");
  });

  test("the tags join the generated position, after the emitter's own docs", () => {
    // §7.3's one block: user content, then whatever emission generates, then the
    // tags. Two JSDoc blocks would silently drop one, so the merge is the rule
    // and this is the order it produces.
    // An unannotated user extern is the impure constant (Effects §6.1), which is
    // the arrow TypeScript's notation cannot spell — so emission generates
    // documentation of its own here (#364) and the two channels have to share
    // one block.
    const declarations = derived(
      "export exception Boom\n" +
      "extern from \"node:fs\"\n" +
      "    (** Reads a file. Throws `Boom` when the path is bad. *)\n" +
      "    export fun readFileSync(path: String): String\n",
    );

    // One block, in §7.3's order: user content, then the generated prose, then
    // the tags — the position JSDoc conventionally puts tags in — immediately
    // preceding the declaration all of it belongs to.
    expect(declarations).toContain(
      "/**\n" +
        " * Reads a file. Throws `Boom` when the path is bad.\n" +
        " *\n" +
        " * Hexagon: `String ->! String`\n" +
        " *\n" +
        " * @throws {Boom} when the path is bad\n" +
        " */\n" +
        "export declare function readFileSync(path: string): string;",
    );
  });

  test("the stdlib's own manifests reach the boundary", () => {
    // The end-to-end check the respell earns: `stdlib/Vector.hex` documents
    // `at` and `set` with the recognized sentence, and the exported face of
    // each carries the tag.
    const project = compileFiles([["/main.hex", "export let x: Int = Vector.at([1], 1)\n"]]);
    expect(project.diagnostics).toEqual([]);
    const vector = project.modules.find(({ source }) => source.path === "/Vector.hex")!;

    expect(vector.declarations.text).toContain(
      "@throws {IndexError} when no such element exists — zero never addresses one",
    );
    expect(vector.declarations.text).toContain(
      "@throws {IndexError} when `index` is out of range; it never extends the vector",
    );
  });
});
