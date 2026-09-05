import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/**
 * Conformance for the emitted spelling of a **namespace alias a declaration
 * contests** (#569; Modules §11.2).
 *
 * Modules §5.2 makes `import Point` beside a declared
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
  "module Point\n\n" + "opaque record Point = {x: Float, y: Float}\n" +
    "export fun make(x: Float, y: Float): Point = Point({x = x, y = y})\n" +
    "export fun getX(p: Point): Float = p.x\n",
] as const;

/** #569's repro: the alias, the same-spelled record, and a use of each. */
const COLLIDING = [
  "/main.hex",
  "module Main\n\n" + 'import Point\n' +
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
      'import * as Point_1 from "./Point.js";\n' +
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
      "module Main\n\n" + 'import Point\n' +
        "export let far: Float = Point.getX(Point.make(1.0, 2.0))\n",
    ]])).toBe(
      'import * as Point from "./Point.js";\n' +
        "const far = Point.getX(Point.make(1.0, 2.0));\n" +
        "export { far };\n",
    );
  });

  test("only the contested alias of two moves", () => {
    const emitted = javascript([POINT, ["/other.hex", "module Other\n\n" + "export fun twice(n: Int): Int = n + n\n"], [
      "/main.hex",
      "module Main\n\n" + 'import Point\n' +
        'import Other\n' +
        "export record Point = {n: Int}\n" +
        "export let far: Float = Point.getX(Point.make(1.0, 2.0))\n" +
        "export let four: Int = Other.twice(2)\n",
    ]]);
    expect(emitted).toContain('import * as Point_1 from "./Point.js";');
    expect(emitted).toContain('import * as Other from "./Other.js";');
    expect(emitted).toContain("const four = Other.twice(2);");
  });
});

// #762 retired "a named import's local contests the spelling the same way":
// a named import bound a term-namespace local of its own, which a module
// alias of the same spelling could contest exactly as a declaration does. No
// import binds anything but its alias any more (Modules §3.2), so the alias's
// only remaining contestants are declarations — the block above already pins
// that shape (`COLLIDING`), under the mechanism itself rather than under two
// spellings of the same "an import brought a local" story.

describe("a contestant that binds nothing in JavaScript is no contestant", () => {
  // A **type** declaration crosses in the `.d.ts` and nowhere else: it never
  // emits a JavaScript binding, so it is not a second binding of the spelling
  // and there is nothing for the alias to move away from. #762 retired the
  // three ways a *named import* used to arrive type-only (a type alias, an
  // opaque record's type, a union's type name) — every one of them was a
  // distinction the old resolver's import machinery drew and the checker's
  // JS-binding count then had to answer for separately. Modules §3.2's own
  // replacement, a local `type` alias (rule 2), collapses all three into one
  // declaration shape that erases at emission regardless of what it names —
  // so one pin now carries what three did.
  const LIB = ["/lib.hex", "module Lib\n\n" + "export fun twice(n: Int): Int = n + n\n"] as const;
  const TYPES = ["/types.hex", "module Types\n\n" + "export type Lib = Int\n"] as const;

  test("a same-spelled `type` alias leaves the alias alone", () => {
    expect(javascript([LIB, TYPES, [
      "/main.hex",
      "module Main\n\n" + 'import Lib\n' +
        'import Types\n' +
        "type Lib = Types.Lib\n" +
        "export let four: Lib = Lib.twice(2)\n",
    ]])).toBe(
      // The blank line is the `type` alias's seat, vacated. An entry that emits
      // nothing shapes none of the page's vertical rhythm (#770), so the gap is
      // measured from the imports to the binding and capped at one blank line
      // — where before the alias's own source span held it at zero.
      'import * as Lib from "./Lib.js";\n' +
        'import * as Types from "./Types.js";\n' +
        "\n" +
        "const four = Lib.twice(2);\n" +
        "export { four };\n",
    );
  });

  test("the control: a declared record does move it", () => {
    // Same alias, same shape, and now the module binds a JavaScript name at
    // the spelling. Without this the pin above would pass on an emitter that
    // had simply stopped renaming.
    expect(javascript([LIB, [
      "/main.hex",
      "module Main\n\n" + 'import Lib\n' +
        "export record Lib = {n: Int}\n" +
        "export let boxed: Int = (Lib({n = 3})).n\n" +
        "export let four: Int = Lib.twice(2)\n",
    ]])).toContain('import * as Lib_1 from "./Lib.js";');
  });

  test("the type alias cancels itself, never a union constructor's claim", async () => {
    // The subtraction is per *occurrence*, not by name. Here the spelling is
    // claimed twice — once by the type alias, which binds nothing, and once by
    // this module's own union constructor, which binds a `const` — so
    // removing the type alias's claim must leave the constructor's standing
    // and the alias must still move.
    //
    // Delete by name instead and this program emits `import * as Lib` beside
    // `const Lib = …` and never loads: #569's own failure, restored by the
    // simplification the reader reaches for first. Hence the load, and hence
    // the load running before the text is read.
    const files = [LIB, TYPES, [
      "/main.hex",
      "module Main\n\n" + 'import Lib\n' +
        'import Types\n' +
        "type Lib = Types.Lib\n" +
        "export union Colour =\n    | Lib(n: Int)\n    | Other\n" +
        "export fun level(c: Colour): Int =\n" +
        "    match c\n" +
        "        Lib(n) => n\n" +
        "        Other => 0\n" +
        "export let four: Int = Lib.twice(2)\n" +
        "export let five: Int = level(Lib(5))\n",
    ]] as const;
    const main = await runProject(files);
    // Both meanings answer: the alias through its qualified call, the
    // constructor through the one the module built and matched.
    expect(main.four).toBe(4);
    expect(main.five).toBe(5);
    const emitted = javascript(files);
    expect(emitted).toContain('import * as Lib_1 from "./Lib.js";');
    expect(emitted).toContain("const four = Lib_1.twice(2);");
  });

  // #762 also retired "a named import renamed onto the alias spelling still
  // moves it" (a value import's `as` landing on the alias's own spelling).
  // There is no seat left for it: an uppercase-start head in `let`'s binding
  // position is a constructor pattern (Patterns §…), never a fresh value
  // binding, so a plain value can no longer be bound under an uppercase
  // spelling at all — module alias or not. "The control: a declared record
  // does move it" above already carries the property this pin existed to add
  // (a same-spelled binding that *does* emit JavaScript still moves the
  // alias) through the one uppercase-binding shape that remains legal.
});

describe("the suffix probes past what the module already binds", () => {
  test("a second alias standing on the mint is stepped over", async () => {
    // Two aliases never *collide* — same-spelled ones are a source error — but
    // the second can be sitting on the spelling this probe is about to mint. A
    // probe that avoided only the declarations would answer `Point_1` here and
    // emit two `import * as Point_1` lines: #569's own failure, one alias over,
    // which is why the load is what this pin asserts.
    const files = [POINT, ["/point1.hex", "module Point1\n\n" + "export fun twice(n: Int): Int = n + n\n"], [
      "/main.hex",
      "module Main\n\n" + 'import Point\n' +
        'import Point1 as Point_1\n' +
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
    expect(emitted).toContain('import * as Point_2 from "./Point.js";');
    expect(emitted).toContain('import * as Point_1 from "./Point1.js";');
    expect(emitted).toContain("const far = Point_2.getX(Point_2.make(1.0, 2.0));");
  });

  test("an occupied `_1` is stepped over", async () => {
    const files = [POINT, [
      "/main.hex",
      "module Main\n\n" + 'import Point\n' +
        "export record Point = {n: Int}\n" +
        "export record Point_1 = {k: Int}\n" +
        "export let far: Float = Point.getX(Point.make(1.0, 2.0))\n",
    ]] as const;
    expect(javascript(files)).toContain('import * as Point_2 from "./Point.js";');
    const main = await runProject(files);
    expect(main.far).toBe(1.0);
  });
});

/**
 * An `exception` declaration is a contestant like any other (#569's review
 * note, carried here by #565's sweep). It is not a record, a union, or an
 * import — the three shapes the pins above walk — but it binds a module-level
 * name in the emitted file exactly as they do, so the alias must move for it and
 * the declaration must keep its spelling. The failure this forecloses is the
 * same load failure, reached through a fourth declaration form.
 */
describe("an exception declaration contests the spelling too", () => {
  test("the alias moves for it, and both names work at load", async () => {
    const files = [
      ["/boom.hex", "module Boom\n\n" + "export fun twice(n: Int): Int = n + n\n"],
      ["/main.hex",
        "module Main\n\n" + 'import Boom\n' +
          "exception Boom(reason: String)\n" +
          "export fun caught(): String =\n" +
          "    try\n" +
          "        throw(Boom(\"detonated\"))\n" +
          "    catch\n" +
          "        Boom(reason) => reason\n" +
          "export let four: Int = Boom.twice(2)\n"],
    ] as const;

    // The declaration keeps the bare spelling and the alias takes `_1` — the
    // §11.2 rule the rest of this file pins, reached through `exception`.
    const emitted = javascript(files);
    expect(emitted).toContain('import * as Boom_1 from "./Boom.js";');
    expect(emitted).toContain("Boom_1.twice(2)");

    // Executed, not only read: #569 was a load failure, and a text pin alone
    // would not have caught it. Both namespaces answer in the loaded module —
    // the exception through its own throw and catch, the module through the
    // moved alias.
    const main = await runProject(files);
    expect((main.caught as () => string)()).toBe("detonated");
    expect(main.four).toBe(4);
  });
});

describe("every qualified use the alias serves follows it", () => {
  test("a constructor reached through a contested alias still constructs", async () => {
    const files = [
      ["/shape.hex", "module Shape\n\n" + "export union Shape =\n    | Circle(r: Float)\n    | Square(s: Float)\n"],
      ["/main.hex",
        "module Main\n\n" + 'import Shape\n' +
          "export record Shape = {n: Int}\n" +
          "export fun radius(s: Shape.Shape): Float =\n" +
          "    match s\n" +
          "        Shape.Circle(r) => r\n" +
          "        Shape.Square(side) => side\n" +
          "export let round: Float = radius(Shape.Circle(2.0))\n" +
          "export let boxed: Int = (Shape({n = 3})).n\n"],
    ] as const;
    // The application erases wherever it was reached, contested alias
    // included (#770) — and the alias's import line stands regardless
    // (Modules §11.3), under the suffixed local #569 gave it.
    expect(javascript(files)).toContain(
      'const round = radius({ tag: "Circle", r: 2.0 });',
    );
    expect(javascript(files)).toContain('import * as Shape_1 from "./Shape.js";');
    const main = await runProject(files);
    expect(main.round).toBe(2.0);
    expect(main.boxed).toBe(3);
  });
});
