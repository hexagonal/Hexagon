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
 *   it always was.
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
    // declaration, and the emitted collision was the same one. The alias yields
    // for the same reason — it is the only one of the two that is nobody's
    // face, here or in the module the name came from.
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

describe("the suffix probes past what the module already binds", () => {
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
