import { describe, expect, test } from "vitest";

import { compileProject, Source } from "../index";
import { typeScriptErrors } from "../support/typescript-check.js";

/**
 * Conformance for **FFI Part 7 §2.4's one sink** — the five rungs a generated
 * `.d.ts` names a nominal through, and the rule that the file's imports are
 * exactly what those answers owe (#574, #268, #617, #618; correction record
 * §14.3).
 *
 * The declaration emitter named every nominal by `type.name` — the type's
 * *declared* name — with no record of how the file it was writing spells that
 * identity. That is right for a type the module declares and right for a prelude
 * type, and wrong for everything else, which is one defect wearing four faces.
 * §14.3 tabulates six failing shapes; each is a `describe` below, and each is
 * checked twice — by text, which says *which rung* answered, and by real `tsc`
 * over the whole emitted set, which says whether the name is bound at all.
 *
 * **Never one file alone.** A declaration file that imports is only TypeScript
 * *together with* what it imports from; checking one in isolation is the lesson
 * §14.2 already paid for, and every `tsc` assertion here runs over the set.
 */

/** One compiled project, with its diagnostics asserted empty. */
function project(files: readonly (readonly [string, string])[]) {
  const compiled = compileProject(
    files.map(([path, text], index) => new Source.File(Source.fileId(index), path, text)),
  );
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual([]);
  return compiled;
}

/**
 * One compiled project whose diagnostics are asserted **exactly**, for the
 * programs the boundary rule refuses (#621): emission still runs over them, and
 * the sink's guards are what these tests are about.
 */
function refused(
  files: readonly (readonly [string, string])[],
  messages: readonly string[],
) {
  const compiled = compileProject(
    files.map(([path, text], index) => new Source.File(Source.fileId(index), path, text)),
  );
  expect(compiled.diagnostics.map(({ message }) => message)).toEqual(messages);
  return compiled;
}

/** Every emitted module's declarations, plus `hex.d.ts` where one was emitted. */
function declarationSet(
  compiled: ReturnType<typeof project>,
): Record<string, string> {
  const files: Record<string, string> = {};
  for (const module of compiled.modules) {
    const name = module.source.path.replace(/^\//u, "").replace(/\.hex$/u, ".d.ts");
    files[name] = module.declarations.text;
  }
  if (compiled.runtimeDeclarations !== undefined) {
    files["hex.d.ts"] = compiled.runtimeDeclarations.text;
  }
  return files;
}

/** One emitted module, by source path. */
function emitted(compiled: ReturnType<typeof project>, path: string) {
  const module = compiled.modules.find(({ source }) => source.path === path);
  if (module === undefined) throw new Error(`${path} was not emitted`);
  return module;
}

/** One module's `.d.ts` text. */
function declarations(
  compiled: ReturnType<typeof project>,
  path = "/main.hex",
): string {
  return emitted(compiled, path).declarations.text;
}

const POINT = ["/point.hex", "export record Point = {x: Float, y: Float}\n"] as const;

describe("row 1 — a namespace alias beside a same-spelled declaration (TS2440, #574)", () => {
  test("the alias line is not written, because no face qualifies through it", async () => {
    const compiled = project([
      [
        "/point.hex",
        "opaque record Point = {x: Float, y: Float}\n" +
          "export fun getX(p: Point): Float = p.x\n" +
          "export fun make(x: Float, y: Float): Point = Point({x = x, y = y})\n",
      ],
      [
        "/main.hex",
        'import module Point from "./point"\n' +
          "export record Point = {n: Int}\n" +
          "export fun mine(p: Point): Int = p.n\n" +
          "export let far: Float = Point.getX(Point.make(1.0, 2.0))\n",
      ],
    ]);

    // The alias serves terms only. §2.4's headline rule — a line no answer owes
    // is not written — dissolves the collision with no renaming at all, which is
    // what §14.3 records as the measurement that relocated the repair.
    expect(declarations(compiled)).toBe(
      "export type Point = { n: number };\n" +
        "export declare const Point: (record: { n: number }) => Point;\n" +
        "export declare function mine(p: Point): number;\n" +
        "export declare const far: number;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("the emitted JavaScript is untouched — the two files decide independently", () => {
    const compiled = project([
      [
        "/point.hex",
        "opaque record Point = {x: Float, y: Float}\n" +
          "export fun getX(p: Point): Float = p.x\n" +
          "export fun make(x: Float, y: Float): Point = Point({x = x, y = y})\n",
      ],
      [
        "/main.hex",
        'import module Point from "./point"\n' +
          "export record Point = {n: Int}\n" +
          "export let far: Float = Point.getX(Point.make(1.0, 2.0))\n",
      ],
    ]);

    // #569's plan governs the `.js` against that file's contestants, and this
    // collision is real there: the emitted file binds a `Point` const. §2.4 says
    // outright that the two files decide independently, so the alias moves in
    // one and vanishes from the other.
    expect(emitted(compiled, "/main.hex").javascript.text).toContain(
      'import * as Point_1 from "./point.js";',
    );
  });
});

describe("row 2 — a namespace alias beside a named import of the same spelling (#574)", () => {
  test("only the line an answer owes survives", async () => {
    const compiled = project([
      POINT,
      ["/other.hex", "export record Point = {n: Int}\n"],
      [
        "/main.hex",
        'import module Point from "./point"\n' +
          'import { Point } from "./other"\n' +
          "export fun mine(p: Point): Int = p.n\n",
      ],
    ]);

    // Two lines bound one identifier before this landed — TS2300 twice, plus a
    // TS2709 for the face, which described the wrong type. The named import is
    // what the face answered through, so its line stays and the alias's does not.
    expect(declarations(compiled)).toBe(
      'import type { Point } from "./other.js";\n' +
        "export declare function mine(p: Point): number;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("row 3 — a qualified face, nothing contesting (TS2304, #268)", () => {
  test("rung 3 spells the alias the author wrote", async () => {
    const compiled = project([
      ["/lib.hex", "export record Point = {x: Float, y: Float}\n"],
      [
        "/main.hex",
        'import module Lib from "./lib"\nexport fun mk(p: Lib.Point): Lib.Point = p\n',
      ],
    ]);

    expect(declarations(compiled)).toBe(
      'import type * as Lib from "./lib.js";\n' +
        "export declare function mk(p: Lib.Point): Lib.Point;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("an annotated `let` keeps its written qualifier too", async () => {
    // The one seat where the checker had the occurrence and dropped it: an
    // annotated `let` unifies two concrete nominal nodes and then publishes the
    // *value's*, which carries its writer's spellings and so none of this
    // module's. §2.4 rests rung 3's totality on every nominal in an exported
    // face having a written occurrence, so the qualifier is carried across.
    const compiled = project([
      [
        "/lib.hex",
        "export record Point = {x: Float, y: Float}\n" +
          "export union Color = Red | Green\n" +
          "export let origin: Point = Point({x = 0.0, y = 0.0})\n" +
          "export let identity(p: Point): Point = p\n",
      ],
      [
        "/main.hex",
        'import module Lib from "./lib"\n' +
          "export let o: Lib.Point = Lib.origin\n" +
          "export let c: Lib.Color = Lib.Red\n" +
          "export let arrow: (Lib.Point) -> Lib.Point = Lib.identity\n",
      ],
    ]);
    const text = declarations(compiled);

    expect(text).toContain("export declare const o: Lib.Point;");
    expect(text).toContain("export declare const c: Lib.Color;");
    expect(text).toContain("export declare const arrow: (arg0: Lib.Point) => Lib.Point;");
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a structural record's fields keep their written qualifiers", async () => {
    const compiled = project([
      [
        "/lib.hex",
        "export record Point = {x: Float, y: Float}\n" +
          "export let origin: Point = Point({x = 0.0, y = 0.0})\n",
      ],
      [
        "/main.hex",
        'import module Lib from "./lib"\n' +
          "export let r: {p: Lib.Point} = {p = Lib.origin}\n" +
          "export fun f(v: {p: Lib.Point}): Int = 0\n",
      ],
    ]);

    // The annotated-`let` seat one step over: a row carries nominals in its
    // fields like any other container, and without the field walk one file
    // spelled one identity two ways — `{ p: Point }` beside `{ p: Lib.Point }` —
    // and owed a minted line for the half that lost its qualifier.
    expect(declarations(compiled)).toBe(
      'import type * as Lib from "./lib.js";\n' +
        "export declare const r: { p: Lib.Point };\n" +
        "export declare function f(v: { p: Lib.Point }): number;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a derived declaration inherits its scheme's qualifiers", async () => {
    // A record's constructor arrow, a union's constructor arrow and an
    // exception's payload are all *derived* from a written signature rather than
    // rendered from one. The qualifiers ride the type and survive substitution,
    // so each is emitted by the module that wrote its signature and nothing is
    // lost (§2.4 rung 3's second paragraph).
    const compiled = project([
      ["/lib.hex", "export record Point = {x: Float, y: Float}\n"],
      [
        "/main.hex",
        'import module Lib from "./lib"\n' +
          "export record Wrap = {inner: Lib.Point}\n" +
          "export union Holder = Held(p: Lib.Point)\n" +
          "export exception Bad(p: Lib.Point)\n",
      ],
    ]);
    const text = declarations(compiled);

    expect(text).toContain("export declare const Wrap: (record: { inner: Lib.Point }) => Wrap;");
    expect(text).toContain("export declare const Held: (p: Lib.Point) => Holder;");
    expect(text).toContain("export declare function Bad(p: Lib.Point): Bad;");
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a qualifier is readable only in the module that wrote it", async () => {
    // §2.4's counterexample, and §14.3's third rejected alternative. `/mid.hex`
    // writes `Lib.Point` into a type alias; `/main.hex` binds the same *spelling*
    // `Lib` to a different module. Reading the travelling qualifier would emit
    // `Lib.Point` here and name `/other.hex`'s `Point` — a real type that is the
    // wrong one, with nothing to report it.
    const compiled = project([
      ["/lib.hex", "export record Point = {x: Float, y: Float}\n"],
      ["/other.hex", "export record Point = {n: Int}\nexport let one: Int = 1\n"],
      [
        "/mid.hex",
        'import module Lib from "./lib"\nexport type Carried = Lib.Point\n' +
          "export fun pass(p: Carried): Carried = p\n",
      ],
      [
        "/main.hex",
        'import module Lib from "./other"\nimport { pass, Carried } from "./mid"\n' +
          "export fun here(p: Carried): Carried = pass(p)\n" +
          "export fun mine(p: Lib.Point): Lib.Point = p\n" +
          "export let n: Int = Lib.one\n",
      ],
    ]);
    const text = declarations(compiled);

    // This module's *own* `Lib` is bound and qualified, so its line is in the
    // file and `Lib.Point` is a spelling that resolves — to `/other.hex`'s
    // record. Reading the travelling qualifier would therefore not fail loudly;
    // it would publish `/other.hex`'s type where the source said `/lib.hex`'s,
    // with nothing to report it. `tsc` cannot see that, so the text must.
    expect(text).toContain('import type { Point } from "./lib.js";');
    expect(text).toContain("export declare function here(p: Point): Point;");
    expect(text).toContain("export declare function mine(p: Lib.Point): Lib.Point;");
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a travelling qualifier does not count the importer's alias either", async () => {
    // The sibling of the test above, one seat over: the *universe* has its own
    // writing-module test, and it is what keeps a qualifier `/mid.hex` wrote
    // from spending the name `Lib` in `/main.hex`. Main binds `Lib` for a term
    // only, so its line is not carried, so a minted local spelled `Lib` must
    // keep that spelling.
    const compiled = project([
      ["/lib.hex", "export record Point = {x: Int}\n"],
      ["/lib2.hex", "export record Lib = {n: Int}\n"],
      ["/other.hex", "export let one: Int = 1\n"],
      [
        "/mid.hex",
        'import module Lib from "./lib"\nexport type Carried = Lib.Point\n' +
          "export fun pass(p: Carried): Carried = p\n",
      ],
      [
        "/mid2.hex",
        'import { Lib } from "./lib2"\nexport type W = Lib\nexport fun two(): W = Lib({n = 1})\n',
      ],
      [
        "/main.hex",
        'import module Lib from "./other"\nimport { pass, Carried } from "./mid"\n' +
          'import { two, W } from "./mid2"\n' +
          "export fun here(p: Carried): Carried = pass(p)\n" +
          "export let w: W = two()\nexport let n: Int = Lib.one\n",
      ],
    ]);

    expect(declarations(compiled)).toBe(
      'import type { Point } from "./lib.js";\n' +
        'import type { Lib } from "./lib2.js";\n' +
        "export declare function here(p: Point): Point;\n" +
        "export declare const w: Lib;\n" +
        "export declare const n: number;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("two aliases onto one module each spell their own seats", async () => {
    // Neither alias is *the* alias for the identity, which is why the rung reads
    // the occurrence: keyed on the identity, one of them would spell both seats.
    const compiled = project([
      ["/lib.hex", "export record Point = {x: Float, y: Float}\n"],
      [
        "/main.hex",
        'import module A from "./lib"\nimport module B from "./lib"\n' +
          "export fun first(p: A.Point): A.Point = p\n" +
          "export fun second(p: B.Point): B.Point = p\n",
      ],
    ]);

    expect(declarations(compiled)).toBe(
      'import type * as A from "./lib.js";\n' +
        'import type * as B from "./lib.js";\n' +
        "export declare function first(p: A.Point): A.Point;\n" +
        "export declare function second(p: B.Point): B.Point;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("row 4 — a bare face in scope only by the companion fallback (TS2709, #268)", () => {
  test("a bare occurrence is not rung 3's; it falls to rung 5", async () => {
    // Modules §5.1 rule 2 puts the exported member's own name in scope, so the
    // source wrote `Shape` and not `Shape.Shape`. Keying rung 3 on the identity
    // would render `Shape.Shape` here — something the author did not write — and
    // the emitter used to render the *alias* in type position, which TypeScript
    // rejects outright.
    const compiled = project([
      ["/shape.hex", "export record Shape = {s: Int}\nexport let unit: Int = 1\n"],
      [
        "/main.hex",
        'import module Shape from "./shape"\n' +
          "export fun width(s: Shape): Int = s.s + Shape.unit\n",
      ],
    ]);

    expect(declarations(compiled)).toBe(
      'import type { Shape } from "./shape.js";\n' +
        "export declare function width(s: Shape): number;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("the gated alias moves nothing — the minted local keeps the bare name", () => {
    // §14.3's fourth rejected alternative, measured: counting the alias in the
    // probe's universe would push this file's own face to `Shape_1`, against a
    // `Shape` the file does not contain.
    //
    // Pinned by the file's **exact text**, not by the absence of a spelling. A
    // negative containment check here is a test that cannot fail: it names one
    // spelling the rejected alternative happens to produce today, and every
    // change to how a moved spelling is written — #619's underscore among them —
    // walks the real answer out from under it while it stays green.
    const compiled = project([
      ["/shape.hex", "export record Shape = {s: Int}\nexport let unit: Int = 1\n"],
      [
        "/main.hex",
        'import module Shape from "./shape"\n' +
          "export fun width(s: Shape): Int = s.s + Shape.unit\n",
      ],
    ]);

    expect(declarations(compiled)).toBe(
      'import type { Shape } from "./shape.js";\n' +
        "export declare function width(s: Shape): number;\n",
    );
  });
});

describe("row 5 — a renamed type import (TS2304, #617)", () => {
  test("the face spells the local, not the imported name", async () => {
    const compiled = project([
      ["/shape.hex", "export record Shape = {s: Int}\n"],
      [
        "/main.hex",
        'import { Shape as S } from "./shape"\nexport let c: S = S({s = 1})\n',
      ],
    ]);

    // The import line was already right and the face was wrong, so the two
    // halves of one channel disagreed inside a single file.
    expect(declarations(compiled)).toBe(
      'import type { Shape as S } from "./shape.js";\n' +
        "export declare const c: S;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a rename of a union and of an extern type answer the same way", async () => {
    const compiled = project([
      [
        "/lib.hex",
        "export union Color = Red | Green\n" +
          'extern from "./host.js"\n    export type Handle\n',
      ],
      [
        "/main.hex",
        'import { Color as C, Handle as H } from "./lib"\n' +
          "export fun both(c: C, h: H): H = h\n",
      ],
    ]);

    expect(declarations(compiled)).toBe(
      'import type { Color as C, Handle as H } from "./lib.js";\n' +
        "export declare function both(c: C, h: H): H;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("row 6 — a type alias's expansion (TS2304, #618)", () => {
  test("the file mints its own import of a type it names under no spelling", async () => {
    const compiled = project([
      ["/shape.hex", "export record Shape = {s: Int}\n"],
      [
        "/mid.hex",
        'import { Shape } from "./shape"\nexport type Wrapped = Shape\n' +
          "export fun one(): Wrapped = Shape({s = 1})\n",
      ],
      ["/main.hex", 'import { one, Wrapped } from "./mid"\nexport let c: Wrapped = one()\n'],
    ]);

    // A face carries an alias's expansion and never its name, so `/main.hex`
    // names `Shape` under no spelling whatever: it binds `Wrapped`, and rung 2
    // owns the names an import *binds*. The `Wrapped` row goes with the same
    // rule — no face mentions it — which is one of the three text changes §14.3
    // names as expected.
    expect(declarations(compiled)).toBe(
      'import type { Shape } from "./shape.js";\n' +
        "export declare const c: Shape;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("the minted edge is reported, and adds no JavaScript import", async () => {
    // §2.4's Reachability, extended by §14.3: rung 5's edges reach modules the
    // source never imported at all, and they count toward what gets emitted
    // exactly as the inventory's do — or the declarations import from a file
    // that was never written. What is pinned here is the *report*, which is what
    // `compileProject`'s walk consumes.
    //
    // No shape reaches the walk today: every non-injected module is emitted
    // unconditionally, and a user module's prelude inventory carries every
    // prelude nominal it could name, so a minted line's target is always a
    // module that was going to be written anyway. The channel is wired for the
    // rule rather than for a case, and this is the half of it that can be seen.
    const compiled = project([
      ["/shape.hex", "export record Shape = {s: Int}\n"],
      [
        "/mid.hex",
        'import { Shape } from "./shape"\nexport type Wrapped = Shape\n' +
          "export fun one(): Wrapped = Shape({s = 1})\n",
      ],
      ["/main.hex", 'import { one, Wrapped } from "./mid"\nexport let c: Wrapped = one()\n'],
    ]);

    expect(emitted(compiled, "/main.hex").declarations.mintedTypeImports).toEqual(["./shape"]);
    expect(compiled.modules.map(({ source }) => source.path)).toContain("/shape.hex");
    // Declaration-side only: no JavaScript import is added, which would be a
    // load-order dependency the source never wrote (the #263 doctrine).
    expect(emitted(compiled, "/main.hex").javascript.text).not.toContain("./shape.js");
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("minted lines are ordered by home specifier, then by imported name", async () => {
    const compiled = project([
      ["/a.hex", "export record Alpha = {n: Int}\nexport record Beta = {n: Int}\n"],
      ["/b.hex", "export record Gamma = {n: Int}\n"],
      [
        "/mid.hex",
        'import { Alpha, Beta } from "./a"\nimport { Gamma } from "./b"\n' +
          "export type A = Alpha\nexport type B = Beta\nexport type G = Gamma\n" +
          "export fun mk(g: G, b: B, a: A): Int = 0\n",
      ],
      [
        "/main.hex",
        'import { mk, A, B, G } from "./mid"\nexport fun use(g: G, b: B, a: A): Int = mk(g, b, a)\n',
      ],
    ]);

    // Rung 5 has no inventory to follow and must not fall back on first
    // reference: the source above reverses the order deliberately.
    expect(declarations(compiled)).toBe(
      'import type { Alpha } from "./a.js";\n' +
        'import type { Beta } from "./a.js";\n' +
        'import type { Gamma } from "./b.js";\n' +
        "export declare function use(g: Gamma, b: Beta, a: Alpha): number;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("where the alias is contested, the alias yields", () => {
  test("a qualified face beside a same-spelled declaration takes `Point_1`", async () => {
    const compiled = project([
      POINT,
      [
        "/main.hex",
        'import module Point from "./point"\n' +
          "export record Point = {n: Int}\n" +
          "export fun mine(p: Point): Int = p.n\n" +
          "export fun theirs(p: Point.Point): Float = p.x\n",
      ],
    ]);

    // Rung 1's declaration keeps the bare spelling — it is, or may become, the
    // module's public face — and the alias takes the collision-only `_1` its
    // emitted-JavaScript counterpart takes, being a source name stepping aside
    // rather than a spelling the compiler minted.
    expect(declarations(compiled)).toBe(
      'import type * as Point_1 from "./point.js";\n' +
        "export type Point = { n: number };\n" +
        "export declare const Point: (record: { n: number }) => Point;\n" +
        "export declare function mine(p: Point): number;\n" +
        "export declare function theirs(p: Point_1.Point): number;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("one identity at two rungs carries two lines and two spellings", async () => {
    const compiled = project([
      POINT,
      [
        "/main.hex",
        'import module Point from "./point"\n' +
          "export fun qualified(p: Point.Point): Float = p.x\n" +
          "export fun bare(p: Point): Float = p.x\n",
      ],
    ]);

    // One seat is qualified and the other is the companion fallback's bare one,
    // so one identity reaches both rung 3 and rung 5. The alias is uncontested
    // here and keeps its own spelling; the minted local moves instead, the
    // alias's line now being present to contest it. TypeScript binds both to the
    // same declaration, which is what the `tsc` run below establishes.
    expect(declarations(compiled)).toBe(
      'import type { Point as Point_1 } from "./point.js";\n' +
        'import type * as Point from "./point.js";\n' +
        "export declare function qualified(p: Point.Point): number;\n" +
        "export declare function bare(p: Point_1): number;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("the opaque brands are in every universe the file probes", () => {
  // The brands are emitted — `declare const <Name>Brand: unique symbol` (§5) —
  // and they used to be excluded from the collision universe on the ground that
  // no compiler-chosen spelling could end in `Brand`. Rung 5 killed that ground:
  // its candidate is a *foreign type's own name*, which can end in anything.
  test("a minted local does not land on a brand", async () => {
    const compiled = project([
      ["/lib.hex", "export record PointBrand = {n: Int}\n"],
      [
        "/mid.hex",
        'import { PointBrand } from "./lib"\nexport type W = PointBrand\n' +
          "export fun one(): W = PointBrand({n = 1})\n",
      ],
      [
        "/main.hex",
        'import { one, W } from "./mid"\nopaque record Point = {x: Int}\n' +
          "export fun mk(): Point = Point({x = 1})\nexport let w: W = one()\n",
      ],
    ]);

    // Two probes over two sets is the hazard, and it bit here on a program with
    // no Hexagon diagnostic at all: TS2440 plus TS2395 twice. The brand is
    // settled first — it is derived from a declaration, so it is as much a
    // property of the module — and the minted local moves around it.
    expect(declarations(compiled)).toBe(
      'import type { PointBrand as PointBrand_1 } from "./lib.js";\n' +
        "declare const PointBrand: unique symbol;\n" +
        "export type Point = { readonly [PointBrand]: never };\n" +
        "export declare function mk(): Point;\n" +
        "export declare const w: PointBrand_1;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("an unexported extern type's brand contests nothing", async () => {
    const compiled = project([
      ["/lib.hex", "export record Row = {n: Int}\n"],
      [
        "/main.hex",
        'import module HandleBrand from "./lib"\nextern from "./host.js"\n' +
          "    type Handle\n" +
          "export fun row(r: HandleBrand.Row): Int = r.n\n",
      ],
    ]);

    // `opaqueBrandNames` mints a brand for *every* extern type, the preview
    // declaring them all; `emit` writes the `declare const` only for an exported
    // one. Feeding the map's whole range to the universe claimed a name the file
    // does not contain and moved the alias to `HandleBrand_1` for it — the same
    // over-claim the gated-alias rule prevents, one condition over.
    expect(declarations(compiled)).toBe(
      'import type * as HandleBrand from "./lib.js";\n' +
        "export declare function row(r: HandleBrand.Row): number;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a namespace alias spelled like a brand yields to it", async () => {
    const compiled = project([
      ["/lib.hex", "export record Row = {n: Int}\n"],
      [
        "/main.hex",
        'import module PointBrand from "./lib"\nopaque record Point = {x: Int}\n' +
          "export fun mk(): Point = Point({x = 1})\n" +
          "export fun row(r: PointBrand.Row): Int = r.n\n",
      ],
    ]);

    // The other direction of the same omission: a brand is a contestant of the
    // alias-yield plan too, and the alias is the one that steps aside — it is
    // internal to the file, and the brand is what an exported face is written
    // in terms of.
    expect(declarations(compiled)).toBe(
      'import type * as PointBrand_1 from "./lib.js";\n' +
        "declare const PointBrand: unique symbol;\n" +
        "export type Point = { readonly [PointBrand]: never };\n" +
        "export declare function mk(): Point;\n" +
        "export declare function row(r: PointBrand_1.Row): number;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  // The brand's *own* probe, the fourth compiler-chosen `.d.ts` spelling and the
  // one the other tests here reach only from the outside. It suffixes the way
  // §2.1's does — `<name>Brand_1`, never `<name>Brand1` (#619): a brand already
  // looks like a type, so it aliases like one.
  test("a declared `PointBrand` pushes the brand to `PointBrand_1`", async () => {
    const compiled = project([
      [
        "/main.hex",
        "export record PointBrand = {n: Int}\nopaque record Point = {x: Int}\n" +
          "export fun mk(): Point = Point({x = 1})\n" +
          "export fun tag(): PointBrand = PointBrand({n = 1})\n",
      ],
    ]);

    expect(declarations(compiled)).toBe(
      "export type PointBrand = { n: number };\n" +
        "export declare const PointBrand: (record: { n: number }) => PointBrand;\n" +
        "declare const PointBrand_1: unique symbol;\n" +
        "export type Point = { readonly [PointBrand_1]: never };\n" +
        "export declare function mk(): Point;\n" +
        "export declare function tag(): PointBrand;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("placement, and one probe for both minting rungs", () => {
  test("the runtime import, then rung 4's lines, then rung 5's, then the module's own", async () => {
    const compiled = project([
      ["/lib.hex", "export record Point = {n: Int}\n"],
      [
        "/mid.hex",
        'import { Point } from "./lib"\nexport type Wrapped = Point\n' +
          "export fun one(): Wrapped = Point({n = 1})\n",
      ],
      ["/other.hex", "export union Color = Red | Green\n"],
      [
        "/main.hex",
        'import { Color } from "./other"\nimport { one, Wrapped } from "./mid"\n' +
          "export fun f(c: Color, w: Wrapped, v: Vector(Int)): Option(Int) = None\n",
      ],
    ]);

    // §2.4's Placement, in one file: the compiler's own lines lead, in the order
    // the section fixes, and a line the module wrote keeps its source seat.
    // `tsc` cannot decide this — an ESM import is legal anywhere at top level —
    // so the order is pinned by the text.
    expect(declarations(compiled)).toBe(
      'import type * as Hex from "./hex.js";\n' +
        'import type { Option } from "./Option.js";\n' +
        'import type { Point } from "./lib.js";\n' +
        'import type { Color } from "./other.js";\n' +
        "export declare function f(c: Color, w: Point, v: Hex.Vector<number>): Option<number>;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a minted local and an inventory local cannot land on each other", async () => {
    const compiled = project([
      ["/lib.hex", "export record Option = {n: Int}\n"],
      [
        "/mid.hex",
        'import { Option as LibOption } from "./lib"\nexport type Held = LibOption\n' +
          "export fun one(): Held = LibOption({n = 1})\n",
      ],
      [
        "/main.hex",
        'import { one, Held } from "./mid"\n' +
          "export let a: Held = one()\nexport let b: Option(Int) = None\n",
      ],
    ]);

    // Rung 4 and rung 5 both mint into one file, and both probe the same
    // universe: whichever is asked first takes the unsuffixed name and the other
    // moves. Two probes over two sets would put one declaration under two names.
    expect(declarations(compiled)).toBe(
      'import type { Option as Option_1 } from "./Option.js";\n' +
        'import type { Option } from "./lib.js";\n' +
        "export declare const a: Option;\n" +
        "export declare const b: Option_1<number>;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("what the sink is not asked", () => {
  test("§2.3's pins are settled first — a qualified `Seq` faces as `Iterable`", async () => {
    const compiled = project([
      ["/lib.hex", "export let one: Int = 1\n"],
      [
        "/main.hex",
        'import module S from "./Seq"\nimport module B from "./Bool"\n' +
          "export fun pass(s: S.Seq(Int), flag: B.Bool): S.Seq(Int) = s\n",
      ],
    ]);

    // A pin governs the face, not the spelling that reached it: neither
    // occurrence imports anything, and no rung ever sees them.
    expect(declarations(compiled)).toBe(
      "export declare function pass(s: Iterable<number>, flag: boolean): Iterable<number>;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a pinned alias contests nothing — being qualified is not being answered", async () => {
    // The universe counts an alias where some occurrence is **answered at rung
    // 3** through it, not merely where one is qualified through it. §2.3's pins
    // settle before the sink is consulted, so `S.Seq(Int)` reaches no rung and
    // `S` reaches no line — and a minted local spelled `S` must therefore stay
    // `S`, against an alias the file does not contain.
    const compiled = project([
      ["/s.hex", "export record S = {n: Int}\n"],
      [
        "/mid.hex",
        'import { S } from "./s"\nexport type W = S\nexport fun one(): W = S({n = 1})\n',
      ],
      [
        "/main.hex",
        'import module S from "./Seq"\nimport { one, W } from "./mid"\n' +
          "export fun pass(x: S.Seq(Int), w: W): W = w\n",
      ],
    ]);

    expect(declarations(compiled)).toBe(
      'import type { S } from "./s.js";\n' +
        "export declare function pass(x: Iterable<number>, w: S): S;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("an alias rung 2 took over contests nothing either", async () => {
    // Rung 2 outranks rung 3, so the named import's local is spelled at the
    // qualified seat too and the alias's line is not owed. The identity decides
    // it, which is why the identity travels with the occurrence.
    const compiled = project([
      ["/lib.hex", "export record Point = {x: Float, y: Float}\n"],
      ["/lib2.hex", "export record Lib = {n: Int}\n"],
      [
        "/mid.hex",
        'import { Lib } from "./lib2"\nexport type W = Lib\nexport fun one(): W = Lib({n = 1})\n',
      ],
      [
        "/main.hex",
        'import module Lib from "./lib"\nimport { Point } from "./lib"\n' +
          'import { one, W } from "./mid"\n' +
          "export fun mk(p: Lib.Point): Lib.Point = p\nexport let w: W = one()\n",
      ],
    ]);

    expect(declarations(compiled)).toBe(
      'import type { Lib } from "./lib2.js";\n' +
        'import type { Point } from "./lib.js";\n' +
        "export declare function mk(p: Point): Point;\n" +
        "export declare const w: Lib;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("an unexported signature's qualifier reaches no face, so it counts for nothing", async () => {
    const compiled = project([
      ["/shape.hex", "export record Shape = {s: Int}\nexport let unit: Int = 1\n"],
      [
        "/main.hex",
        'import module Shape from "./shape"\n' +
          "let hidden(s: Shape.Shape): Int = s.s\n" +
          "export fun width(s: Shape): Int = hidden(s) + Shape.unit\n",
      ],
    ]);

    // The alias counts exactly where the file carries its line, and an
    // unexported binding's signature publishes nothing — so the qualified dot
    // above spells nothing in the `.d.ts`, the alias's line is not written, and
    // the minted local for the exported bare face keeps `Shape`. Counting the
    // written dot would render `Shape_1` against a `Shape` the file does not
    // contain.
    expect(declarations(compiled)).toBe(
      'import type { Shape } from "./shape.js";\n' +
        "export declare function width(s: Shape): number;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a qualifier written inside a body reaches no face either", async () => {
    const compiled = project([
      ["/shape.hex", "export record Shape = {s: Int}\nexport let unit: Int = 1\n"],
      [
        "/main.hex",
        'import module Shape from "./shape"\n' +
          "export fun width(s: Shape): Int =\n" +
          "    let inner: Shape.Shape = s\n" +
          "    inner.s + Shape.unit\n",
      ],
    ]);

    // The same rule one seat further in: a type written inside a body is not a
    // face, however it is spelled.
    expect(declarations(compiled)).toBe(
      'import type { Shape } from "./shape.js";\n' +
        "export declare function width(s: Shape): number;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a prelude identity the source qualified is rung 3's, not rung 4's", async () => {
    const compiled = project([[
      "/main.hex",
      'import module O from "./Option"\nexport fun pick(o: O.Option(Int)): O.Option(Int) = o\n',
    ]]);

    // A take-over of the channel §14.2 established, in the direction §14.2 did
    // not anticipate: rung 3 answered, so the inventory line it would otherwise
    // owe is not written and the face reads `O.Option`.
    expect(declarations(compiled)).toBe(
      'import type * as O from "./Option.js";\n' +
        "export declare function pick(o: O.Option<number>): O.Option<number>;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("a module whose whole `.d.ts` was one dead line", () => {
  test("it becomes `export {};`", async () => {
    const compiled = project([
      ["/lib.hex", "export let one: Int = 1\n"],
      ["/main.hex", 'import module Lib from "./lib"\nlet n: Int = Lib.one\n'],
    ]);

    // The third of §14.3's expected text changes: a module that exports nothing
    // and namespace-imports for terms had a `.d.ts` consisting of that one line,
    // which made the file a module. With the line gone the marker is what says so.
    expect(declarations(compiled)).toBe("export {};\n");
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a named import whose type half no face mentions is left out on the same rule", async () => {
    const compiled = project([
      ["/lib.hex", "export record Point = {n: Int}\n"],
      ["/main.hex", 'import { Point } from "./lib"\nexport let n: Int = Point({n = 1}).n\n'],
    ]);

    expect(declarations(compiled)).toBe("export declare const n: number;\n");
    // The JavaScript still imports the constructor: the two files are decided
    // by different questions.
    expect(emitted(compiled, "/main.hex").javascript.text).toContain(
      'import { Point } from "./lib.js";',
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("rung 5 mints only what its home module exports", () => {
  test("a private nominal in an exported face is refused at its carrier (#621)", async () => {
    // §2.4's satisfiability sentence was fenced to the exported-*binding* route
    // while the checker's boundary rule read only bindings: a record field and a
    // type alias each carried a module-private nominal into the public face with
    // no diagnostic at all, and it reached a *consumer* through the alias whose
    // expansion the face carries. The fence is gone (FFI Part 7 §14.4) — the
    // rule reads every exported carrier, so the program below is refused at
    // both, and no rung is ever asked for an identity its home withholds.
    const compiled = refused(
      [
        [
          "/lib.hex",
          "record Hidden = {n: Int}\nexport record Box = {h: Hidden}\nexport type Exposed = Hidden\n",
        ],
        [
          "/main.hex",
          'import { Box, Exposed } from "./lib"\nexport fun peek(b: Box): Exposed = b.h\n',
        ],
      ],
      [
        "exported record `Box` exposes private type `Hidden`; " +
          "export the type, perhaps opaquely, or keep the record private",
        "exported type alias `Exposed` exposes private type `Hidden`; " +
          "export the type, perhaps opaquely, or keep the alias private",
      ],
    );

    // The guard itself stays exercised, because the emitter still runs over a
    // refused program: rung 5 must decline rather than mint, since the home
    // module does not export the name and `import type { Hidden }` would bind
    // nothing — a worse failure than the unbound name the refusal already owns.
    expect(declarations(compiled)).toBe(
      'import type { Box } from "./lib.js";\n' +
        "export declare function peek(b: Box): Hidden;\n",
    );
    expect(emitted(compiled, "/main.hex").declarations.mintedTypeImports).toEqual([]);
    expect((await typeScriptErrors(declarationSet(compiled))).join("\n"))
      .toContain("main.d.ts(2,39): error TS2304: Cannot find name 'Hidden'.");
  });
});

describe("rung 5 declines a private nominal on every arm of the guard", () => {
  // The record arm is pinned above. Each of the three arms of `nominalHomes`'
  // `exported` condition is its own line of code, and the guard answers for a
  // face the emitter builds over a program the checker refused — which every
  // program here now is (#621). Minting would import a name the home module does
  // not export.
  const CONSUMER = [
    "/main.hex",
    'import { Exposed } from "./lib"\nexport record Wrap = {h: Exposed}\n',
  ] as const;
  const FACE = "export type Wrap = { h: Hidden };\n" +
    "export declare const Wrap: (record: { h: Hidden }) => Wrap;\n";
  const LIB_REFUSALS = [
    "exported record `Box` exposes private type `Hidden`; " +
      "export the type, perhaps opaquely, or keep the record private",
    "exported type alias `Exposed` exposes private type `Hidden`; " +
      "export the type, perhaps opaquely, or keep the alias private",
  ];

  test("a private union", async () => {
    const compiled = refused(
      [
        [
          "/lib.hex",
          "union Hidden = A | B\nexport record Box = {h: Hidden}\nexport type Exposed = Hidden\n",
        ],
        CONSUMER,
      ],
      LIB_REFUSALS,
    );

    expect(declarations(compiled)).toBe(FACE);
    expect(emitted(compiled, "/main.hex").declarations.mintedTypeImports).toEqual([]);
    expect((await typeScriptErrors(declarationSet(compiled))).join("\n"))
      .toContain("main.d.ts(1,25): error TS2304: Cannot find name 'Hidden'.");
  });

  test("a private extern type", () => {
    // The same two refusals as the union arm, and for the same reason: §4.3's
    // check is local on every arm (#629), so `lib`'s private type is refused at
    // `lib`'s two carriers and the consumer — which can neither name the type
    // nor export it — is told nothing. The emitter's guard is what this test
    // watches, and it declines the mint here exactly as it does above.
    const compiled = refused(
      [
        [
          "/lib.hex",
          'extern from "./host.js"\n    type Hidden\n' +
            "export record Box = {h: Hidden}\nexport type Exposed = Hidden\n",
        ],
        CONSUMER,
      ],
      LIB_REFUSALS,
    );

    expect(declarations(compiled)).toBe(FACE);
    expect(emitted(compiled, "/main.hex").declarations.mintedTypeImports).toEqual([]);
  });
});

describe("the written signature is the face's spelling, at every published seat", () => {
  // FFI Part 7 §14.3: a qualifier names a *binding*, so no pass that rewrites
  // types preserves one, and at two seats the published node is the value's
  // rather than the annotation's — an annotated `let`, which unifies two
  // concrete nominal nodes and keeps neither's, and a function's **return**,
  // which keeps its body's. At both the written qualifier **wins outright**: it
  // replaces what the inferred node carries, because an inferred one is a body's
  // or a private helper's internal spelling choice and publishing it would show
  // the author a spelling written at a seat they cannot see.
  //
  // `/a.hex` and `/b.hex` export a record of the same name on purpose: the two
  // spellings then name two different types, so a face that took the wrong one
  // would still compile and only the text can tell.
  const ROWS: readonly (readonly [string, string])[] = [
    ["/a.hex", "export record Row = {n: Int}\nexport let mk: Row = Row({n = 1})\n"],
    ["/b.hex", "export record Row = {s: Int}\nexport let mk: Row = Row({s = 2})\n"],
  ];
  const ONE = ["/row.hex", "export record Row = {n: Int}\nexport let mk: Row = Row({n = 1})\n"] as const;

  test("a function's return annotation outranks its body", async () => {
    const compiled = project([
      ...ROWS,
      [
        "/main.hex",
        'import module A from "./a"\nimport module B from "./b"\n' +
          "export fun f(): A.Row =\n    let inner: B.Row = B.mk\n    A.mk\n",
      ],
    ]);

    // `B`'s line is not carried at all: nothing this file publishes is spelled
    // through it, the body being a seat the reader of the `.d.ts` cannot see.
    expect(declarations(compiled)).toBe(
      'import type * as A from "./a.js";\n' + "export declare function f(): A.Row;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("an annotated `let`'s annotation outranks its value", async () => {
    const compiled = project([
      ...ROWS,
      [
        "/main.hex",
        'import module A from "./a"\nimport module B from "./b"\n' +
          "let helper(): B.Row = B.mk\n" +
          "export let r: A.Row = A.mk\nexport let unused: Int = helper().s\n",
      ],
    ]);

    expect(declarations(compiled)).toBe(
      'import type * as A from "./a.js";\n' +
        "export declare const r: A.Row;\n" +
        "export declare const unused: number;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a bare written return wins **as bare** — replace, not fill", async () => {
    const compiled = project([
      ONE,
      [
        "/main.hex",
        'import module Row from "./row"\n' +
          "export fun f(): Row =\n    let inner: Row.Row = Row.mk\n    inner\n",
      ],
    ]);

    // The row that makes replace-not-fill load-bearing. The seat is written bare
    // — Modules §5.1 rule 2's companion fallback puts the member's own name in
    // scope — and the *absence* of a qualifier is the author's spelling as much
    // as a present one is. A fill would publish the body's `Row.Row`; a replace
    // publishes bare `Row` and mints its import, and the alias's line is not
    // owed by anything.
    expect(declarations(compiled)).toBe(
      'import type { Row } from "./row.js";\n' + "export declare function f(): Row;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a private helper's spelling does not reach the face", async () => {
    const compiled = project([
      ONE,
      [
        "/main.hex",
        'import module Row from "./row"\n' +
          "let helper(r: Row.Row): Row.Row = r\nexport let h: (Row) -> Row = helper\n",
      ],
    ]);

    expect(declarations(compiled)).toBe(
      'import type { Row } from "./row.js";\n' +
        "export declare const h: (arg0: Row) => Row;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("an extern type follows the same rule, at both seats", async () => {
    const host: readonly [string, string] = [
      "/host.hex",
      'extern from "./host.js"\n    export type Handle\n    export fun make(): Handle\n',
    ];
    const aliases = 'import module Handle from "./host"\nimport module B from "./host"\n';

    // The family's sixth row. An extern type is a nominal like the other two and
    // takes the same seat, so the rule has to hold on its arm as well: the
    // exported seats below are written bare — reached by Modules §5.1 rule 2's
    // companion fallback, the alias being spelled `Handle` — while the bodies
    // reach for `B.Handle`. A fill would publish the body's qualifier and carry
    // `B`'s line; a replace publishes bare and mints.
    const returned = project([
      host,
      [
        "/main.hex",
        aliases + "export fun h(): Handle =\n    let inner: B.Handle = B.make!()\n    inner\n",
      ],
    ]);
    expect(declarations(returned)).toBe(
      'import type { Handle } from "./host.js";\n' +
        "/** Hexagon: `() ->! Handle.Handle` */\n" +
        "export declare function h(): Handle;\n",
    );

    const bound = project([
      host,
      [
        "/main.hex",
        aliases + "let helper(): B.Handle = B.make!()\nexport let h: Handle = helper!()\n",
      ],
    ]);
    expect(declarations(bound)).toBe(
      'import type { Handle } from "./host.js";\n' + "export declare const h: Handle;\n",
    );

    // The `Hexagon:` doc line above says `Handle.Handle` and the TypeScript face
    // says `Handle`. That is not a disagreement to fix: §2.4's Scope puts the
    // generated Hexagon-side face documentation outside this section — it is a
    // second renderer, spelling Hexagon types for a Hexagon reader — and pinning
    // the divergence here is what keeps it from being repaired by accident.
    expect(await typeScriptErrors(declarationSet(returned))).toEqual([]);
    expect(await typeScriptErrors(declarationSet(bound))).toEqual([]);
  });

  test("an extern type's written qualifier survives, the control", async () => {
    const compiled = project([
      [
        "/host.hex",
        'extern from "./host.js"\n    export type Handle\n    export fun make(): Handle\n',
      ],
      ["/main.hex", 'import module A from "./host"\nexport fun h(): A.Handle = A.make!()\n'],
    ]);

    expect(declarations(compiled)).toBe(
      'import type * as A from "./host.js";\n' +
        "/** Hexagon: `() ->! A.Handle` */\n" +
        "export declare function h(): A.Handle;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a written qualified seat keeps its qualifier, helper or no helper", async () => {
    const compiled = project([
      ...ROWS,
      [
        "/main.hex",
        'import module A from "./a"\nimport module B from "./b"\n' +
          "let helper(r: B.Row): B.Row = r\nexport let h: (B.Row) -> B.Row = helper\n" +
          "export fun p(r: A.Row): Int = r.n\n",
      ],
    ]);

    // The control for the four above: replacing is not erasing. A parameter list
    // keeps its annotations by construction, and a written qualified seat
    // publishes what it wrote.
    expect(declarations(compiled)).toBe(
      'import type * as A from "./a.js";\n' +
        'import type * as B from "./b.js";\n' +
        "export declare const h: (arg0: B.Row) => B.Row;\n" +
        "export declare function p(r: A.Row): number;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("the face walk counts every arm `emit` renders, and no other", () => {
  // `renderedFaceTypes` is a hand-maintained copy of `emit`'s conditions, which
  // §2.4 warns against in general and requires here. Every arm is pinned, and
  // pinned in the direction that matters: a face the walk *invents* moves a
  // minted local aside for a name the file does not contain, which is the
  // failure the criterion exists to prevent, while one it misses only costs a
  // qualified spelling.
  //
  // The "must not count" specimens all mint a local spelled like the alias, so
  // an invented face shows up as `S1` against an `S` the file does not carry.
  const LIB = ["/lib.hex", "export record Point = {x: Int}\n"] as const;
  const MINT: readonly (readonly [string, string])[] = [
    ["/s.hex", "export record S = {n: Int}\n"],
    [
      "/mid.hex",
      'import { S } from "./s"\nexport type W = S\nexport fun one(): W = S({n = 1})\n',
    ],
  ];
  const HEAD = 'import module S from "./lib"\nimport { one, W } from "./mid"\n';
  const TAIL = 'import type { S } from "./s.js";\n';

  test("a constrained export with no fundamental editions renders no face", async () => {
    const compiled = project([
      LIB,
      ...MINT,
      [
        "/main.hex",
        "constraint Render<a> =\n    render(value: a): String\n" +
          'honor Render<Int> =\n    render(value) = "i"\n' +
          HEAD +
          "export let describe<a: Render>(p: S.Point, value: a): String = render(value)\n" +
          "export let w: W = one()\n",
      ],
    ]);

    // A constraint of the user's own admits no editions (Part 8 §3.2), so `emit`
    // writes nothing for `describe` — and its qualified parameter therefore
    // spells nothing in the file. Testing `item.exported` alone counted it.
    expect(declarations(compiled)).toBe(TAIL + "export declare const w: S;\n");
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a constrained exported `let` whose value is not a lambda renders none either", async () => {
    const compiled = project([
      LIB,
      ...MINT,
      [
        "/main.hex",
        HEAD +
          "let helper<a: Show>(p: S.Point, value: a): String = show(value)\n" +
          "export let describe<a: Show>: (S.Point, a) -> String = helper\n" +
          "export let w: W = one()\n",
      ],
    ]);

    expect(declarations(compiled)).toBe(TAIL + "export declare const w: S;\n");
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("the control: a constrained export that does render editions counts", async () => {
    const compiled = project([
      LIB,
      [
        "/main.hex",
        'import module S from "./lib"\n' +
          "export let describe<a: Show>(p: S.Point, value: a): String = show(value)\n",
      ],
    ]);
    const text = declarations(compiled);

    expect(text).toContain('import type * as S from "./lib.js";');
    expect(text).toContain("export declare function describeInt(p: S.Point, value: number): string;");
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("an opaque record's fields render no face", async () => {
    const compiled = project([
      LIB,
      ...MINT,
      ["/main.hex", HEAD + "opaque record Box = {p: S.Point}\nexport let w: W = one()\n"],
    ]);

    // §5's brand is the face; the representation is not published.
    expect(declarations(compiled)).toBe(
      TAIL +
        "declare const BoxBrand: unique symbol;\n" +
        "export type Box = { readonly [BoxBrand]: never };\n" +
        "export declare const w: S;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("an opaque union's payloads render no face", async () => {
    const compiled = project([
      LIB,
      ...MINT,
      ["/main.hex", HEAD + "opaque union Held = Wrap(p: S.Point)\nexport let w: W = one()\n"],
    ]);

    expect(declarations(compiled)).toBe(
      TAIL +
        "declare const HeldBrand: unique symbol;\n" +
        "export type Held = { readonly [HeldBrand]: never };\n" +
        "export declare const w: S;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("a **private** union's payloads render no face, and do not count", async () => {
    const compiled = project([
      LIB,
      [
        "/main.hex",
        'import module Lib from "./lib"\nunion Holder = Held(p: Lib.Point)\n' +
          "export let n: Int = 1\n",
      ],
    ]);

    // This was the one arm with no `exported` test — the union arm pushed its
    // row for every union, so a private union's whole representation was
    // published in the shipped file, and its payloads counted for the alias
    // line. #621 gives the arm the gate every other arm has (Modules §11.4: a
    // private type gets no line of any kind), so the face is not rendered, the
    // alias it would have qualified through is not written, and the module's
    // one export is the whole file.
    expect(declarations(compiled)).toBe("export declare const n: number;\n");
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("an exception's payloads count", async () => {
    const compiled = project([
      LIB,
      ["/main.hex", 'import module Lib from "./lib"\nexport exception Bad(p: Lib.Point)\n'],
    ]);
    const text = declarations(compiled);

    expect(text).toContain('import type * as Lib from "./lib.js";');
    expect(text).toContain("export declare function Bad(p: Lib.Point): Bad;");
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("an exported extern row counts", async () => {
    const compiled = project([
      LIB,
      [
        "/main.hex",
        'import module Lib from "./lib"\nextern from "./host.js"\n' +
          "    export fun take(p: Lib.Point): Int\n",
      ],
    ]);
    const text = declarations(compiled);

    expect(text).toContain('import type * as Lib from "./lib.js";');
    expect(text).toContain("export declare function take(p: Lib.Point): number;");
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });

  test("an exported type alias counts", async () => {
    const compiled = project([
      LIB,
      ["/main.hex", 'import module Lib from "./lib"\nexport type Alias = Lib.Point\n'],
    ]);

    expect(declarations(compiled)).toBe(
      'import type * as Lib from "./lib.js";\n' + "export type Alias = Lib.Point;\n",
    );
    expect(await typeScriptErrors(declarationSet(compiled))).toEqual([]);
  });
});

describe("the harness would notice", () => {
  test("each pre-fix spelling is rejected — the controls that make the checks real", async () => {
    expect(
      (await typeScriptErrors({ "faces.d.ts": "export declare const c: Shape;\n" })).join("\n"),
    ).toContain("error TS2304");

    const collision = await typeScriptErrors({
      "point.d.ts": "export type Point = { x: number };\n" +
        "export declare const Point: (record: { x: number }) => Point;\n",
      "faces.d.ts": 'import type * as Point from "./point.js";\n' +
        "export type Point = { n: number };\n" +
        "export declare const Point: (record: { n: number }) => Point;\n",
    });
    expect(collision.join("\n")).toContain("error TS2440");

    const namespaceAsType = await typeScriptErrors({
      "point.d.ts": "export type Point = { x: number };\n",
      "faces.d.ts": 'import type * as Shape from "./point.js";\n' +
        "export declare const c: Shape;\n",
    });
    expect(namespaceAsType.join("\n")).toContain("error TS2709");
  });
});
