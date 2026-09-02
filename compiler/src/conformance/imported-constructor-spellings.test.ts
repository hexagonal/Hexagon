import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/**
 * Conformance for a constructor an importing module reaches **without a bare
 * binding of its own** — the three routes #762 leaves: the qualified spelling
 * `Shapes.Circle`, Modules §5.1 rule 3's companion fallback, and Pattern
 * Matching §2.2's scrutinee-type door.
 *
 * The file this replaces was written for `import { Circle as Round }` (#468):
 * an import clause could spell a name locally however it liked, and the pin was
 * that a *pattern* still tested the declaration's name — `Circle`, whatever the
 * importer called it — because the constructor function lives in the declaring
 * module and is the only thing that ever writes a tag. **#762 removed the
 * rename**, and with it the only route by which a pattern's written spelling
 * could differ from the declared one. The resolved pattern still carries the
 * two strings — `text`, the spelling written here, which diagnostics quote and
 * the occurrence index publishes, and `tag`, the declared name, which emission
 * tests against — and they now agree by construction at every route below.
 *
 * What survives the rename's deletion is the half that was never about the
 * rename: an arm reached through any of the three routes emits a test against
 * the declared tag, in the switch lowering and in the if-chain alike, and the
 * reader is shown the spelling they wrote.
 */

const SHAPES = "export union Shape = Circle(radius: Float) | Square(side: Float)\n";

describe("an arm reached through the door matches the declared tag", () => {
  test("constructed abroad qualified, matched at home bare", async () => {
    const exports = await runProject([
      ["/shapes.hex",
        SHAPES +
        "export fun name(s: Shape): String =\n" +
        "    match s\n" +
        "        Circle(r) => \"round\"\n" +
        "        Square(x) => \"boxy\"\n"],
      ["/main.hex",
        'import Shapes from "./shapes"\n' +
        "export let first: String = Shapes.name(Shapes.Circle(1.0))\n" +
        "export let second: String = Shapes.name(Shapes.Square(1.0))\n"],
    ]);

    expect([exports.first, exports.second]).toEqual(["round", "boxy"]);
  });

  test("constructed at home, matched abroad through the door", async () => {
    // The door's own leg: the arms are bare, nothing is in scope for either
    // spelling, and the scrutinee's type supplies both constructors (§2.2).
    const exports = await runProject([
      ["/shapes.hex",
        SHAPES +
        "export let unitCircle: Shape = Circle(1.0)\n" +
        "export let unitSquare: Shape = Square(1.0)\n"],
      ["/main.hex",
        'import Shapes from "./shapes"\n' +
        "export fun name(s: Shapes.Shape): String =\n" +
        "    match s\n" +
        "        Circle(r) => \"round\"\n" +
        "        Square(x) => \"boxy\"\n" +
        "export let first: String = name(Shapes.unitCircle)\n" +
        "export let second: String = name(Shapes.unitSquare)\n"],
    ]);

    expect([exports.first, exports.second]).toEqual(["round", "boxy"]);
  });

  test("a nullary constructor reads the same way", async () => {
    // A nullary constructor of an untagged union is emitted as its own name
    // string, so the pattern is a bare `===` against it rather than a `.tag`
    // test — the same property through a different emission.
    const exports = await runProject([
      ["/traffic.hex",
        "export union Signal = Stop | Go\n" +
        "export let halt: Signal = Stop\n"],
      ["/main.hex",
        'import Traffic from "./traffic"\n' +
        "export fun word(s: Traffic.Signal): String =\n" +
        "    match s\n" +
        "        Stop => \"halt\"\n" +
        "        Go => \"proceed\"\n" +
        "export let stopped: String = word(Traffic.halt)\n" +
        "export let moving: String = word(Traffic.Go)\n"],
    ]);

    expect([exports.stopped, exports.moving]).toEqual(["halt", "proceed"]);
  });

  test("the emitted arm tests the declared tag, and the alias stays in the import", () => {
    const javascript = compileFiles([
      ["/shapes.hex", SHAPES],
      ["/main.hex",
        'import Shapes from "./shapes"\n' +
        "export fun radius(s: Shapes.Shape): Float =\n" +
        "    match s\n" +
        "        Circle(r) => r\n" +
        "        Square(x) => x\n"],
    ]).modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;

    expect(javascript).toContain('import * as Shapes from "./shapes.js";');
    expect(javascript).toContain(
      "  switch (__match.tag) {\n" +
      "    case \"Circle\":\n",
    );
    // The alias never reaches a case label: the tag is the declaration's, and
    // the module alias is a compile-time path, not a value (#468, §3.1).
    expect(javascript).not.toContain("case \"Shapes.Circle\":");
  });

  test("a door-reached match is exhaustive with no wildcard", () => {
    expect(compileFiles([
      ["/shapes.hex", SHAPES],
      ["/main.hex",
        'import Shapes from "./shapes"\n' +
        "export fun only(s: Shapes.Shape): Float =\n" +
        "    match s\n" +
        "        Circle(r) => r\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      // #607 tier 1, widened by the door (#763): every constructor of the
      // scrutinee's type is bare-spellable here, so the witness prints bare
      // and owes no route clause.
      "match is missing cases: `Square(_)`",
    ]);
  });
});

describe("the arms that never reach the switch", () => {
  /**
   * A `match` lowers to a `switch` on the tag only while every arm is a flat,
   * unguarded constructor pattern. A guard or a nested pattern sends the whole
   * match down the if-chain instead, which builds its own tag test — a *second*
   * emission site reading the same field. A leak there is quieter than a wrong
   * case label: the nested test simply never holds, so the match falls through
   * to a later arm and returns the wrong answer, or throws only if nothing else
   * matches.
   */

  const PARCEL =
    "export union Shape = Circle(radius: Float) | Square(side: Float)\n" +
    "export union Parcel = Wrapped(inner: Shape) | Empty\n";

  test("a nested door-reached constructor tests the declared tag", async () => {
    const files = [
      ["/parcel.hex", PARCEL],
      ["/main.hex",
        'import Parcel from "./parcel"\n' +
        "export fun contents(p: Parcel.Parcel): String =\n" +
        "    match p\n" +
        "        Wrapped(Circle(r)) => \"round\"\n" +
        "        Wrapped(Square(x)) => \"square\"\n" +
        "        Empty => \"empty\"\n" +
        "export let inner: String = contents(Parcel.Wrapped(Parcel.Circle(1.0)))\n" +
        "export let other: String = contents(Parcel.Wrapped(Parcel.Square(1.0)))\n" +
        "export let nothing: String = contents(Parcel.Empty)\n"],
    ] as const;

    // Behaviour first: a leaked spelling here is a test that never holds, so
    // the value walks on to whatever arm catches it next. It also pins the
    // door's nested leg — `Circle` and `Square` are read from the *declared
    // slot type* of `Wrapped`, one level beneath the scrutinee (§2.2).
    const exports = await runProject(files as never);
    expect([exports.inner, exports.other, exports.nothing]).toEqual([
      "round",
      "square",
      "empty",
    ]);

    const javascript = compileFiles(files as never)
      .modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
    expect(javascript).toContain("__match.inner.tag === \"Circle\"");
  });

  test("a guarded door-reached arm tests the declared tag too", async () => {
    const files = [
      ["/guarded.hex", PARCEL],
      ["/main.hex",
        'import Guarded from "./guarded"\n' +
        "export fun scaled(s: Guarded.Shape): Float =\n" +
        "    match s\n" +
        "        Circle(r) when r > 0.5 => r * 10.0\n" +
        "        Circle(r) => r\n" +
        "        Square(x) => x\n" +
        "export let large: Float = scaled(Guarded.Circle(2.0))\n" +
        "export let small: Float = scaled(Guarded.Circle(0.25))\n" +
        "export let flat: Float = scaled(Guarded.Square(4.0))\n"],
    ] as const;

    const exports = await runProject(files as never);
    expect([exports.large, exports.small, exports.flat]).toEqual([20, 0.25, 4]);

    const javascript = compileFiles(files as never)
      .modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;
    expect(javascript).toContain("__match.tag === \"Circle\"");
  });
});

describe("what the reader is shown stays the spelling the reader wrote", () => {
  const arityDiagnostics = (arm: string): readonly string[] =>
    compileFiles([
      ["/shapes.hex", SHAPES],
      ["/main.hex",
        'import Shapes from "./shapes"\n' +
        "export fun area(s: Shapes.Shape): Float =\n" +
        "    match s\n" +
        `        ${arm} => 1.0\n` +
        "        Square(x) => x\n"],
    ]).diagnostics.map(({ message }) => message);

  test("an arity report quotes the written spelling", () => {
    expect(arityDiagnostics("Circle(r, extra)")).toEqual([
      "constructor pattern `Circle` expects 1 arguments, got 2",
    ]);
  });

  test("a qualified arm quotes its own half, the qualifier being the module's", () => {
    expect(arityDiagnostics("Shapes.Circle(r, extra)")).toEqual([
      "constructor pattern `Circle` expects 1 arguments, got 2",
    ]);
  });

  test("an unreachable case quotes the written spelling too", () => {
    expect(compileFiles([
      ["/shapes.hex", SHAPES],
      ["/main.hex",
        'import Shapes from "./shapes"\n' +
        "export fun twice(s: Shapes.Shape): Float =\n" +
        "    match s\n" +
        "        Circle(r) => r\n" +
        "        Circle(q) => q\n" +
        "        Square(x) => x\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      "this case is unreachable; `Circle` is already handled above",
    ]);
  });

  test("a spelling no route reaches is the door's closed-door report", () => {
    // The rename's own pin, respelt: a module cannot write a constructor's name
    // in some second spelling of its own, so what stands where "unknown
    // constructor" stood is the door reading the scrutinee's type and finding
    // no such constructor in it (§12).
    expect(compileFiles([
      ["/shapes.hex", SHAPES],
      ["/main.hex",
        'import Shapes from "./shapes"\n' +
        "export fun area(s: Shapes.Shape): Float =\n" +
        "    match s\n" +
        "        Round(r) => r\n" +
        "        _ => 0.0\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      "`Shape` has no constructor `Round`",
    ]);
  });
});

describe("an exception constructor reached abroad", () => {
  /**
   * An exception is thrown by calling its constructor, which is the declaring
   * module's function, so the raised error carries the declared `name`.
   * Catching it in the importing module works since #469; the arm names the
   * qualified spelling, and the tag it tests is the declared one.
   * `qualified-exception-patterns.test.ts` pins the rest of the widened table.
   */

  test("thrown abroad, caught by the declaring module under its own name", async () => {
    const exports = await runProject([
      ["/blast.hex",
        "export exception Blast(code: Int)\n" +
        "export fun shielded(f: (() ->? Int)): Int =\n" +
        "    try\n" +
        "        f?()\n" +
        "    catch\n" +
        "        Blast(c) => c\n"],
      ["/main.hex",
        'import Blast from "./blast"\n' +
        "export fun detonate(): Int = throw(Blast.Blast(7))\n" +
        "export let survived: Int = Blast.shielded(detonate)\n"],
    ]);

    expect(exports.survived).toBe(7);
  });

  test("a catch arm names an imported exception through its alias", async () => {
    const files: readonly (readonly [string, string])[] = [
      ["/blast.hex", "export exception Blast(code: Int)\n"],
      ["/main.hex",
        'import Boom from "./blast"\n' +
        "export fun f(): Int =\n" +
        "    try\n" +
        "        throw(Boom.Blast(3))\n" +
        "    catch\n" +
        "        Boom.Blast(c) => c\n" +
        "export let caught: Int = f()\n"],
    ];

    expect(compileFiles(files).diagnostics).toEqual([]);
    expect((await runProject(files))["caught"]).toBe(3);
  });
});

describe("the prelude's constructors read as any other module's do", () => {
  test("`Some` is bare by the open-union grant, and matches what the prelude builds", async () => {
    const exports = await runProject([
      ["/main.hex",
        "export fun unwrap(o: Option(Int)): Int =\n" +
        "    match o\n" +
        "        Some(v) => v + 1\n" +
        "        None => 0\n" +
        "export let full: Int = unwrap(Some(41))\n" +
        "export let none: Int = unwrap(None)\n"],
    ]);

    expect([exports.full, exports.none]).toEqual([42, 0]);
  });

  test("a qualified-only prelude constructor is bare in a pattern and never in an expression", () => {
    expect(compileFiles([
      ["/main.hex",
        "export fun sign(a: Int, b: Int): Int =\n" +
        "    match a.compare(b)\n" +
        "        Less => -1\n" +
        "        Equal => 0\n" +
        "        Greater => 1\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([]);
    expect(compileFiles([
      ["/main.hex", "export let o: Ordering = Less\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      "no bare `Less`; write `Ordering.Less`",
    ]);
  });
});

describe("what value position emits", () => {
  test("the qualified application erases; the tag is written by the declaring module", () => {
    const project = compileFiles([
      ["/shapes.hex", SHAPES],
      ["/main.hex",
        'import Shapes from "./shapes"\n' +
        "export let one: Shapes.Shape = Shapes.Circle(1.0)\n"],
    ]);
    const javascriptOf = (path: string) =>
      project.modules.find(({ source }) => source.path === path)!.javascript.text;

    // The exported declaration still materializes its constructor — export is a
    // mandatory demand site (FFI Part 7 §4) — and the tag it writes is the
    // declared name, whatever the consumer spells the path.
    expect(javascriptOf("/shapes.hex")).toContain(
      "const Circle = radius => ({ tag: \"Circle\", radius });",
    );
    // Abroad the application erases, at every seat (Unions §6.4, #770): the
    // qualified spelling names no function in the emitted consumer at all.
    expect(javascriptOf("/main.hex")).toContain(
      'const one = { tag: "Circle", radius: 1.0 };',
    );
    expect(javascriptOf("/main.hex")).not.toContain("Shapes.Circle(");
  });

  test("a qualified constructor referenced as a value keeps the path", () => {
    // The other half of §11.2, which the erasure does not reach: no application
    // to erase, so the reference is the alias's qualified access.
    const project = compileFiles([
      ["/shapes.hex", SHAPES],
      ["/main.hex",
        'import Shapes from "./shapes"\n' +
        "export let mk: (Float) -> Shapes.Shape = Shapes.Circle\n"],
    ]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    expect(project.diagnostics).toEqual([]);
    expect(main.javascript.text).toContain("const mk = Shapes.Circle;");
  });
});
