import { describe, expect, test } from "vitest";

import { compileProject, emitTypeScriptPreview, Source, type CompiledProject } from "../index";
import { typeScriptErrors } from "../support/typescript-check.js";

/**
 * Conformance for **FFI Part 7 §1.1's contested vocabulary** — the rule that a
 * face survives its own file (#662; correction record §14.6).
 *
 * Some faces are written in TypeScript's standard-library vocabulary:
 * `Iterable` (§2.3's `Seq` pin), `ReadonlyArray` (Part 1 §4.1's `Array(a)` row),
 * `ReadonlyMap` and `ReadonlySet` (Part 10), and `Error` (§6's exception faces
 * and the `isHexError` guard). TypeScript resolves a name file-locally before
 * its library, so a type-space binding under one of those in a module's own
 * `.d.ts` captured every face there written in it. Nothing guarded that: the
 * probes of §2.1 and §2.4 protect compiler-chosen spellings, and Part 1 §10
 * forbids moving a user export.
 *
 * The repair has two halves and moves no user spelling:
 *
 * 1. the vocabulary joins every probe universe, so nothing the compiler mints
 *    can take a lib spelling a face needs;
 * 2. where the file's own §2.4 universe binds a contested spelling anyway,
 *    every face in that file written in it qualifies through TypeScript's own
 *    global-scope reference — `globalThis.Iterable<a>`, `globalThis.Error &
 *    {…}` — **collision-only**, so an uncontested file emits the bare
 *    vocabulary byte-identically.
 *
 * **Every capture class is measured twice**: by exact text, which says what the
 * emitter chose, and by real `tsc` over the whole emitted set from a consumer's
 * side, which says whether the published contract is the right one. Three of the
 * four classes shipped a file that *compiled* while meaning the wrong thing, so
 * text alone would have passed on `main` for two of them and `tsc` alone would
 * have passed for one; the pair is the test.
 *
 * Each class also carries its **negative baseline** — the unqualified text, run
 * through the same `tsc` — so the failure the qualification repairs is recorded
 * as a measurement rather than as a claim about a compiler version.
 */

/** One compiled project, with its diagnostics asserted empty. */
function project(files: Readonly<Record<string, string>>): CompiledProject {
  const compiled = compileProject(
    Object.entries(files).map(([path, text], index) =>
      new Source.File(Source.fileId(index), path, text)
    ),
  );
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  return compiled;
}

/**
 * Every emitted `.d.ts` of a program, keyed for `typeScriptErrors`, with the
 * runtime declaration module (Part 1 §8.3) where the program has one.
 *
 * The whole set, never one file: a declaration file that imports is only
 * TypeScript together with what it imports from, and every consumer check below
 * asks about a name crossing at least two of them.
 */
function declarationSet(compiled: CompiledProject): Record<string, string> {
  const files: Record<string, string> = {};
  const runtime = compiled.runtimeDeclarations;
  if (runtime !== undefined) files[runtime.path.replace(/^\//u, "")] = runtime.text;
  for (const module of compiled.modules) {
    files[module.source.path.replace(/^\//u, "").replace(/\.hex$/u, ".d.ts")] =
      module.declarations.text;
  }
  return files;
}

/** One module's generated `.d.ts` text. */
function declarations(compiled: CompiledProject, path = "/main.hex"): string {
  const module = compiled.modules.find(({ source }) => source.path === path);
  if (module === undefined) throw new Error(`${path} was not emitted`);
  return module.declarations.text;
}

/** One module's emitted JavaScript. */
function javascript(compiled: CompiledProject, path = "/main.hex"): string {
  const module = compiled.modules.find(({ source }) => source.path === path);
  if (module === undefined) throw new Error(`${path} was not emitted`);
  return module.javascript.text;
}

/** One module's inspection-only TypeScript preview (§2.4 Scope). */
function preview(compiled: CompiledProject, path = "/main.hex"): string {
  const module = compiled.modules.find(({ source }) => source.path === path);
  if (module === undefined) throw new Error(`${path} was not emitted`);
  return emitTypeScriptPreview(module.core).text;
}

/** The `Seq` face this file contests, in the one shape every class shares. */
const SEQ_FACE = "export let twice(s: Seq(Int)): Int = Seq.length(s) * 2\n";

describe("class 1 — a non-generic capture, which failed the consumer's compile", () => {
  const PROGRAM = { "/main.hex": "export record Iterable = {x: Int}\n" + SEQ_FACE };

  test("the face qualifies; the record keeps its own spelling at every seat", () => {
    const text = declarations(project(PROGRAM));

    // The broad claim first: no seat in this file spells the *face* bare. It is
    // written on the face's instantiation rather than on the spelling, because
    // the user's own seats legitimately say `Iterable` and must keep saying it
    // (class 2 below spells `Iterable<a>` at three of them). A narrower positive
    // pin alone would pass in a file that qualified one face and left another,
    // which is the shape a per-occurrence decision drifts into — the decision is
    // per (file, spelling).
    expect(text).not.toMatch(/(?<!globalThis\.)Iterable<number>/u);

    // Part 1 §10 stands absolute: the user's own three seats are untouched.
    expect(text).toBe(
      "export type Iterable = { x: number };\n" +
        "export declare const Iterable: (record: { x: number }) => Iterable;\n" +
        "export declare const twice: (s: globalThis.Iterable<number>) => number;\n",
    );
  });

  test("the negative baseline: the same file unqualified is TS2315", async () => {
    // What shipped before this rule, run through the same compiler. Recorded so
    // the class is a measurement and not a claim: if TypeScript ever stopped
    // resolving the name file-locally, this is the assertion that would say so.
    expect(
      await typeScriptErrors({
        "main.d.ts": "export type Iterable = { x: number };\n" +
          "export declare const twice: (s: Iterable<number>) => number;\n",
      }),
    ).toEqual(["main.d.ts(2,33): error TS2315: Type 'Iterable' is not generic."]);
  });

  test("the consumer compiles: an array reaches the face, the record still works", async () => {
    expect(
      await typeScriptErrors({
        ...declarationSet(project(PROGRAM)),
        "consumer.ts": 'import { Iterable, twice } from "./main.js";\n' +
          // Inbound: the published `Seq` parameter takes any foreign iterable,
          // which is the whole of §8.2's promise and the half the capture broke.
          "export const n: number = twice([1, 2, 3]);\n" +
          // The user's export, undisturbed, in both its meanings.
          "export const mine: Iterable = Iterable({ x: 1 });\n" +
          "export const x: number = mine.x;\n",
      }),
    ).toEqual([]);
  });
});

describe("class 2 — a same-arity capture, which compiled while meaning the wrong type", () => {
  const PROGRAM = { "/main.hex": "export union Iterable(a) = Wrap(a)\n" + SEQ_FACE };

  test("the face qualifies; the union's own arity is what made this silent", () => {
    const text = declarations(project(PROGRAM));

    expect(text).not.toMatch(/(?<!globalThis\.)Iterable<number>/u);
    expect(text).toBe(
      'export type Iterable<a> = { tag: "Wrap"; item1: a };\n' +
        "export declare const Wrap: <a>(item1: a) => Iterable<a>;\n" +
        "export declare const twice: (s: globalThis.Iterable<number>) => number;\n",
    );
  });

  test("the negative baseline: unqualified, it compiles — and means the union", async () => {
    // The class's whole severity, as a measurement. `tsc` reports nothing about
    // the declaration file; the error lands on an innocent consumer, blaming a
    // correct call. Both halves are asserted, because "no error" alone would
    // also describe a file that had been repaired.
    expect(
      await typeScriptErrors({
        "main.d.ts": 'export type Iterable<a> = { tag: "Wrap"; item1: a };\n' +
          "export declare const twice: (s: Iterable<number>) => number;\n",
      }),
    ).toEqual([]);
    expect(
      await typeScriptErrors({
        "main.d.ts": 'export type Iterable<a> = { tag: "Wrap"; item1: a };\n' +
          "export declare const twice: (s: Iterable<number>) => number;\n",
        "consumer.ts": 'import { twice } from "./main.js";\n' +
          "export const n: number = twice([1, 2, 3]);\n",
      }),
    ).toEqual([
      "consumer.ts(2,32): error TS2739: Type 'number[]' is missing the following properties from type 'Iterable<number>': tag, item1",
    ]);
  });

  test("the consumer compiles: the array is accepted and the union stays usable", async () => {
    expect(
      await typeScriptErrors({
        ...declarationSet(project(PROGRAM)),
        "consumer.ts": 'import { Wrap, twice, type Iterable } from "./main.js";\n' +
          "export const n: number = twice([1, 2, 3]);\n" +
          // The user's union, annotated through the imported type — the exact
          // pair the capture made indistinguishable.
          "export const held: Iterable<number> = Wrap(1);\n" +
          'export const tag: "Wrap" = held.tag;\n',
      }),
    ).toEqual([]);
  });
});

describe("class 3 — an `export record Error` beside an exported exception", () => {
  const PROGRAM = {
    "/main.hex": "export record Error = {code: Int}\n" + "export exception Boom(value: Int)\n",
  };

  test("the exception face and the guard both qualify", () => {
    const text = declarations(project(PROGRAM));

    // Broad first: nothing in this file intersects with the bare spelling. The
    // guard is the seat most easily missed — it is rendered by a function of its
    // own, not through `renderType` — so the sweep has to precede the pins.
    expect(text).not.toMatch(/(?<!globalThis\.)\bError &/u);
    expect(text).toBe(
      "export type Error = { code: number };\n" +
        "export declare const Error: (record: { code: number }) => Error;\n" +
        "export type Boom = globalThis.Error" +
        ' & { readonly $hex: "main"; readonly name: "Boom"; readonly value: number };\n' +
        "export declare function Boom(value: number): Boom;\n" +
        "export declare namespace Boom {\n" +
        "  function is(__error: unknown): __error is Boom;\n" +
        "}\n" +
        "export declare function isHexError(__error: unknown): __error is globalThis.Error" +
        " & { readonly $hex: string; readonly name: string };\n",
    );
  });

  test("the negative baseline: unqualified, the real `Error` members are gone", async () => {
    // Silent in the declaration file and fatal at the consumer, twice over: the
    // face loses `.message`/`.stack`, and `isHexError`'s true branch narrows to
    // the user's record instead of an error.
    expect(
      await typeScriptErrors({
        "main.d.ts": "export type Error = { code: number };\n" +
          'export type Boom = Error & { readonly $hex: "main"; readonly name: "Boom" };\n' +
          "export declare function Boom(): Boom;\n",
        "consumer.ts": 'import { Boom } from "./main.js";\n' +
          "export const m: string = Boom().message;\n",
      }),
    ).toEqual([
      "consumer.ts(2,33): error TS2339: Property 'message' does not exist on type 'Boom'.",
    ]);
  });

  test("the consumer reads `.message`/`.stack` and narrows through `isHexError`", async () => {
    expect(
      await typeScriptErrors({
        ...declarationSet(project(PROGRAM)),
        "consumer.ts": 'import { Boom, Error as HexError, isHexError } from "./main.js";\n' +
          "export const m: string = Boom(3).message;\n" +
          "export const s: string | undefined = Boom(3).stack;\n" +
          "export const v: number = Boom(3).value;\n" +
          // The guard's predicate, which the capture degraded rather than broke.
          "export const caught = (e: unknown): string => isHexError(e) ? e.message : e.$hex;\n" +
          // The user's record, undisturbed under its own name.
          "export const mine = HexError({ code: 4 }).code;\n",
      }),
    ).toEqual([
      // The one deliberate error: the *false* branch is still `unknown`, which
      // is exactly what a working predicate means. Asserted rather than avoided,
      // so the narrowing is measured in both directions from one call — a guard
      // that narrowed nothing would leave the true branch failing instead.
      "consumer.ts(5,75): error TS18046: 'e' is of type 'unknown'.",
    ]);
  });
});

describe("class 4 — the exception itself named `Error`, which compiled nowhere", () => {
  const PROGRAM = { "/main.hex": "export exception Error(value: Int)\n" };

  test("the alias names the library type, not itself", () => {
    const text = declarations(project(PROGRAM));

    expect(text).not.toMatch(/(?<!globalThis\.)\bError &/u);
    expect(text).toBe(
      "export type Error = globalThis.Error" +
        ' & { readonly $hex: "main"; readonly name: "Error"; readonly value: number };\n' +
        "export declare function Error(value: number): Error;\n" +
        "export declare namespace Error {\n" +
        "  function is(__error: unknown): __error is Error;\n" +
        "}\n" +
        "export declare function isHexError(__error: unknown): __error is globalThis.Error" +
        " & { readonly $hex: string; readonly name: string };\n",
    );
  });

  test("the negative baseline: unqualified, the file is TS2456 on its own", async () => {
    // The class no TypeScript accepts: the alias captures its own face into a
    // self-reference. Nothing downstream is needed to provoke it — the shipped
    // file fails alone, which is why this baseline has no consumer.
    expect(
      await typeScriptErrors({
        "main.d.ts": 'export type Error = Error & { readonly $hex: "main" };\n',
      }),
    ).toEqual([
      "main.d.ts(1,13): error TS2456: Type alias 'Error' circularly references itself.",
    ]);
  });

  test("the consumer compiles: the exception is constructible and narrows", async () => {
    expect(
      await typeScriptErrors({
        ...declarationSet(project(PROGRAM)),
        "consumer.ts": 'import { Error as Boom, isHexError } from "./main.js";\n' +
          "export const m: string = Boom(3).message;\n" +
          "export const v: number = Boom(3).value;\n" +
          "export const one = (e: unknown): number => Boom.is(e) ? e.value : 0;\n" +
          "export const any = (e: unknown): string => isHexError(e) ? e.name : \"\";\n",
      }),
    ).toEqual([]);
  });
});

describe("the universe decides — per file, per spelling", () => {
  test("a source-written named import of a type genuinely named `Iterable`", async () => {
    // Nothing refuses a Hexagon module exporting a type named `Iterable`, so the
    // capture travels: the *home* file qualifies its own faces, and the
    // importer's local puts the spelling in the importer's type space, so that
    // file qualifies too. The import itself keeps working — Part 1 §10 again.
    const compiled = project({
      "/lib.hex": "export record Iterable = {x: Int}\n" + SEQ_FACE,
      "/main.hex": 'import { Iterable } from "./lib"\n' +
        "export let f(p: Iterable): Int = p.x\n" + SEQ_FACE,
    });

    expect(declarations(compiled, "/lib.hex")).toContain(
      "export declare const twice: (s: globalThis.Iterable<number>) => number;",
    );
    expect(declarations(compiled)).toBe(
      'import type { Iterable } from "./lib.js";\n' +
        "export declare const f: (p: Iterable) => number;\n" +
        "export declare const twice: (s: globalThis.Iterable<number>) => number;\n",
    );
    expect(
      await typeScriptErrors({
        ...declarationSet(compiled),
        "consumer.ts": 'import { f } from "./main.js";\n' +
          'import { Iterable } from "./lib.js";\n' +
          "export const n: number = f(Iterable({ x: 1 }));\n" +
          'import { twice } from "./main.js";\n' +
          "export const m: number = twice([1, 2]);\n",
      }),
    ).toEqual([]);
  });

  test("a constructor sharing the spelling — the licensed harmless over-claim", () => {
    // §1.1's stated instance of §2.4's over-claim license. A union constructor
    // is a *value*, so it captures no type reference and this file did not
    // strictly need the qualification; the universe is deliberately flat, and
    // the price of not keeping a second, drifting, type-space-only copy of it is
    // one harmless qualified spelling. Pinned as deliberate, so a later reader
    // does not "fix" it into a divergence.
    expect(declarations(project({
      "/main.hex": "export union Box = Iterable(Int) | Empty\n" + SEQ_FACE,
    }))).toBe(
      'export type Box = { tag: "Iterable"; item1: number } | { tag: "Empty" };\n' +
        "export declare const Iterable: (item1: number) => Box;\n" +
        "export declare const Empty: Box;\n" +
        "export declare const twice: (s: globalThis.Iterable<number>) => number;\n",
    );
  });

  test("a namespace alias whose line no face owes triggers nothing", () => {
    // The gated-alias rule (§2.4): an alias reaches the `.d.ts` only where some
    // rendered face is answered through it. Here the alias serves *terms* only,
    // so its line is not written and the spelling is not in this file's universe
    // — and the face therefore emits the bare text it always emitted.
    const text = declarations(project({
      "/lib.hex": "export record Point = {x: Int}\nexport let zero: Int = 0\n",
      "/main.hex": 'import module Iterable from "./lib"\n' +
        "export let n: Int = Iterable.zero\n" + SEQ_FACE,
    }));

    expect(text).not.toContain("globalThis");
    expect(text).toBe(
      "export declare const n: number;\n" +
        "export declare const twice: (s: Iterable<number>) => number;\n",
    );
  });

  test("a namespace alias whose line is carried triggers only the qualification", async () => {
    // The alias does **not** yield: a TS namespace import binding does not
    // occupy the plain type-name space (measured with a control, §14.6), so
    // there is no capture to step aside from. It is in the universe on the flat
    // convention, so the licensed qualification fires — and the alias keeps its
    // own source spelling, which is the half a yielding rule would have moved.
    const compiled = project({
      "/lib.hex": "export record Point = {x: Int}\n",
      "/main.hex": 'import module Iterable from "./lib"\n' +
        "export let f(p: Iterable.Point): Int = p.x\n" + SEQ_FACE,
    });
    const text = declarations(compiled);

    expect(text).not.toContain("Iterable_1");
    expect(text).toBe(
      'import type * as Iterable from "./lib.js";\n' +
        "export declare const f: (p: Iterable.Point) => number;\n" +
        "export declare const twice: (s: globalThis.Iterable<number>) => number;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("each of the five spellings qualifies on its own binding, and only its own", () => {
    // Per (file, spelling): a file binding `ReadonlyArray` qualifies its array
    // faces and leaves its map and set faces bare, in the same file, at the same
    // time. One shared flag would pass every other test here.
    const text = declarations(project({
      "/main.hex": "export record ReadonlyArray = {a: Int}\n" +
        'extern from "./x.js"\n' +
        "    fun rows(): Array(Int)\n" +
        "    fun table(): JsMap(String, Int)\n" +
        "    fun flags(): JsSet(Int)\n" +
        "\n" +
        "export let first: Array(Int) = rows!()\n" +
        "export let counts: JsMap(String, Int) = table!()\n" +
        "export let seen: JsSet(Int) = flags!()\n",
    }));

    expect(text).toContain("export declare const first: globalThis.ReadonlyArray<number>;");
    expect(text).toContain("export declare const counts: ReadonlyMap<string, number>;");
    expect(text).toContain("export declare const seen: ReadonlySet<number>;");
  });
});

describe("compiler-chosen spellings never contest the vocabulary (§1.1 half 1)", () => {
  test("a minted local moves off `Iterable` — and the face then stays bare", async () => {
    // §2.4 rung 5's minted local takes the foreign type's *own name* first, so a
    // module exporting a record genuinely named `Iterable` would have been
    // imported here under `Iterable` and captured this file's `Seq` face — a
    // compiler-chosen spelling breaking a face, which half 1 forbids outright.
    // It probes to `Iterable_1`, and because nothing then binds the bare
    // spelling in this file, the face needs no qualification at all: the two
    // halves are complementary, not belt-and-braces.
    const compiled = project({
      "/lib.hex": "export record Iterable = {x: Int}\nexport type Holder = Iterable\n",
      "/main.hex": 'import { Holder } from "./lib"\n' +
        "export let f(h: Holder): Int = h.x\n" + SEQ_FACE,
    });
    const text = declarations(compiled);

    expect(text).not.toContain("globalThis");
    expect(text).toBe(
      'import type { Iterable as Iterable_1 } from "./lib.js";\n' +
        "export declare const f: (h: Iterable_1) => number;\n" +
        "export declare const twice: (s: Iterable<number>) => number;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("the runtime alias probe reads the vocabulary too", () => {
    // Inert today — `Hex`, `Hex_1`, … can never land on a lib spelling — and
    // asserted anyway at the one place it is observable: the alias is *not*
    // pushed aside by a contested name it could never collide with. A probe that
    // read a different universe from its neighbours is the drift the single list
    // exists to prevent, and this is the direction that drift would show in.
    expect(declarations(project({
      "/main.hex": "export record Iterable = {x: Int}\n" +
        "export let rows: Vector(Int) = [1, 2, 3]\n",
    }))).toContain('import type * as Hex from "./hex.js";');
  });
});

describe("the negatives — nothing else moves", () => {
  // Every vocabulary spelling in one uncontested file: `Iterable` through the
  // `Seq` pin, `ReadonlyArray` through `Array(a)`, `ReadonlyMap`/`ReadonlySet`
  // through Part 10's borrowed views, and `Error` through an exception face and
  // the guard. Multi-module, so a cross-file import line is in the picture too.
  const UNCONTESTED = {
    "/lib.hex": "export record Point = {x: Int}\n",
    "/main.hex": 'import { Point } from "./lib"\n' +
      'extern from "./x.js"\n' +
      "    fun rows(): Array(Int)\n" +
      "    fun table(): JsMap(String, Int)\n" +
      "    fun flags(): JsSet(Int)\n" +
      "\n" +
      "export exception Boom(value: Int)\n" +
      "export let first: Array(Int) = rows!()\n" +
      "export let counts: JsMap(String, Int) = table!()\n" +
      "export let seen: JsSet(Int) = flags!()\n" +
      "export let near(p: Point): Int = p.x\n" + SEQ_FACE,
  };

  test("an uncontested file emits the bare vocabulary, byte for byte", () => {
    const text = declarations(project(UNCONTESTED));

    // The broad claim, then the whole file. `toBe` is what makes this a
    // byte-identity pin rather than a spot check: the text below is exactly what
    // this program emitted before §1.1 existed.
    expect(text).not.toContain("globalThis");
    expect(text).toBe(
      'import type { Point } from "./lib.js";\n' +
        'export type Boom = Error & { readonly $hex: "main"; readonly name: "Boom"; readonly value: number };\n' +
        "export declare function Boom(value: number): Boom;\n" +
        "export declare namespace Boom {\n" +
        "  function is(__error: unknown): __error is Boom;\n" +
        "}\n" +
        "export declare const first: ReadonlyArray<number>;\n" +
        "export declare const counts: ReadonlyMap<string, number>;\n" +
        "export declare const seen: ReadonlySet<number>;\n" +
        "export declare const near: (p: Point) => number;\n" +
        "export declare const twice: (s: Iterable<number>) => number;\n" +
        "export declare function isHexError(__error: unknown): __error is Error & { readonly $hex: string; readonly name: string };\n",
    );
  });

  test("the shipped runtime declaration module is untouched", () => {
    // Its four top-level names are fixed, so it can never contest anything and
    // always writes the bare spelling — the one file whose faces do not consult
    // a module universe at all. The program is the *contested* one, which is
    // where a rule reading a program-wide rather than a per-file universe would
    // show: this file must stay bare while `main.d.ts` beside it qualifies.
    const compiled = project({
      "/main.hex": "export record Iterable = {x: Int}\n" +
        "export let rows: Vector(Int) = [1, 2, 3]\n",
    });
    expect(declarations(compiled)).toContain("export declare const rows: Hex.Vector<number>;");
    expect(compiled.runtimeDeclarations?.text).toBe(
      'export interface Vector<a> extends Iterable<a> { readonly "~hex": "Vector"; }\n' +
        'export interface Set<a> extends Iterable<a> { readonly "~hex": "Set"; }\n' +
        'export interface Map<k, v> extends Iterable<[k, v]> { readonly "~hex": "Map"; }\n' +
        'export interface Range extends Iterable<number> { readonly "~hex": "Range"; }\n',
    );
  });

  test("the emitted JavaScript is untouched entirely, in the worst-contested file", () => {
    // §1.1's last fixed consequence: the defect and its repair live in the
    // declaration file alone. Class 3's program is the sharpest case — it binds
    // `Error` in the emitted `.js` as well — and its JavaScript is pinned whole.
    //
    // The `new Error(...)` inside `__exception` below is **not** this rule's
    // business and is deliberately pinned as it stands: the emitted JavaScript's
    // own name capture is a separate defect at a separate seat, and a repair to
    // it must be a conscious change to this line rather than a side effect here.
    const js = javascript(project({
      "/main.hex": "export record Error = {code: Int}\n" + "export exception Boom(value: Int)\n",
    }));

    expect(js).not.toContain("globalThis");
    expect(js).toBe(
      "function __exception(__name, __message, __fields) {\n" +
        '  return Object.assign(new Error(__message), { $hex: "main", name: __name }, __fields);\n' +
        "}\n" +
        "\n" +
        "const Error = __record => __record;\n" +
        'const Boom = value => __exception("Boom", "", { value });\n' +
        'Boom.is = (__error) => __error != null && __error.$hex === "main"' +
        ' && __error.name === "Boom";\n' +
        "export const isHexError = (__error) => __error != null" +
        ' && typeof __error.$hex === "string";\n' +
        "export { Error };\n" +
        "export { Boom };\n",
    );
  });

  test("no contested program's JavaScript mentions the qualifier anywhere", () => {
    // The sweep behind the single pin above, across all four capture classes and
    // every module each of them pulls in — the prelude's `Seq` machinery
    // included, which is where a face-rendering change would leak into a runtime
    // file if it could leak at all.
    for (const source of [
      "export record Iterable = {x: Int}\n" + SEQ_FACE,
      "export union Iterable(a) = Wrap(a)\n" + SEQ_FACE,
      "export record Error = {code: Int}\nexport exception Boom(value: Int)\n",
      "export exception Error(value: Int)\n",
    ]) {
      for (const module of project({ "/main.hex": source }).modules) {
        expect(module.javascript.text).not.toContain("globalThis.");
      }
    }
  });
});

describe("the preview shows what would ship (§14.6)", () => {
  test("the preview qualifies identically to the `.d.ts`", () => {
    // §2.4's Scope note keeps the preview on bare *names* because the pane has
    // nothing to import from; qualification imports nothing, so it does reach
    // here — the #622 precedent, stated in §14.6.
    const compiled = project({ "/main.hex": "export record Iterable = {x: Int}\n" + SEQ_FACE });

    expect(preview(compiled)).toBe(declarations(compiled));
  });

  test("the inline runtime namespace qualifies too — it shares the pane", () => {
    // The preview's own exposure, which the shipped files do not have: §8.3
    // obligation 6 declares `Hex` inline, so `interface Vector<a> extends
    // Iterable<a>` sits in the same scope as the user's `Iterable` and is
    // captured (measured, TS2315). The shipped `.d.ts` reaches those four
    // interfaces through a file of their own and is unaffected.
    const text = preview(project({
      "/main.hex": "export record Iterable = {x: Int}\n" +
        "export let rows: Vector(Int) = [1, 2, 3]\n",
    }));

    expect(text).not.toMatch(/(?<!globalThis\.)\bIterable</u);
    expect(text).toContain(
      '  interface Vector<a> extends globalThis.Iterable<a> { readonly "~hex": "Vector"; }',
    );
    expect(text).toContain(
      '  interface Map<k, v> extends globalThis.Iterable<[k, v]> { readonly "~hex": "Map"; }',
    );
  });

  test("an uncontested preview keeps the bare namespace body", () => {
    const text = preview(project({ "/main.hex": "export let rows: Vector(Int) = [1, 2, 3]\n" }));

    expect(text).not.toContain("globalThis");
    expect(text).toContain(
      '  interface Vector<a> extends Iterable<a> { readonly "~hex": "Vector"; }',
    );
  });

  test("the contested preview text compiles on its own", async () => {
    expect(
      await typeScriptErrors({
        "preview.ts": preview(project({
          "/main.hex": "export record Iterable = {x: Int}\n" +
            "export let rows: Vector(Int) = [1, 2, 3]\n" + SEQ_FACE,
        })),
      }),
    ).toEqual([]);
  });
});
