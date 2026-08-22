import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/**
 * Conformance for the emitted spelling of a **namespace alias a declaration
 * contests** (#569; Modules §11.2).
 *
 * Modules §5.2 makes `import * as Point from "./point"` beside a declared
 * `Point` legal — it is what makes the companion idiom a rule rather than a
 * prelude coincidence — and the checker reports nothing for it. Two Hexagon
 * namespaces must therefore reach JavaScript as two bindings, and until this
 * landed they reached it as one: `import * as Point` beside `const Point`,
 * which is `SyntaxError: Identifier 'Point' has already been declared` before
 * the module runs a line.
 *
 * §11.2 already owns the rule — "emitted-name collisions are the emitter's
 * ordinary renaming problem" — so what is pinned here is which name moves and
 * which stays:
 *
 * - The **declaration keeps the bare spelling**. It may be exported, and an
 *   export name is the module's public face; `export { }` lines are untouched.
 * - The **alias moves**, taking the collision-only suffix from `_1` (#425). It
 *   is importer-internal: it reaches the output on its own `import` line and in
 *   the qualified uses that line serves, and nowhere else.
 * - **Nothing moves without a collision.** The uncontested emission is the text
 *   it always was, and a contestant is a name the emitted file really binds — a
 *   type-only import contests nothing, because the `import { }` line drops it.
 * - **The suffix lands on nothing.** Including on the other alias, which never
 *   collides with this one but can be standing where the probe would mint.
 *
 * Every case that runs is executed rather than only read: the defect was a load
 * failure, and a text pin alone would not have caught it.
 */

/** The companion module Modules §5.3's example is written against. */
const POINT = [
  "/point.hex",
  "export opaque record Point = {x: Float, y: Float}\n" +
    "export fun make(x: Float, y: Float): Point = Point({x = x, y = y})\n" +
    "export fun getX(p: Point): Float = p.x\n",
] as const;

/** #569's repro: the alias, the same-spelled record, and a use of each. */
const COLLIDING = [
  "/main.hex",
  'import * as Point from "./point"\n' +
    "export record Point = {n: Int}\n" +
    "export fun mine(p: Point): Int = p.n\n" +
    "export let far: Float = Point.getX(Point.make(1.0, 2.0))\n",
] as const;

/** One module's emitted JavaScript. */
function javascript(
  files: readonly (readonly [string, string])[],
  path = "/main.hex",
): string {
  const project = compileFiles(files);
  expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
  return project.modules.find(({ source }) => source.path === path)!.javascript.text;
}

describe("the alias yields the plain name to the declaration", () => {
  test("the repro loads and both namespaces answer", async () => {
    const main = await runProject([POINT, COLLIDING]);
    // Through the alias: `./point`'s opaque record, made and read there.
    expect(main.far).toBe(1.0);
    // Through the declaration: this module's own record, made by its exported
    // constructor and read by its own function.
    const construct = main.Point as (record: { n: number }) => unknown;
    expect((main.mine as (p: unknown) => number)(construct({ n: 5 }))).toBe(5);
  });

  test("the import line moves and nothing else does", () => {
    expect(javascript([POINT, COLLIDING])).toBe(
      'import * as Point_1 from "./point.js";\n' +
        "const Point = __record => __record;\n" +
        "function mine(p) {\n" +
        "  return p.n;\n" +
        "}\n" +
        "const far = Point_1.getX(Point_1.make(1.0, 2.0));\n" +
        "export { Point };\n" +
        "export { mine };\n" +
        "export { far };\n",
    );
  });
});

describe("the rename is collision-only", () => {
  test("an uncontested alias keeps its spelling", () => {
    expect(javascript([POINT, [
      "/main.hex",
      'import * as Point from "./point"\n' +
        "export let far: Float = Point.getX(Point.make(1.0, 2.0))\n",
    ]])).toBe(
      'import * as Point from "./point.js";\n' +
        "const far = Point.getX(Point.make(1.0, 2.0));\n" +
        "export { far };\n",
    );
  });

  test("only the contested alias of two moves", () => {
    const emitted = javascript([POINT, ["/other.hex", "export fun twice(n: Int): Int = n + n\n"], [
      "/main.hex",
      'import * as Point from "./point"\n' +
        'import * as Other from "./other"\n' +
        "export record Point = {n: Int}\n" +
        "export let far: Float = Point.getX(Point.make(1.0, 2.0))\n" +
        "export let four: Int = Other.twice(2)\n",
    ]]);
    expect(emitted).toContain('import * as Point_1 from "./point.js";');
    expect(emitted).toContain('import * as Other from "./other.js";');
    expect(emitted).toContain("const four = Other.twice(2);");
  });
});

describe("a named import's local contests the spelling the same way", () => {
  test("the alias moves and the imported name is bound once", async () => {
    // The sibling shape in `companion-fallback.test.ts` ("a named import of a
    // differently-spelled type wins the same way"), which the checker also
    // accepts: the alias is contested by an import's local rather than by a
    // declaration, and the emitted collision was the same one.
    //
    // The alias yields here for a *different* reason than it does against a
    // declaration, and the emitted text below says so — there is no `export
    // { Point }` in it, so neither contestant is anybody's public face. What
    // decides it is the mechanism: moving the alias is the rename §11.2 already
    // licenses, while moving the named import would mean emitting `import
    // { Point as Point_1 }` — a second observable emitter choice, of the kind
    // the ruling declined.
    const files = [POINT, ["/other.hex", "export record Point = {n: Int}\n"], [
      "/main.hex",
      'import * as Point from "./point"\n' +
        'import { Point } from "./other"\n' +
        "export fun mine(p: Point): Int = p.n\n" +
        "export let far: Float = Point.getX(Point.make(1.0, 2.0))\n",
    ]] as const;
    expect(javascript(files)).toBe(
      'import * as Point_1 from "./point.js";\n' +
        'import { Point } from "./other.js";\n' +
        "function mine(p) {\n" +
        "  return p.n;\n" +
        "}\n" +
        "const far = Point_1.getX(Point_1.make(1.0, 2.0));\n" +
        "export { mine };\n" +
        "export { far };\n",
    );
    const main = await runProject(files);
    expect(main.far).toBe(1.0);
  });
});

describe("a contestant that binds nothing in JavaScript is no contestant", () => {
  // A **type-only** named import crosses in the `.d.ts` and nowhere else: the
  // emitted `import { }` line drops it, so there is no second binding of the
  // spelling and nothing for the alias to move away from. The three shapes are
  // the three ways a name arrives type-only — an imported `type` alias, an
  // imported opaque record's type, an imported union's type name — and each is
  // measured against the same program with the same alias, so what the pin
  // reads is the whole of the difference.
  const LIB = ["/lib.hex", "export fun twice(n: Int): Int = n + n\n"] as const;

  test("an imported `type` alias leaves the alias alone", () => {
    expect(javascript([LIB, ["/types.hex", "export type Lib = Int\n"], [
      "/main.hex",
      'import * as Lib from "./lib"\n' +
        'import { Lib } from "./types"\n' +
        "export let four: Lib = Lib.twice(2)\n",
    ]])).toBe(
      'import * as Lib from "./lib.js";\n' +
        "const four = Lib.twice(2);\n" +
        "export { four };\n",
    );
  });

  test("an imported opaque record's type leaves the alias alone", () => {
    expect(javascript([LIB, ["/op.hex",
      "export opaque record Lib = {n: Int}\n" +
        "export fun make(n: Int): Lib = Lib({n = n})\n",
    ], [
      "/main.hex",
      'import * as Lib from "./lib"\n' +
        'import { Lib, make } from "./op"\n' +
        "export let one: Lib = make(1)\n" +
        "export let four: Int = Lib.twice(2)\n",
    ]])).toBe(
      'import * as Lib from "./lib.js";\n' +
        'import { make } from "./op.js";\n' +
        "const one = make(1);\n" +
        "const four = Lib.twice(2);\n" +
        "export { one };\n" +
        "export { four };\n",
    );
  });

  test("an imported union's type name leaves the alias alone", () => {
    expect(javascript([LIB, ["/u.hex", "export union Lib =\n    | Red\n    | Blue\n"], [
      "/main.hex",
      'import * as Lib from "./lib"\n' +
        'import { Lib, Red } from "./u"\n' +
        "export let colour: Lib = Red\n" +
        "export let four: Int = Lib.twice(2)\n",
    ]])).toBe(
      'import * as Lib from "./lib.js";\n' +
        'import { Red } from "./u.js";\n' +
        "const colour = Red;\n" +
        "const four = Lib.twice(2);\n" +
        "export { colour };\n" +
        "export { four };\n",
    );
  });

  test("the control: an imported record constructor does move it", () => {
    // Same alias, same three lines of shape, and the import now brings a name
    // the emitted line really binds. Without this the three cases above would
    // pass on an emitter that had simply stopped renaming.
    expect(javascript([LIB, ["/other.hex", "export record Lib = {n: Int}\n"], [
      "/main.hex",
      'import * as Lib from "./lib"\n' +
        'import { Lib } from "./other"\n' +
        "export let boxed: Int = (Lib({n = 3})).n\n" +
        "export let four: Int = Lib.twice(2)\n",
    ]])).toBe(
      'import * as Lib_1 from "./lib.js";\n' +
        'import { Lib } from "./other.js";\n' +
        "const boxed = { n: 3 }.n;\n" +
        "const four = Lib_1.twice(2);\n" +
        "export { boxed };\n" +
        "export { four };\n",
    );
  });
});

describe("the suffix probes past what the module already binds", () => {
  test("a second alias standing on the mint is stepped over", async () => {
    // Two aliases never *collide* — same-spelled ones are a source error — but
    // the second can be sitting on the spelling this probe is about to mint. A
    // probe that avoided only the declarations would answer `Point_1` here and
    // emit two `import * as Point_1` lines: #569's own failure, one alias over,
    // which is why the load is what this pin asserts.
    const files = [POINT, ["/point1.hex", "export fun twice(n: Int): Int = n + n\n"], [
      "/main.hex",
      'import * as Point from "./point"\n' +
        'import * as Point_1 from "./point1"\n' +
        "export record Point = {n: Int}\n" +
        "export let far: Float = Point.getX(Point.make(1.0, 2.0))\n" +
        "export let four: Int = Point_1.twice(2)\n",
    ]] as const;
    // The load runs before the text is read, so a probe that answered `Point_1`
    // fails here as the `SyntaxError` it really is rather than as a diff.
    const main = await runProject(files);
    expect(main.far).toBe(1.0);
    expect(main.four).toBe(4);
    const emitted = javascript(files);
    expect(emitted).toContain('import * as Point_2 from "./point.js";');
    expect(emitted).toContain('import * as Point_1 from "./point1.js";');
    expect(emitted).toContain("const far = Point_2.getX(Point_2.make(1.0, 2.0));");
  });

  test("an occupied `_1` is stepped over", async () => {
    const files = [POINT, [
      "/main.hex",
      'import * as Point from "./point"\n' +
        "export record Point = {n: Int}\n" +
        "export record Point_1 = {k: Int}\n" +
        "export let far: Float = Point.getX(Point.make(1.0, 2.0))\n",
    ]] as const;
    expect(javascript(files)).toContain('import * as Point_2 from "./point.js";');
    const main = await runProject(files);
    expect(main.far).toBe(1.0);
  });
});

describe("every qualified use the alias serves follows it", () => {
  test("a constructor reached through a contested alias still constructs", async () => {
    const files = [
      ["/shape.hex", "export union Shape =\n    | Circle(r: Float)\n    | Square(s: Float)\n"],
      ["/main.hex",
        'import * as Shape from "./shape"\n' +
          "export record Shape = {n: Int}\n" +
          "export fun radius(s: Shape.Shape): Float =\n" +
          "    match s\n" +
          "        Shape.Circle(r) => r\n" +
          "        Shape.Square(side) => side\n" +
          "export let round: Float = radius(Shape.Circle(2.0))\n" +
          "export let boxed: Int = (Shape({n = 3})).n\n"],
    ] as const;
    expect(javascript(files)).toContain("const round = radius(Shape_1.Circle(2.0));");
    const main = await runProject(files);
    expect(main.round).toBe(2.0);
    expect(main.boxed).toBe(3);
  });
});
