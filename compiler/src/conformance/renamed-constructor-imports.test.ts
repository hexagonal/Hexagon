import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runProject } from "../support/test-project.js";

/**
 * Conformance for a constructor reached through a **renaming import** —
 * `import { Circle as Round }`, then `Round` in value position and in patterns
 * (#468).
 *
 * Modules §4 lets an import clause spell a name locally however it likes, and
 * that spelling is the module's own business: nothing crosses the module
 * boundary with it. What crosses is the *declaration*, and a constructed value
 * carries the name it was declared under — `Circle`, whatever the importer calls
 * it — because the constructor function itself lives in the declaring module and
 * is the only thing that ever writes a tag.
 *
 * Value position never had a way to get this wrong: the local spelling is a
 * binding, and a binding compiles to the JavaScript import's local name. Pattern
 * position did, and this file is the pin. The resolved pattern therefore carries
 * two strings and they are not interchangeable — `text`, the spelling written
 * here, which diagnostics quote and the occurrence index publishes so a rename
 * moves the right mentions; and `tag`, the declared name, which is the only one
 * emission may test against.
 */

const SHAPES = "export union Shape = Circle(radius: Float) | Square(side: Float)\n";

describe("a pattern spelled by the alias matches the declared tag", () => {
  test("constructed under the declared name, matched through the alias", async () => {
    const exports = await runProject([
      ["/shapes.hex",
        SHAPES +
        "export let unitCircle: Shape = Circle(1.0)\n" +
        "export let unitSquare: Shape = Square(1.0)\n"],
      ["/main.hex",
        "import { Shape, Circle as Round, Square as Boxy, unitCircle, unitSquare } from \"./shapes\"\n" +
        "export fun name(s: Shape): String =\n" +
        "    match s\n" +
        "        Round(r) => \"round\"\n" +
        "        Boxy(x) => \"boxy\"\n" +
        "export let first: String = name(unitCircle)\n" +
        "export let second: String = name(unitSquare)\n"],
    ]);

    expect([exports.first, exports.second]).toEqual(["round", "boxy"]);
  });

  test("constructed through the alias, matched under the declared name", async () => {
    // The reverse leg. `Round(3.0)` is the declaring module's own constructor
    // function under a local name, so the value it builds is one `/shapes.hex`
    // recognises without being told anything about the rename.
    const exports = await runProject([
      ["/shapes.hex",
        SHAPES +
        "export fun measure(s: Shape): Float =\n" +
        "    match s\n" +
        "        Circle(r) => r * 2.0\n" +
        "        Square(x) => x * 4.0\n"],
      ["/main.hex",
        "import { Shape, Circle as Round, Square as Boxy, measure } from \"./shapes\"\n" +
        "export let curved: Float = measure(Round(3.0))\n" +
        "export let straight: Float = measure(Boxy(3.0))\n"],
    ]);

    expect([exports.curved, exports.straight]).toEqual([6, 12]);
  });

  test("a nullary constructor renames the same way", async () => {
    // A nullary constructor of an untagged union is emitted as its own name
    // string, so the pattern is a bare `===` against it rather than a `.tag`
    // test — the same divergence through a different emission.
    const exports = await runProject([
      ["/traffic.hex",
        "export union Signal = Stop | Go\n" +
        "export let halt: Signal = Stop\n" +
        "export let proceed: Signal = Go\n"],
      ["/main.hex",
        "import { Signal, Stop as Halt, Go as Proceed, halt, proceed } from \"./traffic\"\n" +
        "export fun word(s: Signal): String =\n" +
        "    match s\n" +
        "        Halt => \"halt\"\n" +
        "        Proceed => \"proceed\"\n" +
        "export let stopped: String = word(halt)\n" +
        "export let moving: String = word(Proceed)\n"],
    ]);

    expect([exports.stopped, exports.moving]).toEqual(["halt", "proceed"]);
  });

  test("the emitted arm tests the declared tag, and the alias survives in the import alone", () => {
    const javascript = compileFiles([
      ["/shapes.hex", SHAPES],
      ["/main.hex",
        "import { Shape, Circle as Round, Square as Boxy } from \"./shapes\"\n" +
        "export fun radius(s: Shape): Float =\n" +
        "    match s\n" +
        "        Round(r) => r\n" +
        "        Boxy(x) => x\n"],
    ]).modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;

    expect(javascript).toContain("import { Circle as Round, Square as Boxy } from \"./shapes.js\";");
    expect(javascript).toContain(
      "  switch (__match.tag) {\n" +
      "    case \"Circle\":\n",
    );
    // `case "Round":` is the miscompile #468 reports: a case no value equals,
    // which fell through to the emitted `default` and threw at runtime.
    expect(javascript).not.toContain("case \"Round\":");
    expect(javascript).not.toContain("case \"Boxy\":");
  });

  test("an alias-spelled match is exhaustive, the spellings being one constructor each", () => {
    expect(compileFiles([
      ["/shapes.hex", SHAPES],
      ["/main.hex",
        "import { Shape, Circle as Round } from \"./shapes\"\n" +
        "export fun only(s: Shape): Float =\n" +
        "    match s\n" +
        "        Round(r) => r\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      // #607: `Square` was never imported, so there is no spelling for it here;
      // the witness keeps the bare name and §7.3's clause states the route.
      "match is missing cases: `Square(_)` — `Square` is declared in `./shapes`; " +
      "`import { Square } from \"./shapes\"` to spell it here",
    ]);
  });
});

describe("the arms that never reach the switch", () => {
  /**
   * A `match` lowers to a `switch` on the tag only while every arm is a flat,
   * unguarded constructor pattern. A guard or a nested pattern sends the whole
   * match down the if-chain instead, which builds its own tag test — a *second*
   * emission site reading the same field, and the one an alias can reach
   * without a case label to show for it. A leak here is quieter than #468's
   * original: the nested test simply never holds, so the match falls through to
   * a later arm and returns the wrong answer, or throws only if nothing else
   * matches.
   */

  const PARCEL =
    "export union Shape = Circle(radius: Float) | Square(side: Float)\n" +
    "export union Parcel = Wrapped(inner: Shape) | Empty\n";

  test("an aliased constructor nested inside another pattern tests the declared tag", async () => {
    const files = [
      ["/parcel.hex", PARCEL],
      ["/main.hex",
        // `Shape` is in the clause because the emitter only knows a
        // constructor's shape for a union the module names: without it this
        // arm emits an untagged test and `item1` field names, whatever the
        // constructor is spelled. That is a defect of its own, not this one,
        // and importing the type keeps this pin about the alias.
        "import { Shape, Parcel, Wrapped, Empty, Circle as Round, Square } from \"./parcel\"\n" +
        "export fun contents(p: Parcel): String =\n" +
        "    match p\n" +
        "        Wrapped(Round(r)) => \"round\"\n" +
        "        Wrapped(Square(x)) => \"square\"\n" +
        "        Empty => \"empty\"\n" +
        "export let inner: String = contents(Wrapped(Round(1.0)))\n" +
        "export let other: String = contents(Wrapped(Square(1.0)))\n" +
        "export let nothing: String = contents(Empty)\n"],
    ] as const;

    // Behaviour first: a leaked spelling here is a test that never holds, so
    // the value walks on to whatever arm catches it next.
    const exports = await runProject(files as never);
    expect([exports.inner, exports.other, exports.nothing]).toEqual([
      "round",
      "square",
      "empty",
    ]);

    const javascript = compileFiles(files as never)
      .modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
    expect(javascript).toContain("__match.inner.tag === \"Circle\"");
    expect(javascript).not.toContain("\"Round\"");
  });

  test("a guarded aliased arm tests the declared tag too", async () => {
    const files = [
      ["/guarded.hex", PARCEL],
      ["/main.hex",
        "import { Shape, Circle as Round, Square } from \"./guarded\"\n" +
        "export fun scaled(s: Shape): Float =\n" +
        "    match s\n" +
        "        Round(r) when r > 0.5 => r * 10.0\n" +
        "        Round(r) => r\n" +
        "        Square(x) => x\n" +
        "export let large: Float = scaled(Round(2.0))\n" +
        "export let small: Float = scaled(Round(0.25))\n" +
        "export let flat: Float = scaled(Square(4.0))\n"],
    ] as const;

    const exports = await runProject(files as never);
    expect([exports.large, exports.small, exports.flat]).toEqual([20, 0.25, 4]);

    const javascript = compileFiles(files as never)
      .modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
    expect(javascript).toContain("__match.tag === \"Circle\"");
    expect(javascript).not.toContain("\"Round\"");
  });
});

describe("what the reader is shown stays the spelling the reader wrote", () => {
  const arityDiagnostics = (arm: string): readonly string[] =>
    compileFiles([
      ["/shapes.hex", SHAPES],
      ["/main.hex",
        "import { Shape, Circle as Round, Square } from \"./shapes\"\n" +
        "export fun area(s: Shape): Float =\n" +
        "    match s\n" +
        `        ${arm} => 1.0\n` +
        "        Square(x) => x\n"],
    ]).diagnostics.map(({ message }) => message);

  test("an arity report quotes the local name, not the declaration's", () => {
    // The span under the report reads `Round`; a message naming `Circle` would
    // send the reader looking for a constructor their file never mentions.
    expect(arityDiagnostics("Round(r, extra)")).toEqual([
      "constructor pattern `Round` expects 1 arguments, got 2",
    ]);
  });

  test("an unreachable case quotes the local name too", () => {
    expect(compileFiles([
      ["/shapes.hex", SHAPES],
      ["/main.hex",
        "import { Shape, Circle as Round, Square } from \"./shapes\"\n" +
        "export fun twice(s: Shape): Float =\n" +
        "    match s\n" +
        "        Round(r) => r\n" +
        "        Round(q) => q\n" +
        "        Square(x) => x\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      "this case is unreachable; `Round` is already handled above",
    ]);
  });

  test("the declaring module's own spelling is not in scope under the alias", () => {
    // The rename is a rename, not an addition: `Circle` was never imported, so
    // the pattern that names it is an unknown constructor. Which is also what
    // keeps the two strings honest — a module cannot write both spellings.
    expect(compileFiles([
      ["/shapes.hex", SHAPES],
      ["/main.hex",
        "import { Shape, Circle as Round, Square } from \"./shapes\"\n" +
        "export fun area(s: Shape): Float =\n" +
        "    match s\n" +
        "        Circle(r) => r\n" +
        "        _ => 0.0\n"],
    ]).diagnostics.map(({ message }) => message)).toContain(
      "unknown constructor `Circle`",
    );
  });
});

describe("an exception constructor imported under another name", () => {
  /**
   * An exception is thrown by calling its constructor, which is the declaring
   * module's function, so the alias reaches emission as an import spelling and
   * the raised error carries the declared `name`.
   *
   * Catching it in the importing module works since #469, and the alias is what
   * this file is about: the arm names the *local* spelling, and the tag it
   * tests is still the declared one, because #468 made a constructor pattern
   * carry the declaration's name rather than the source text.
   * `qualified-exception-patterns.test.ts` pins the rest of the widened table.
   */

  test("thrown through the alias, caught by the declaring module under its own name", async () => {
    const exports = await runProject([
      ["/blast.hex",
        "export exception Blast(code: Int)\n" +
        "export fun shielded(f: (() ->? Int)): Int =\n" +
        "    try\n" +
        "        f?()\n" +
        "    catch\n" +
        "        Blast(c) => c\n"],
      ["/main.hex",
        "import { Blast as Kaboom, shielded } from \"./blast\"\n" +
        "export fun detonate(): Int = throw(Kaboom(7))\n" +
        "export let survived: Int = shielded(detonate)\n"],
    ]);

    expect(exports.survived).toBe(7);
  });

  test("a catch arm names an imported exception, aliased or not", async () => {
    const files = (arm: string, clause: string): readonly (readonly [string, string])[] => [
      ["/blast.hex", "export exception Blast(code: Int)\n"],
      ["/main.hex",
        `import { ${clause} } from "./blast"\n` +
        "export fun f(): Int =\n" +
        "    try\n" +
        `        throw(${clause.includes(" as ") ? "Kaboom" : "Blast"}(3))\n` +
        "    catch\n" +
        `        ${arm} => c\n` +
        "export let caught: Int = f()\n"],
    ];

    expect(compileFiles(files("Blast(c)", "Blast")).diagnostics).toEqual([]);
    expect((await runProject(files("Blast(c)", "Blast")))["caught"]).toBe(3);
    // The alias changes the spelling and nothing else: the arm is written
    // `Kaboom`, the thrown error's `name` is `Blast`, and the pattern tests the
    // declared tag (#468) — so the local rename catches what the declaring
    // module threw.
    expect(compileFiles(files("Kaboom(c)", "Blast as Kaboom")).diagnostics).toEqual([]);
    expect((await runProject(files("Kaboom(c)", "Blast as Kaboom")))["caught"]).toBe(3);
  });
});

describe("the prelude's constructors rename as any other module's do", () => {
  test("`Some` imported as `Filled` matches what the prelude constructs", async () => {
    const exports = await runProject([
      ["/main.hex",
        "import { Some as Filled, None as Empty } from \"./Option\"\n" +
        "export fun unwrap(o: Option(Int)): Int =\n" +
        "    match o\n" +
        "        Filled(v) => v + 1\n" +
        "        Empty => 0\n" +
        "export let full: Int = unwrap(Some(41))\n" +
        "export let blank: Int = unwrap(Filled(9))\n" +
        "export let none: Int = unwrap(Empty)\n"],
    ]);

    expect([exports.full, exports.blank, exports.none]).toEqual([42, 10, 0]);
  });
});

describe("what value position emits, which was right all along", () => {
  test("the alias is a local binding; the tag is written by the declaring module", () => {
    const project = compileFiles([
      ["/shapes.hex", SHAPES],
      ["/main.hex",
        "import { Shape, Circle as Round } from \"./shapes\"\n" +
        "export let one: Shape = Round(1.0)\n"],
    ]);
    const javascriptOf = (path: string) =>
      project.modules.find(({ source }) => source.path === path)!.javascript.text;

    expect(javascriptOf("/shapes.hex")).toContain(
      "const Circle = radius => ({ tag: \"Circle\", radius });",
    );
    expect(javascriptOf("/main.hex")).toContain("const one = Round(1.0);");
    expect(javascriptOf("/main.hex")).not.toContain("\"Round\"");
  });
});
