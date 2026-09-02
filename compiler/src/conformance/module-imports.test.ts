import { describe, expect, test } from "vitest";

import { compileFiles, runProject } from "../support/test-project.js";

/**
 * Conformance for **#762** — an `import` binds a module and nothing smaller —
 * and **#763** — a constructor pattern resolves in scope first, then in the
 * expected type.
 *
 * Modules §13's acceptance tests and Pattern Matching §15's, arm by arm, plus
 * the pins the two rulings owe beyond them. The two issues share a file because
 * they share a subject: what an import brings is exactly what the door does not
 * have to, and every test below reads one side of that line.
 */

/** Every message the project reported, in order. */
function messages(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

/** The emitted JavaScript of one module. */
function emitted(
  files: readonly (readonly [string, string])[],
  path: string,
): string {
  return compileFiles(files).modules.find(({ source }) => source.path === path)!
    .javascript.text;
}

const GEOMETRY = [
  "/geometry.hex",
  "export fun area(r: Float): Float = r * r\n" +
    "fun helper(x: Float): Float = x * x\n",
] as const;

const DIRECTION = [
  "/direction.hex",
  "export union Direction = North | East | South | West\n",
] as const;

const SHAPE = [
  "/shape.hex",
  "export union Shape = Circle(radius: Float) | Rect(width: Float, height: Float)\n",
] as const;

const POINT = [
  "/point.hex",
  "export record Point = {x: Float, y: Float}\n" +
    "export fun area(p: Point): Float = p.x * p.y\n",
] as const;

describe("§13 (a) — privacy is the default, and the named list is refused", () => {
  test("an unexported name is invisible through the alias", () => {
    expect(messages([
      GEOMETRY,
      ["/main.hex",
        'import Geo from "./geometry"\n' +
        "export let n: Float = Geo.helper(2.0)\n"],
    ])).toEqual(["module `Geo` does not export `helper`"]);
  });

  test("the named list is a parse error naming the module form", () => {
    expect(messages([
      GEOMETRY,
      ["/main.hex", 'import { area } from "./geometry"\n'],
    ])).toEqual([
      'Hexagon imports bind modules: write `import Geometry from "./geometry"` ' +
        "and reach `area` as `Geometry.area`",
    ]);
  });
});

describe("§13 (b) — the companion fallbacks, both namespaces and both halves", () => {
  test("rule 2's type, rule 3's constructor, and rule 3 again in a pattern", async () => {
    const files = [
      POINT,
      ["/main.hex",
        'import Point from "./point"\n' +
        "let p = Point({x = 1.0, y = 2.0})\n" +
        "export fun f(q: Point): Float = q.x\n" +
        "export let sum: Float =\n" +
        "    match p\n" +
        "        Point({x, y}) => x + y\n" +
        // A bare name is a declaration (§3.2), and it generalises as any
        // binding does.
        "let area = Point.area\n" +
        "export let scaled: Float = area(p)\n"],
    ] as const;

    expect(messages(files)).toEqual([]);
    const module = await runProject(files as never);
    expect([module["sum"], module["scaled"]]).toEqual([3, 2]);
  });
});

describe("§13 (c) — opaque is a black box outside its home", () => {
  const OPAQUE = [
    "/point.hex",
    "opaque record Point = {x: Float, y: Float}\n" +
      "export fun make(x: Float, y: Float): Point = Point({x = x, y = y})\n",
  ] as const;

  test("the exported function works; the field, the pattern and the door do not", () => {
    expect(messages([
      OPAQUE,
      ["/main.hex",
        'import Point from "./point"\n' +
        "export let p: Point = Point.make(1.0, 2.0)\n"],
    ])).toEqual([]);
    expect(messages([
      OPAQUE,
      ["/main.hex",
        'import Point from "./point"\n' +
        "export let n: Float = Point.make(1.0, 2.0).x\n"],
    ])).toEqual([
      "cannot access field `x` of opaque record `Point`; " +
        "use an operation exported by its home module",
    ]);
    // Rule 3 reads the *exported* constructor, so the fallback declines — and
    // the door, which reads the declaration, refuses in the opaque family's
    // own words rather than handing back a private constructor.
    expect(messages([
      OPAQUE,
      ["/main.hex",
        'import Point from "./point"\n' +
        "export let n: Float =\n" +
        "    match Point.make(1.0, 2.0)\n" +
        "        Point(r) => 1.0\n"],
    ])).toEqual([
      "cannot destructure opaque record `Point`; " +
        "use an operation exported by its home module",
    ]);
  });

  test("`export opaque` keeps its required rewrite", () => {
    expect(messages([
      ["/main.hex", "export opaque record Point = {x: Float}\n"],
    ])).toEqual([
      "`opaque` already exports the type name; write `opaque record Point = …`",
    ]);
  });
});

describe("§13 (d) — the companion idiom: alias, type and constructor coexist", () => {
  test("one line covers all three", () => {
    expect(messages([
      POINT,
      ["/main.hex",
        'import Point from "./point"\n' +
        "export fun norm(p: Point): Float = Point.area(p)\n" +
        "export let q: Point = Point({x = 3.0, y = 4.0})\n"],
    ])).toEqual([]);
  });
});

describe("§13 (f) — the one import collision, and the two that are not", () => {
  test("two aliases of one spelling is the collision", () => {
    expect(messages([
      ["/circle.hex", "export fun area(r: Float): Float = r\n"],
      ["/rect.hex", "export fun area(r: Float): Float = r\n"],
      ["/main.hex",
        'import Shape from "./circle"\n' +
        'import Shape from "./rect"\n'],
    ])).toEqual(["module alias `Shape` is already bound"]);
  });

  test("two aliases onto one module under different spellings are legal", () => {
    expect(messages([
      GEOMETRY,
      ["/main.hex",
        'import Geo from "./geometry"\n' +
        'import Geometry from "./geometry"\n' +
        "export let n: Float = Geo.area(1.0) + Geometry.area(2.0)\n"],
    ])).toEqual([]);
  });

  test("an alias may occlude a prelude module's alias (§5.4)", () => {
    expect(messages([
      ["/vector.hex", "export fun mine(n: Int): Int = n\n"],
      ["/main.hex",
        'import Vector from "./vector"\n' +
        "export let n: Int = Vector.mine(1)\n"],
    ])).toEqual([]);
  });
});

describe("§13 (g) — the cycle", () => {
  test("an import cycle names the cycle", () => {
    expect(messages([
      ["/a.hex", 'import B from "./b"\nexport let n: Int = B.m\n'],
      ["/b.hex", 'import A from "./a"\nexport let m: Int = A.n\n'],
    ])[0]).toMatch(/import cycle/u);
  });
});

describe("§13 (i) — instance globality, and the effect import that is gone", () => {
  const CONFIG = [
    "/config.hex",
    "export record Config derives (Eq, Ord) = {n: Int}\n",
  ] as const;

  test("the type's home rides its import into the graph", () => {
    // Nothing but the module is imported, and the one lawful `Ord<Config>` is
    // found: the instance rides its home into the graph (§7.6). `Ord` is
    // demanded by the comparison, which names no instance and imports nothing.
    expect(messages([
      CONFIG,
      ["/main.hex",
        'import Config from "./config"\n' +
        "export let ordered: Bool =\n" +
        "    Config({n = 1}) < Config({n = 2})\n"],
    ])).toEqual([]);
  });

  test("the effect import is refused with the route named", () => {
    expect(messages([
      CONFIG,
      ["/main.hex", 'import "./config"\n'],
    ])).toEqual([
      "Hexagon has no effect import; a module is imported for its names — " +
        '`import Config from "./config"` — or run as a root',
    ]);
  });
});

describe("§13 (k), §11.2–§11.3 — emission", () => {
  test("the module form emits the namespace import, and the alias is a path", () => {
    const javascript = emitted([
      GEOMETRY,
      ["/main.hex",
        'import Geo from "./geometry"\n' +
        "export let n: Float = Geo.area(2.0)\n"],
    ], "/main.hex");
    expect(javascript).toContain('import * as Geo from "./geometry.js";');
    expect(javascript).toContain("const n = Geo.area(2.0);");
  });

  test("an import whose alias the body never reaches still emits (§11.3)", () => {
    // The source wrote the dependency and its load order is §8.2's. The choice
    // §11.3 leaves the emitter is pinned here: the namespace import, which is
    // what the module form emits whether or not the alias is reached.
    const javascript = emitted([
      GEOMETRY,
      ["/main.hex", 'import Geo from "./geometry"\nexport let n: Int = 1\n'],
    ], "/main.hex");
    expect(javascript).toContain('import * as Geo from "./geometry.js";');
  });

  test("no bare import is synthesized for a module the source did not import", () => {
    const javascript = emitted([
      ["/main.hex", "export let n: Int = 1\n"],
    ], "/main.hex");
    expect(javascript).not.toMatch(/^import "/mu);
  });
});

describe("§13 (l) — a transparent representation reaches through an un-imported home", () => {
  const CRATE = [
    ["/crate.hex", "export record Crate = {n: Float}\n"],
    ["/mid.hex",
      'import Crate from "./crate"\n' +
      "export fun make(value: Float): Crate = Crate({n = value})\n"],
  ] as const;

  test("fields travel with the type, and the door supplies the eliminator", async () => {
    const files = [
      ...CRATE,
      ["/main.hex",
        'import Mid from "./mid"\n' +
        "export let direct: Float = Mid.make(1.5).n\n" +
        "export fun reading(): Float =\n" +
        "    let Crate({n}) = Mid.make(2.5)\n" +
        "    n\n" +
        "export let out: Float = reading()\n"],
    ] as const;
    expect(messages(files as never)).toEqual([]);
    const module = await runProject(files as never);
    expect([module["direct"], module["out"]]).toEqual([1.5, 2.5]);
  });

  test("a field the record lacks names the known fields", () => {
    expect(messages([
      ...CRATE,
      ["/main.hex",
        'import Mid from "./mid"\nexport let n: Float = Mid.make(1.5).m\n'],
    ])).toEqual(["`Crate` has fields `n`, not `m`"]);
  });
});

describe("§13 (m) — a constructor not spelled like its alias", () => {
  test("the expression is refused with the qualified spelling, in the program's words", () => {
    expect(messages([
      SHAPE,
      ["/main.hex",
        'import Shape from "./shape"\n' +
        "export let bad: Shape = Circle(1.0)\n"],
    ])).toEqual(["no bare `Circle`; write `Shape.Circle(1.0)`"]);
    // A reference that is not a call names the qualified spelling alone.
    expect(messages([
      DIRECTION,
      ["/main.hex",
        'import Direction from "./direction"\n' +
        "export let d: Direction = North\n"],
    ])).toEqual(["no bare `North`; write `Direction.North`"]);
  });

  test("several visible aliases name each", () => {
    expect(messages([
      SHAPE,
      ["/other.hex", "export union Other = Circle(n: Float)\n"],
      ["/main.hex",
        'import Shape from "./shape"\n' +
        'import Other from "./other"\n' +
        "export let bad: Shape = Circle(1.0)\n"],
    ])).toEqual([
      "no bare `Circle`; write `Shape.Circle(1.0)` or `Other.Circle(1.0)`",
    ]);
  });

  test("none is the plain unknown-name report", () => {
    expect(messages([
      ["/main.hex", "export let bad: Int = Circle(1.0)\n"],
    ])).toEqual(["unknown name `Circle`"]);
  });

  test("the qualified spelling works, and so do the door's arms", async () => {
    const files = [
      SHAPE,
      ["/main.hex",
        'import Shape from "./shape"\n' +
        "export let c: Shape.Shape = Shape.Circle(1.0)\n" +
        "export fun describe(s: Shape): String =\n" +
        "    match s\n" +
        "        Circle(r) => \"circle\"\n" +
        "        Rect(w, h) => \"rect\"\n" +
        "export fun isRound(s: Shape): Bool =\n" +
        "    match s\n" +
        "        Shape.Circle(_) => True\n" +
        "        _ => False\n" +
        "export let word: String = describe(c)\n" +
        "export let round: Bool = isRound(c)\n"],
    ] as const;
    expect(messages(files as never)).toEqual([]);
    const module = await runProject(files as never);
    expect([module["word"], module["round"]]).toEqual(["circle", true]);
  });
});

describe("§13 (n) — the refused heads, each with its rewrite", () => {
  test("all four, in one file", () => {
    expect(messages([
      GEOMETRY,
      ["/main.hex",
        'import module Geo from "./geometry"\n' +
        'import * as Geo2 from "./geometry"\n' +
        'import { area } from "./geometry"\n' +
        'import geometry from "./geometry"\n'],
    ])).toEqual([
      'Hexagon imports bind modules: write `import Geo from "./geometry"`',
      'Hexagon imports bind modules: write `import Geo2 from "./geometry"`',
      'Hexagon imports bind modules: write `import Geometry from "./geometry"` ' +
        "and reach `area` as `Geometry.area`",
      'a module alias is uppercase-start; write `import Geometry from "./geometry"`',
    ]);
  });

  test("the derived alias upper-cases each separator-delimited segment", () => {
    expect(messages([
      ["/search-params.hex", "export fun get(n: Int): Int = n\n"],
      ["/main.hex", 'import { get } from "./search-params"\n'],
    ])).toEqual([
      'Hexagon imports bind modules: write `import SearchParams from "./search-params"` ' +
        "and reach `get` as `SearchParams.get`",
    ]);
  });

  test("a basename that yields no uppercase-start identifier names the slot", () => {
    expect(messages([
      ["/2d-utils.hex", "export fun get(n: Int): Int = n\n"],
      ["/main.hex", 'import { get } from "./2d-utils"\n'],
    ])).toEqual([
      'Hexagon imports bind modules: write `import <Alias> from "./2d-utils"` ' +
        "and reach `get` as `<Alias>.get`",
    ]);
  });
});

describe("Pattern Matching §15 (o) — the door, and the absence of its expression twin", () => {
  test("imported constructors are bare in arms and qualified in bodies", async () => {
    const files = [
      DIRECTION,
      ["/main.hex",
        'import Direction from "./direction"\n' +
        "export fun turn(d: Direction): Direction =\n" +
        "    match d\n" +
        "        North => Direction.East\n" +
        "        East => Direction.South\n" +
        "        South => Direction.West\n" +
        "        West => Direction.North\n" +
        "export let after: Direction = turn(Direction.North)\n"],
    ] as const;
    expect(messages(files as never)).toEqual([]);
    expect((await runProject(files as never))["after"]).toBe("East");
  });

  test("an arm body has no door", () => {
    expect(messages([
      DIRECTION,
      ["/main.hex",
        'import Direction from "./direction"\n' +
        "export fun turn(d: Direction): Direction =\n" +
        "    match d\n" +
        "        North => East\n" +
        "        _ => Direction.North\n"],
    ])).toEqual(["no bare `East`; write `Direction.East`"]);
  });

  test("a missing arm's witness prints bare (§7.3 tier 1)", () => {
    expect(messages([
      DIRECTION,
      ["/main.hex",
        'import Direction from "./direction"\n' +
        "export fun turn(d: Direction): Int =\n" +
        "    match d\n" +
        "        North => 1\n" +
        "        East => 2\n" +
        "        South => 3\n"],
    ])).toEqual(["match is missing cases: `West`"]);
  });

  test("the match function's parameter is §6.1's refusal, not the door's", () => {
    // §6.1 leads and the door's own refusal is not additionally reported.
    expect(messages([
      DIRECTION,
      ["/main.hex",
        'import Direction from "./direction"\n' +
        "let f = match\n" +
        "    North => 1\n" +
        "    _ => 0\n" +
        "export let n: Int = f(Direction.North)\n"],
    ])).toEqual([
      "cannot match on a value of abstract type; the parameter's type is " +
        "not determined here; give the parameter a type — bind the function " +
        "with its own annotated `let`, or use it where its parameter type is known",
    ]);
  });

  test("the qualified pattern fixes the type where the door needs it", () => {
    expect(messages([
      DIRECTION,
      ["/main.hex",
        'import Direction from "./direction"\n' +
        "let g = match\n" +
        "    Direction.North => 1\n" +
        "    _ => 0\n" +
        "export let n: Int = g(Direction.North)\n"],
    ])).toEqual([]);
  });

  test("the prelude's qualified-only constructors are bare in a pattern", async () => {
    const files = [
      ["/main.hex",
        "export fun sign(a: Int, b: Int): Int =\n" +
        "    match a.compare(b)\n" +
        "        Less => -1\n" +
        "        Equal => 0\n" +
        "        Greater => 1\n" +
        "export let low: Int = sign(1, 2)\n" +
        "export let same: Int = sign(2, 2)\n" +
        "export let high: Int = sign(3, 2)\n"],
    ] as const;
    expect(messages(files as never)).toEqual([]);
    const module = await runProject(files as never);
    expect([module["low"], module["same"], module["high"]]).toEqual([-1, 0, 1]);
  });

  test("— and are still refused in an expression", () => {
    expect(messages([
      ["/main.hex", "export let o: Ordering = Less\n"],
    ])).toEqual(["no bare `Less`; write `Ordering.Less`"]);
  });
});

describe("Pattern Matching §15 (o2) — scope first, module-wide", () => {
  test("a module's own constructor of the spelling wins, and the arm is a type error", () => {
    expect(messages([
      DIRECTION,
      ["/main.hex",
        'import Direction from "./direction"\n' +
        "union Compass = North | South\n" +
        "export fun h(d: Direction): Int =\n" +
        "    match d\n" +
        "        North => 1\n" +
        "        _ => 0\n"],
    ])[0]).toMatch(/type mismatch/u);
  });

  test("scope is read module-wide: a use above the declaration is declared-later", () => {
    expect(messages([
      DIRECTION,
      ["/main.hex",
        'import Direction from "./direction"\n' +
        "export fun h(d: Direction): Int =\n" +
        "    match d\n" +
        "        North => 1\n" +
        "        _ => 0\n" +
        "union Compass = North | South\n"],
    ])[0]).toMatch(/declared later in this block/u);
  });

  test("the closed door names the type and offers a near miss", () => {
    expect(messages([
      DIRECTION,
      ["/main.hex",
        'import Direction from "./direction"\n' +
        "export fun h(d: Direction): Int =\n" +
        "    match d\n" +
        "        Nort => 1\n" +
        "        _ => 0\n"],
    ])).toEqual(["`Direction` has no constructor `Nort`; did you mean `North`?"]);
  });
});

describe("Pattern Matching §15 (p) — nested, from declarations", () => {
  const PAIR = [
    "/pair.hex",
    'import Direction from "./direction"\n' +
      "export record Pair = {first: Direction.Direction, second: Direction.Direction}\n",
  ] as const;

  test("rule 3 supplies `Pair`; the declared field type supplies `North`", async () => {
    const files = [
      DIRECTION,
      PAIR,
      ["/main.hex",
        'import Pair from "./pair"\n' +
        'import Direction from "./direction"\n' +
        "export fun same(p: Pair): Bool =\n" +
        "    match p\n" +
        "        Pair({first = North, second = North}) => True\n" +
        "        _ => False\n" +
        "export let both: Bool =\n" +
        "    same(Pair({first = Direction.North, second = Direction.North}))\n" +
        "export let mixed: Bool =\n" +
        "    same(Pair({first = Direction.North, second = Direction.East}))\n"],
    ] as const;
    expect(messages(files as never)).toEqual([]);
    const module = await runProject(files as never);
    expect([module["both"], module["mixed"]]).toEqual([true, false]);
  });
});

describe("Pattern Matching §15 (p2) — the lambda-parameter seat, one-sided", () => {
  const PAIR = [
    "/pair.hex",
    "export record Pair = {first: Int, second: Int}\n",
  ] as const;

  test("under no supplying seat the head is refused, with the seat that would open it", () => {
    expect(messages([
      PAIR,
      ["/main.hex",
        'import Pairs from "./pair"\n' +
        "let first = Pair({first, second}) => first\n"],
    ])).toEqual([
      "no bare `Pair` here: its type is not determined at this pattern — " +
        "write `Pairs.Pair(…)`, or bind the function with its own annotated `let`",
    ]);
  });

  test("under a supplying seat the door opens", () => {
    expect(messages([
      PAIR,
      ["/main.hex",
        'import Pairs from "./pair"\n' +
        "export fun firstOf(p: Pairs.Pair): Int =\n" +
        "    match p\n" +
        "        Pair({first, second}) => first\n"],
    ])).toEqual([]);
  });

  test("a `for..in` subject is typed before its pattern, so the door opens there too", () => {
    expect(messages([
      PAIR,
      ["/main.hex",
        'import Pairs from "./pair"\n' +
        "export fun total(ps: Vector(Pairs.Pair)): Int =\n" +
        "    var sum = 0\n" +
        "    for Pair({first, second}) in ps\n" +
        "        sum := sum + first\n" +
        "    sum\n"],
    ])).toEqual([]);
  });
});

describe("Pattern Matching §15 (q) — beneath the top, the slot as it stands", () => {
  test("a sibling arm's qualified pattern fixes the payload for the arms below it", () => {
    expect(messages([
      DIRECTION,
      ["/main.hex",
        'import Direction from "./direction"\n' +
        "export let a: Int =\n" +
        "    match None\n" +
        "        Some(Direction.North) => 1\n" +
        "        Some(East) => 2\n" +
        "        _ => 0\n"],
    ])).toEqual([]);
  });

  test("— and the other order is a refusal, never a different meaning", () => {
    expect(messages([
      DIRECTION,
      ["/main.hex",
        'import Direction from "./direction"\n' +
        "export let b: Int =\n" +
        "    match None\n" +
        "        Some(East) => 2\n" +
        "        Some(Direction.North) => 1\n" +
        "        _ => 0\n"],
    ])).toEqual([
      "no bare `East` here: its type is not determined at this pattern — " +
        "write `Direction.East`, or ascribe the scrutinee",
    ]);
  });
});

describe("a `catch` arm is no seat of the door's (§2.2)", () => {
  test("an imported exception is reached through its alias", async () => {
    const files = [
      ["/blast.hex", "export exception Blast(code: Int)\n"],
      ["/main.hex",
        'import Blast from "./blast"\n' +
        "export fun f(): Int =\n" +
        "    try\n" +
        "        throw(Blast.Blast(3))\n" +
        "    catch\n" +
        "        Blast.Blast(c) => c\n" +
        "export let caught: Int = f()\n"],
    ] as const;
    expect(messages(files as never)).toEqual([]);
    expect((await runProject(files as never))["caught"]).toBe(3);
  });

  test("a bare head the arm does not bind is refused with the route it has", () => {
    expect(messages([
      ["/blast.hex", "export exception Blast(code: Int)\n"],
      ["/main.hex",
        'import Boom from "./blast"\n' +
        "export fun f(): Int =\n" +
        "    try\n" +
        "        1\n" +
        "    catch\n" +
        "        Blast(c) => c\n"],
    ])).toEqual(["no bare `Blast`; write `Boom.Blast`"]);
  });
});

describe("Modules §5.3's uniform access reaches an honored member through the alias", () => {
  test("`Alias.member` works for a constraint the aliased module honors at its own type", async () => {
    const files = [
      ["/sized.hex", "export constraint Sized<a> =\n    size(value: a): Int\n"],
      ["/box.hex",
        'import Sized from "./sized"\n' +
        "export record Box = {n: Int}\n" +
        "honor Sized.Sized<Box> =\n    size(value) = value.n\n"],
      ["/main.hex",
        'import Box from "./box"\n' +
        "export let n: Int = Box.size(Box.Box({n = 3}))\n"],
    ] as const;
    expect(messages(files as never)).toEqual([]);
    expect((await runProject(files as never))["n"]).toBe(3);
  });
});

describe("FFI Part 7 §2.4 — a bare face reached by rule 3 mints at rung 5", () => {
  test("the declaration file imports the type under its own name", () => {
    const project = compileFiles([
      POINT,
      ["/main.hex",
        'import Point from "./point"\n' +
        "export fun mid(p: Point): Point = p\n"],
    ]);
    expect(project.diagnostics).toEqual([]);
    const declaration = project.modules
      .find(({ source }) => source.path === "/main.hex")!.declarations!.text;
    expect(declaration).toContain('import type { Point } from "./point.js";');
    expect(declaration).toContain("export declare function mid(p: Point): Point;");
  });
});
