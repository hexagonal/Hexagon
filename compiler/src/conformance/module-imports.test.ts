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

describe("Modules §5.1 rule 3 — the term-position fallback, in both its shapes", () => {
  /**
   * §5.1 rule 3 names two shapes: "a nominal record's, **or a union constructor
   * spelled like the alias**". Both are pinned by *running* the program, not by
   * its diagnostics: in the emitted module a bare rule-3 reference and the
   * alias's namespace binding are the same identifier, so a reference rendered
   * bare type-checks and then throws `TypeError` at load. Since #770 an
   * *application* names neither — it erases into its object literal, §13(k)'s
   * golden — and the spelling the fallback answers with is read only where the
   * constructor is handed on as a value, which is the third test below.
   */
  const TAG = [
    "/tag.hex",
    "export union Tag = Tag(n: Int) | Other\n",
  ] as const;

  test("a union constructor spelled like its alias constructs, and runs", async () => {
    const files = [
      TAG,
      ["/main.hex",
        'import Tag from "./tag"\n' +
        "export let t: Tag = Tag(7)\n" +
        "export let n: Int =\n" +
        "    match t\n" +
        "        Tag(k) => k\n" +
        "        Other => 0\n"],
    ] as const;
    expect(messages(files as never)).toEqual([]);
    expect((await runProject(files as never))["n"]).toBe(7);
  });

  test("— and the emitted construction is the object literal, §13(k)'s golden", () => {
    // Unions §6.4 erases a union construction into its object literal at every
    // seat, home and abroad, and rule 3's fallback is one of those seats
    // (#770). Two properties in one pin: the literal itself, and the import
    // line standing for a dependency the emitted body now names nowhere
    // (§11.3, §8.2's load order).
    //
    // The `not` rows are the miscompile #765 closed, kept falsifiable: neither
    // a bare `Tag(7)`, which would call the namespace object and throw at load,
    // nor the interim `Tag.Tag(7)`, which called the export — an application
    // reaches no function at all now.
    const javascript = emitted([
      TAG,
      ["/main.hex", 'import Tag from "./tag"\nexport let t: Tag = Tag(7)\n'],
    ], "/main.hex");
    expect(javascript).toContain('import * as Tag from "./tag.js";');
    expect(javascript).toContain('const t = { tag: "Tag", n: 7 };');
    expect(javascript).not.toContain("Tag(7)");
  });

  test("a constructor referenced as a value keeps a name either way", () => {
    // The route the erasure does not touch (#770): a constructor handed on
    // rather than applied has no construction to erase, so it is spelled —
    // through the alias's local, which is what the `emitted` spelling exists
    // for (Modules §11.2), and which is now the only reader of it.
    const javascript = emitted([
      TAG,
      ["/main.hex",
        'import Tag from "./tag"\n' +
        "export let mk: (Int) -> Tag = Tag\n"],
    ], "/main.hex");
    expect(javascript).toContain("const mk = Tag.Tag;");
  });

  test("a nominal record's constructor runs too, and erases to its object", async () => {
    const files = [
      POINT,
      ["/main.hex",
        'import Point from "./point"\n' +
        "export let p: Point = Point({x = 1.5, y = 2.0})\n" +
        "export let n: Float = p.x\n"],
    ] as const;
    expect(messages(files as never)).toEqual([]);
    expect((await runProject(files as never))["n"]).toBe(1.5);
  });

  test("two aliases onto one module, each spelled like a different constructor", async () => {
    // §3.1's legal pair, meeting rule 3 twice: neither bare word may render as
    // the namespace binding it shares its spelling with.
    const files = [
      SHAPE,
      ["/main.hex",
        'import Circle from "./shape"\n' +
        'import Rect from "./shape"\n' +
        "export let a: Circle.Shape = Circle(1.0)\n" +
        "export let b: Circle.Shape = Rect(2.0, 3.0)\n" +
        "export fun width(s: Circle.Shape): Float =\n" +
        "    match s\n" +
        "        Circle(r) => r\n" +
        "        Rect(w, h) => w\n" +
        "export let first: Float = width(a)\n" +
        "export let second: Float = width(b)\n"],
    ] as const;
    expect(messages(files as never)).toEqual([]);
    const module = await runProject(files as never);
    expect([module["first"], module["second"]]).toEqual([1, 2]);
  });

  test("a prelude companion answers through its own local, not a qualifier", async () => {
    // The prelude route is the one `#reachPreludeTerm` owns, and it comes
    // first: a prelude module has no import line for a qualifier to name.
    const files = [
      ["/main.hex",
        "export let s: Seq(Int) = Seq.empty\n" +
        "export let n: Int = Seq.length(s)\n"],
    ] as const;
    expect(messages(files as never)).toEqual([]);
    expect((await runProject(files as never))["n"]).toBe(0);
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

/**
 * Emission (Modules §11.2–§11.3).
 *
 * **These are §13(k)'s golden, as #768 amended it.** §11.2 is now "Resolved
 * names, either ESM shape": a module-alias import may lower to JavaScript's
 * namespace import — `import * as Geo from "./geometry.js"`, the shape it has
 * had since #565/#569 — or to named imports, semantics identical either way,
 * since every `Alias.name` resolves at compile time to a specific export. §13
 * (k)'s golden carries the namespace form, with the named shape noted as
 * equally lawful. The tests below match it.
 *
 * §13(k)'s other half is the **construction**, and it is no longer interim: a
 * union construction reached through §5.1 rule 3 emits `const t = {tag: "Tag",
 * n: 7};`, Unions §6.4's erasure at every seat (#770). The rule 3 block above
 * pins it, together with the import line that stands even though the emitted
 * body reads no name of the alias's.
 */
describe("emission: the module form's ESM shape (§11.2–§11.3)", () => {
  test("the module form emits the namespace import; either ESM shape, one meaning", () => {
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

describe("the opaque family's pattern refusal, both nominal kinds", () => {
  // Pattern Matching §2.4 and §12: a constructor pattern over an opaque type
  // abroad — **a written head or the door's** — draws the opaque family's own
  // sentence at the type's own noun, never a constructor no spelling in this
  // module can write and never the mechanism's "does not export". The record
  // half is §13(c)'s above; this is its union twin, and the door is what makes
  // the union half reachable at all, since it reads the *declaration* rather
  // than scope.
  const HANDLE = [
    "/handle.hex",
    "opaque union Handle = FileH(fd: Int) | NetH(sock: Int)\n" +
      "export fun make(n: Int): Handle = FileH(n)\n",
  ] as const;

  test("a bare constructor pattern over an opaque union abroad is refused", () => {
    expect(messages([
      HANDLE,
      ["/main.hex",
        'import Handle from "./handle"\n' +
        "export fun f(): Int =\n" +
        "    match Handle.make(1)\n" +
        "        FileH(n) => n\n" +
        "        NetH(s) => s\n"],
    ])).toEqual([
      "cannot destructure opaque union `Handle`; " +
        "use an operation exported by its home module",
      "cannot destructure opaque union `Handle`; " +
        "use an operation exported by its home module",
    ]);
  });

  test("— and inside the home module `opaque` changes nothing", () => {
    expect(messages([
      ["/handle.hex",
        "opaque union Handle = FileH(fd: Int) | NetH(sock: Int)\n" +
        "export fun width(h: Handle): Int =\n" +
        "    match h\n" +
        "        FileH(n) => n\n" +
        "        NetH(s) => s\n"],
    ])).toEqual([]);
  });

  test("the written head takes the same sentence, not the mechanism's", () => {
    // The two spellings are one refusal (§2.4). "does not export" would be true
    // of the export table and silent about the rule: an opaque type exports its
    // name and no constructor, which is what `opaque` *means*.
    expect(messages([
      HANDLE,
      ["/main.hex",
        'import Handle from "./handle"\n' +
        "export fun f(): Int =\n" +
        "    match Handle.make(1)\n" +
        "        Handle.FileH(_) => 1\n"],
    ])).toEqual([
      "cannot destructure opaque union `Handle`; " +
        "use an operation exported by its home module",
    ]);
  });

  test("rule 3 declining on opacity splits by seat, one message each (#768)", () => {
    // Modules §5.1 rule 3: in an **expression** the fallback declines with
    // §10's opaque-construction row — the alias is bound and rule 2 reaches
    // the *type* through it, so `unknown name` denied a binding that exists
    // and "modules are not values" describes rule 4's seat, not this one. In a
    // **pattern** it declines *silently* to §2.2's door, whose refusal is the
    // destructure sentence at the type's noun. Never both.
    const OPAQUE = [
      "/point.hex",
      "opaque record Point = {x: Float}\n" +
        "export fun make(): Point = Point({x = 1.0})\n",
    ] as const;
    expect(messages([
      OPAQUE,
      ["/main.hex",
        'import Point from "./point"\n' +
        "export let p: Point = Point({x = 1.0})\n"],
    ])).toEqual([
      "`Point` is opaque outside `./point`; use its exported functions",
    ]);
    expect(messages([
      OPAQUE,
      ["/main.hex",
        'import Point from "./point"\n' +
        "export fun f(): Float =\n" +
        "    match Point.make()\n" +
        "        Point(r) => 1.0\n"],
    ])).toEqual([
      "cannot destructure opaque record `Point`; " +
        "use an operation exported by its home module",
    ]);
  });

  test("the expression row names the specifier this module wrote", () => {
    expect(messages([
      ["/lib/point.hex",
        "opaque record Point = {x: Float}\n" +
        "export fun make(): Point = Point({x = 1.0})\n"],
      ["/main.hex",
        'import Point from "./lib/point"\n' +
        "export let p: Point = Point({x = 1.0})\n"],
    ])).toEqual([
      "`Point` is opaque outside `./lib/point`; use its exported functions",
    ]);
  });

  test("an opaque union's constructor reads the same way in an expression", () => {
    expect(messages([
      ["/tag.hex",
        "opaque union Tag = Tag(n: Int) | Other\n" +
        "export fun make(): Tag = Tag(1)\n"],
      ["/main.hex",
        'import Tag from "./tag"\n' +
        "export let t: Tag = Tag(7)\n"],
    ])).toEqual([
      "`Tag` is opaque outside `./tag`; use its exported functions",
    ]);
  });

  test("the route the row names works, and the type still reaches through rule 2", () => {
    expect(messages([
      ["/point.hex",
        "opaque record Point = {x: Float}\n" +
        "export fun make(): Point = Point({x = 1.0})\n"],
      ["/main.hex",
        'import Point from "./point"\n' +
        "export let p: Point = Point.make()\n"],
    ])).toEqual([]);
  });

  test("an alias spelled like some other constructor reaches nothing at all", () => {
    // The row is reachable only where the alias is spelled like the opaque
    // *type*. `opaque union Handle = FileHandle(…)` exports the type `Handle`
    // and nothing else, so an alias spelled `FileHandle` finds nothing to
    // answer with and no type's home to name — the plain unknown-name report
    // is what is true. (Its *pattern* twin is the door's, which reads the
    // expected type and refuses there.)
    expect(messages([
      ["/handles.hex",
        "opaque union Handle = FileHandle(fd: Int)\n" +
        "export fun make(): Handle = FileHandle(1)\n"],
      ["/main.hex",
        'import Handles from "./handles"\n' +
        'import FileHandle from "./handles"\n' +
        "export let h: Handles.Handle = FileHandle(1)\n"],
    ])).toEqual(["unknown name `FileHandle`"]);
  });

  test("a non-opaque alias of the same shape still reaches the constructor", () => {
    // The gate is opacity and nothing else: the row must not fire wherever an
    // alias happens to be spelled like a constructor.
    expect(messages([
      POINT,
      ["/main.hex",
        'import Point from "./point"\n' +
        "export let p: Point = Point({x = 1.0, y = 2.0})\n"],
    ])).toEqual([]);
  });

  test("a record's written head reads the same way, at its own noun", () => {
    expect(messages([
      ["/point.hex",
        "opaque record Point = {x: Float}\n" +
        "export fun make(): Point = Point({x = 1.0})\n"],
      ["/main.hex",
        'import P from "./point"\n' +
        "export fun f(): Float =\n" +
        "    match P.make()\n" +
        "        P.Point(_) => 1.0\n"],
    ])).toEqual([
      "cannot destructure opaque record `Point`; " +
        "use an operation exported by its home module",
    ]);
  });

  test("a name the module genuinely does not export keeps the mechanism's report", () => {
    // The gate is opacity, not absence: a spelling no declaration of the
    // exporter's holds is still the ordinary does-not-export sentence.
    expect(messages([
      HANDLE,
      ["/main.hex",
        'import Handle from "./handle"\n' +
        "export fun f(): Int =\n" +
        "    match Handle.make(1)\n" +
        "        Handle.Absent(_) => 1\n"],
    ])).toEqual(["module `Handle` does not export `Absent`"]);
  });
});

describe("Modules §3's reading law at the fallback's own seat", () => {
  // §3: a term-position use above its import is "the declared-later error with
  // the import-shaped fixit, `move the import above this use`, exactly as a use
  // of any term binding above its declaration". Rule 3's fallback is a term
  // position, so it reads the same way — and `unknown name` would be false
  // about a spelling that resolves one line down.
  test("a rule-3 construction above its import is the declared-later error", () => {
    expect(messages([
      POINT,
      ["/main.hex",
        "export let p: Point.Point = Point({x = 1.0, y = 2.0})\n" +
        'import Point from "./point"\n'],
    ])).toEqual([
      "`Point` is declared later in this block; declarations are read " +
        "top-down — move the import above this use",
    ]);
  });

  test("the qualified route reads identically, and always has", () => {
    expect(messages([
      GEOMETRY,
      ["/main.hex",
        "export let n: Float = Geo.area(1.0)\n" +
        'import Geo from "./geometry"\n'],
    ])).toEqual([
      "`Geo.area` is declared later in this block; declarations are read " +
        "top-down — move the import above this use",
    ]);
  });

  test("a rule-3 *pattern* above the import compiles — §3 makes it order-free", () => {
    // The other half of the same law: a type-position and a pattern-position
    // mention are order-insensitive, and only the term half reads top-down.
    expect(messages([
      POINT,
      ["/main.hex",
        "export fun f(p: Point): Float =\n" +
        "    match p\n" +
        "        Point({x, y}) => x\n" +
        'import Point from "./point"\n'],
    ])).toEqual([]);
  });

  test("moving the import is the repair the message names", () => {
    expect(messages([
      POINT,
      ["/main.hex",
        'import Point from "./point"\n' +
        "export let p: Point = Point({x = 1.0, y = 2.0})\n"],
    ])).toEqual([]);
  });

  test("§10's row: a qualified term above an occluding alias reads the same", () => {
    // §5.4 keeps "a module import, whose alias may occlude a prelude module's",
    // and §10 has its own row for a use above the line that binds it. The
    // *below* direction is pinned in §13 (f) above; this is the seat that
    // survived the named import's deletion.
    expect(messages([
      ["/vector.hex", "export fun size(n: Int): Int = n\n"],
      ["/main.hex",
        "export let n: Int = Vector.size(1)\n" +
        'import Vector from "./vector"\n'],
    ])).toEqual([
      "`Vector.size` is declared later in this block; declarations are read " +
        "top-down — move the import above this use",
    ]);
  });
});

describe("the derived alias reads every separator §3.1 names", () => {
  const refusal = (specifier: string): string =>
    messages([
      [`${specifier.slice(1)}.hex`, "export fun get(n: Int): Int = n\n"],
      ["/main.hex", `import { get } from "${specifier}"\n`],
    ])[0] ?? "";

  test("`-`, `_` and `.` all split, and each segment is upper-cased at its start", () => {
    expect(refusal("./search-params")).toContain("`import SearchParams from");
    expect(refusal("./search_params")).toContain("`import SearchParams from");
    expect(refusal("./search.params")).toContain("`import SearchParams from");
  });

  test("a basename with no separator is upper-cased whole", () => {
    expect(refusal("./geometry")).toContain("`import Geometry from");
  });
});

describe("a nominal record reached only through a signature (#587, #763)", () => {
  // The isolating pin for the door's own record path: `/main.hex` names `Crate`
  // under no alias and through no annotation — the type arrives on `Mid.make`'s
  // result alone — so the constructor the eliminator needs exists nowhere in
  // this module's own tables and is materialized from the program's copy of the
  // declaration.
  test("the door destructures it, with no field access to materialize it first", async () => {
    const files = [
      ["/crate.hex", "export record Crate = {n: Float}\n"],
      ["/mid.hex",
        'import Crate from "./crate"\n' +
        "export fun make(value: Float): Crate = Crate({n = value})\n"],
      ["/main.hex",
        'import Mid from "./mid"\n' +
        "export fun reading(): Float =\n" +
        "    let Crate({n}) = Mid.make(2.5)\n" +
        "    n\n" +
        "export let out: Float = reading()\n"],
    ] as const;
    expect(messages(files as never)).toEqual([]);
    expect((await runProject(files as never))["out"]).toBe(2.5);
  });

  test("— and the emitted destructure reads the record's own field", () => {
    const javascript = emitted([
      ["/crate.hex", "export record Crate = {n: Float}\n"],
      ["/mid.hex",
        'import Crate from "./crate"\n' +
        "export fun make(value: Float): Crate = Crate({n = value})\n"],
      ["/main.hex",
        'import Mid from "./mid"\n' +
        "export fun reading(): Float =\n" +
        "    let Crate({n}) = Mid.make(2.5)\n" +
        "    n\n"],
    ], "/main.hex");
    expect(javascript).toContain("const { n } = Mid.make(2.5);");
    // Never the positional slot a union constructor's pattern would read: the
    // record has no `item1`, and lowering it as one is the defect this pins.
    expect(javascript).not.toContain("item1");
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
  test("a module's own constructor of the spelling wins, and the arm says which", () => {
    // §12's rival-constructor row, verbatim: the arm's ordinary type error is
    // replaced by the one that names the constructor scope answered with, the
    // type the arm is judged against, and the pastable spelling of the
    // constructor that type does hold.
    expect(messages([
      DIRECTION,
      ["/main.hex",
        'import Direction from "./direction"\n' +
        "union Compass = North | South\n" +
        "export fun h(d: Direction): Int =\n" +
        "    match d\n" +
        "        North => 1\n" +
        "        _ => 0\n"],
    ])).toEqual([
      "`North` here is `Compass.North`; this arm matches a `Direction` — " +
        "write `Direction.North`",
    ]);
  });

  test("— and the spelling it names compiles", () => {
    expect(messages([
      DIRECTION,
      ["/main.hex",
        'import Direction from "./direction"\n' +
        "union Compass = North | South\n" +
        "export fun h(d: Direction): Int =\n" +
        "    match d\n" +
        "        Direction.North => 1\n" +
        "        _ => 0\n"],
    ])).toEqual([]);
  });

  test("a record rival the module declares is named the same way (#768)", () => {
    // §12's row reaches a nominal record's rival too. `Box.Box` would say
    // nothing — a record constructor shares its declaration's name — so the
    // clause names where the binding *is*, the type is shown through the
    // spelling that means it here, and the rewrite echoes the reader's own
    // sub-pattern. The sentence exists to replace the same-name tell
    // (`expected Box, found Box`), which is what this program used to draw.
    expect(messages([
      ["/h.hex",
        "export record Box = {n: Int}\n" +
        "export let mk = (): Box => Box({n = 1})\n"],
      ["/main.hex",
        'import H from "./h"\n' +
        "record Box = {n: Int}\n" +
        "export fun f(): Int =\n" +
        "    match H.mk()\n" +
        "        Box({n = 0}) => 1\n"],
    ])).toEqual([
      "`Box` here is this module's `Box`; this pattern matches a `H.Box` — " +
        "write `H.Box({n = 0})`",
    ]);
  });

  test("— and the spelling it names compiles", () => {
    expect(messages([
      ["/h.hex",
        "export record Box = {n: Int}\n" +
        "export let mk = (): Box => Box({n = 1})\n"],
      ["/main.hex",
        'import H from "./h"\n' +
        "record Box = {n: Int}\n" +
        "export fun f(): Int =\n" +
        "    match H.mk()\n" +
        "        H.Box({n = 0}) => 1\n" +
        "        _ => 0\n"],
    ])).toEqual([]);
  });

  test("a record rival reached through rule 3 names the alias that reached it", () => {
    // The other route a bare record constructor has (Modules §5.1 rule 3).
    // "this module's `Box`" would be false here, so the clause names the alias
    // instead — the same question answered, never a claim the program does not
    // support.
    expect(messages([
      ["/h.hex",
        "export record Box = {n: Int}\n" +
        "export let mk = (): Box => Box({n = 1})\n"],
      ["/other.hex", "export record Box = {q: Int}\n"],
      ["/main.hex",
        'import H from "./h"\n' +
        'import Box from "./other"\n' +
        "export fun f(): Int =\n" +
        "    match H.mk()\n" +
        "        Box({q = 0}) => 1\n"],
    ])).toEqual([
      "`Box` here is `Box.Box`; this pattern matches a `H.Box` — " +
        "write `H.Box({q = 0})`",
    ]);
  });

  test("no alias reaching the home routes the rewrite through the one the clause binds", () => {
    // §12's third reading, at the tier the alias cases never reach: the expected
    // type arrives through a facade, so this file holds no alias for its home
    // and bare is taken by the rival. §7.3 tier 3 answers with the bare name
    // plus a route — right for a witness, which is pasted once the import
    // exists, and wrong for a rewrite, where the bare word *is* the rival. So
    // the rewrite is spelled through the alias the clause binds, and the clause
    // rides with it.
    expect(messages([
      ["/direction.hex", "export union Holder = North | Empty\n"],
      ["/mid.hex",
        'import Lib from "./direction"\n' +
        "export fun get(): Lib.Holder = Lib.Empty\n"],
      ["/main.hex",
        'import Mid from "./mid"\n' +
        "union Compass = North | South\n" +
        "export fun f(): Int =\n" +
        "    match Mid.get()\n" +
        "        North => 1\n" +
        "        _ => 0\n"],
    ])).toEqual([
      "`North` here is `Compass.North`; this arm matches a `Holder` — " +
        "write `Direction.North` — `North` is declared in `./direction`, and " +
        "this module binds another `North`; `import Direction from \"./direction\"` " +
        "and spell it `Direction.North`",
    ]);
  });

  test("— and the spelling it names compiles, once the import it names is made", () => {
    expect(messages([
      ["/direction.hex", "export union Holder = North | Empty\n"],
      ["/mid.hex",
        'import Lib from "./direction"\n' +
        "export fun get(): Lib.Holder = Lib.Empty\n"],
      ["/main.hex",
        'import Mid from "./mid"\n' +
        'import Direction from "./direction"\n' +
        "union Compass = North | South\n" +
        "export fun f(): Int =\n" +
        "    match Mid.get()\n" +
        "        Direction.North => 1\n" +
        "        _ => 0\n"],
    ])).toEqual([]);
  });

  test("— and at tier 3 the rewrite still echoes the reader's own sub-pattern", () => {
    expect(messages([
      ["/direction.hex", "export union Holder = North(n: Int) | Empty\n"],
      ["/mid.hex",
        'import Lib from "./direction"\n' +
        "export fun get(): Lib.Holder = Lib.Empty\n"],
      ["/main.hex",
        'import Mid from "./mid"\n' +
        "union Compass = North(m: Int) | South\n" +
        "export fun f(): Int =\n" +
        "    match Mid.get()\n" +
        "        North(n) => n\n" +
        "        _ => 0\n"],
    ])).toEqual([
      "`North` here is `Compass.North`; this arm matches a `Holder` — " +
        "write `Direction.North(n)` — `North` is declared in `./direction`, and " +
        "this module binds another `North`; `import Direction from \"./direction\"` " +
        "and spell it `Direction.North`",
    ]);
  });

  test("a **record** rival routes the same way, through its own declaring path", () => {
    // The record shape of the tier-3 case above, and the arm the union pins
    // cannot reach: `#constructorSpelling` needs the expected type's declaring
    // path to fall past tier 1 at all, and a record arm that passed none
    // answered bare — the identical fault one nominal over. Here the rival is
    // this module's own `Box`, so the bare word is taken and the rewrite has to
    // be routed.
    expect(messages([
      ["/lib.hex", "export record Box = {n: Int}\n"],
      ["/mid.hex",
        'import Lib from "./lib"\n' +
        "export fun get(): Lib.Box = Lib.Box({n = 1})\n"],
      ["/main.hex",
        'import Mid from "./mid"\n' +
        "record Box = {n: Int}\n" +
        "export fun f(): Int =\n" +
        "    match Mid.get()\n" +
        "        Box({n}) => n\n"],
    ])).toEqual([
      "`Box` here is this module's `Box`; this pattern matches a `Lib.Box` — " +
        "write `Lib.Box({n})` — `Box` is declared in `./lib`, and this module " +
        "binds another `Box`; `import Lib from \"./lib\"` and spell it `Lib.Box`",
    ]);
  });

  test("— and that spelling compiles, once the import it names is made", () => {
    expect(messages([
      ["/lib.hex", "export record Box = {n: Int}\n"],
      ["/mid.hex",
        'import Lib from "./lib"\n' +
        "export fun get(): Lib.Box = Lib.Box({n = 1})\n"],
      ["/main.hex",
        'import Mid from "./mid"\n' +
        'import Lib from "./lib"\n' +
        "record Box = {n: Int}\n" +
        "export fun f(): Int =\n" +
        "    match Mid.get()\n" +
        "        Lib.Box({n}) => n\n"],
    ])).toEqual([]);
  });

  test("— and the record rewrite is never the rival's own word either", () => {
    const reported = messages([
      ["/lib.hex", "export record Box = {n: Int}\n"],
      ["/mid.hex",
        'import Lib from "./lib"\n' +
        "export fun get(): Lib.Box = Lib.Box({n = 1})\n"],
      ["/main.hex",
        'import Mid from "./mid"\n' +
        "record Box = {n: Int}\n" +
        "export fun f(): Int =\n" +
        "    match Mid.get()\n" +
        "        Box({n}) => n\n"],
    ])[0] ?? "";
    expect(reported).not.toContain("— write `Box(");
  });

  test("the rewrite is never the rival's own word", () => {
    // The property the whole reading exists for, asserted directly: whatever
    // spelling is offered, pasting it must not reproduce the same error.
    const reported = messages([
      ["/direction.hex", "export union Holder = North | Empty\n"],
      ["/mid.hex",
        'import Lib from "./direction"\n' +
        "export fun get(): Lib.Holder = Lib.Empty\n"],
      ["/main.hex",
        'import Mid from "./mid"\n' +
        "union Compass = North | South\n" +
        "export fun f(): Int =\n" +
        "    match Mid.get()\n" +
        "        North => 1\n" +
        "        _ => 0\n"],
    ])[0] ?? "";
    expect(reported).not.toContain("— write `North`");
  });

  test("an opaque expected type leads with its own refusal, naming no private spelling", () => {
    // There is no qualified spelling for the rival clause to name: the
    // constructor is private abroad. The deeper fault is reported alone.
    expect(messages([
      ["/h.hex",
        "opaque record Box = {n: Int}\n" +
        "export let mk = (): Box => Box({n = 1})\n"],
      ["/main.hex",
        'import H from "./h"\n' +
        "record Box = {n: Int}\n" +
        "export fun f(): Int =\n" +
        "    match H.mk()\n" +
        "        Box({n = 0}) => 1\n"],
    ])).toEqual([
      "cannot destructure opaque record `Box`; " +
        "use an operation exported by its home module",
    ]);
  });

  test("an opaque union's expected type reads the same way", () => {
    expect(messages([
      ["/h.hex",
        "opaque union Tag = Tag(n: Int) | Other\n" +
        "export let mk = (): Tag => Tag(1)\n"],
      ["/main.hex",
        'import H from "./h"\n' +
        "union Mine = Tag(n: Int)\n" +
        "export fun f(): Int =\n" +
        "    match H.mk()\n" +
        "        Tag(n) => n\n"],
    ])).toEqual([
      "cannot destructure opaque union `Tag`; " +
        "use an operation exported by its home module",
    ]);
  });

  test("an opaque expected type the rival's spelling misses keeps the mismatch", () => {
    // The gate is "a constructor of this spelling the reader may not write",
    // not "the type is opaque": a plain mismatch is honest about itself.
    expect(messages([
      ["/h.hex",
        "opaque record Crate = {n: Int}\n" +
        "export let mk = (): Crate => Crate({n = 1})\n"],
      ["/main.hex",
        'import H from "./h"\n' +
        "record Box = {n: Int}\n" +
        "export fun f(): Int =\n" +
        "    match H.mk()\n" +
        "        Box({n = 0}) => 1\n"],
    ])).toEqual(["type mismatch: expected Crate, found Box"]);
  });

  test("a rival the expected type does not hold keeps the ordinary mismatch", () => {
    // The row is conditioned on the expected type holding the spelling. With no
    // such constructor there is no third reading to name, and inventing one
    // would send the reader at a word that does not exist.
    expect(messages([
      DIRECTION,
      ["/main.hex",
        'import Direction from "./direction"\n' +
        "union Compass = Up | Down\n" +
        "export fun h(d: Direction): Int =\n" +
        "    match d\n" +
        "        Up => 1\n" +
        "        _ => 0\n"],
    ])).toEqual(["type mismatch: expected Direction, found Compass"]);
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
    // §15(p2) verbatim. The rewrite echoes the reader's **own** sub-pattern —
    // §2.4's convention for the whole redirect family — so the line it names is
    // the line they wrote with one qualifier added, never a shape they have to
    // reconstruct.
    expect(messages([
      PAIR,
      ["/main.hex",
        'import Pairs from "./pair"\n' +
        "let first = Pair({first, second}) => first\n"],
    ])).toEqual([
      "no bare `Pair` here: its type is not determined at this pattern — write " +
        "`Pairs.Pair({first, second})`, or bind the function with its own annotated `let`",
    ]);
  });

  test("— and the echoed rewrite is the reader's own pattern, whatever it wrote", () => {
    // Renames, wildcards and nesting all come back as written; punning is
    // restored where the field's sub-pattern is a binder of its own name, which
    // is the one place two spellings read back to one tree.
    const refusal = (head: string): string =>
      messages([
        PAIR,
        ["/main.hex", 'import Pairs from "./pair"\n' + `let f = ${head} => 1\n`],
      ])[0] ?? "";
    expect(refusal("Pair({first = a, second = _})")).toContain(
      "write `Pairs.Pair({first = a, second = _})`",
    );
    expect(refusal("Pair(whole)")).toContain("write `Pairs.Pair(whole)`");
    expect(refusal("Pair({first} as p)")).toContain("write `Pairs.Pair({first} as p)`");
  });

  test("a nullary head takes no argument list at all", () => {
    // §15(q)'s own arm, which the rewrite must not decorate.
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
