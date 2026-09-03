import { describe, expect, test } from "vitest";

import { PROVIDED_ROW_ALIASES } from "../passes/resolver/resolver.js";
import { PRELUDE_SOURCES } from "../prelude-sources.js";
import { compileFiles, projectDiagnostics, runProject } from "../support/test-project.js";

/**
 * Conformance for Functions §7.2–§7.3 and Method Syntax §4.4 (#293).
 *
 * Every term reference — a bare name and equally a dot call — targets a
 * declaration above it. The one exception is a contiguous run of `fun`s, whose
 * members' bodies see each other; a dot call does not even get that exception,
 * because dispatch is invisible to the reference graph the resolver and
 * inference both read.
 */

const DECLARED_LATER = (name: string): string =>
  `\`${name}\` is declared later in this block; declarations are read ` +
  "top-down — move its declaration above this use";

/** *(#700.)* §7.3's wrap rewrite: two separate `fun`s are two blocks. */
const CROSS_BLOCK = (name: string): string =>
  `\`${name}\` is declared later in this block; only members of one \`fun\` ` +
  "block recurse together; wrap both definitions as its members";

const DECLARED_BELOW = (type: string, name: string): string =>
  `\`${type}\`'s companion declares \`${name}\` below this call; declarations ` +
  "are read top-down — move the declaration above this call";

/** §7.2's repair when the movable item is an `import` line (Modules §3). */
const MOVE_IMPORT = (name: string): string =>
  `\`${name}\` is declared later in this block; declarations are read ` +
  "top-down — move the import above this use";

const BOX = "export record Box = {value: Int}\n";
const TWICE_LET = "export let twice(b: Box): Int = b.value * 2\n";
const TWICE_FUN = "export fun twice(b: Box): Int = b.value * 2\n";

function diagnostics(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

describe("a lexical reference reads top-down", () => {
  test("a module right-hand side cannot name a later `let`", () => {
    expect(projectDiagnostics(
      BOX + "export let use: Int = twice(Box({value = 3}))\n" + TWICE_LET,
    )).toEqual([DECLARED_LATER("twice")]);
  });

  test("...nor a later `fun`", () => {
    expect(projectDiagnostics(
      BOX + "export let use: Int = twice(Box({value = 3}))\n" + TWICE_FUN,
    )).toEqual([DECLARED_LATER("twice")]);
  });

  test("a lambda body is no exception, however late it runs", () => {
    expect(projectDiagnostics(
      BOX + "export let use(x: Box): Int = twice(x)\n" + TWICE_LET,
    )).toEqual([DECLARED_LATER("twice")]);
  });

  test("a `fun` body is no exception either", () => {
    expect(projectDiagnostics(
      BOX + "export fun use(x: Box): Int = twice(x)\n" + TWICE_LET +
      "export let out: Int = use(Box({value = 3}))\n",
    )).toEqual([DECLARED_LATER("twice")]);
  });

  test("a `fun` reaching a later `let` through another `fun`'s mention is refused too", () => {
    // The soundness hole this ruling closes. `capturer` mentioning `twice`
    // lexically used to be what gave the dot call in `use` a scheme to dispatch
    // against, while leaving `use`'s own capture set empty — so `out` ran before
    // `twice` was bound and the module threw `ReferenceError` on load with no
    // diagnostic at all.
    expect(projectDiagnostics(
      BOX +
      "export fun capturer(x: Box): Int = twice(x)\n" +
      "export fun use(x: Box): Int = x.twice()\n" +
      "export let out: Int = use(Box({value = 3}))\n" +
      TWICE_LET,
    )).toEqual([
      DECLARED_LATER("twice"),
      DECLARED_BELOW("Box", "twice"),
    ]);
  });

  test("the lexical control on the same shape reports once", () => {
    expect(projectDiagnostics(
      BOX +
      "export fun capturer(x: Box): Int = twice(x)\n" +
      "export fun use(x: Box): Int = twice(x)\n" +
      "export let out: Int = use(Box({value = 3}))\n" +
      TWICE_LET,
    )).toEqual([DECLARED_LATER("twice"), DECLARED_LATER("twice")]);
  });

  test("a `fun` whose own later reference is a plain value is refused at the reference", () => {
    expect(projectDiagnostics(
      BOX +
      "export fun scaled(b: Box): Int = b.value * factor\n" +
      "export fun use(x: Box): Int = scaled(x)\n" +
      "export let out: Int = use(Box({value = 3}))\n" +
      "export let factor: Int = 2\n",
    )).toEqual([DECLARED_LATER("factor")]);
  });

  test("both reference forms are reported when a body uses both", () => {
    expect(projectDiagnostics(
      BOX +
      "export fun use(x: Box): Int = twice(x) + x.twice()\n" +
      TWICE_LET +
      "export let out: Int = use(Box({value = 3}))\n",
    )).toEqual([DECLARED_LATER("twice"), DECLARED_BELOW("Box", "twice")]);
  });
});

describe("a dot call reads top-down too (Method Syntax §4.4)", () => {
  test("a deferred dot call to a later operation is refused as declared-below", () => {
    expect(projectDiagnostics(
      BOX + "export let use(x: Box): Int = x.twice()\n" + TWICE_LET,
    )).toEqual([DECLARED_BELOW("Box", "twice")]);
  });

  test("an immediate dot call to a later operation, likewise", () => {
    expect(projectDiagnostics(
      BOX + "export let use: Int = Box({value = 3}).twice()\n" + TWICE_LET,
    )).toEqual([DECLARED_BELOW("Box", "twice")]);
  });

  test("from a `fun` body, likewise", () => {
    expect(projectDiagnostics(
      BOX +
      "export fun use(x: Box): Int = x.twice()\n" +
      TWICE_LET +
      "export let out: Int = use(Box({value = 3}))\n",
    )).toEqual([DECLARED_BELOW("Box", "twice")]);
  });

  test("a `fun` body dot-calls a `let`-header operation declared above it", async () => {
    // The filed defect (#293): the operation had no scheme when dispatch asked,
    // because `fun` bodies were checked before any textual `let` was reached.
    const main = await runProject([["/main.hex",
      BOX + TWICE_LET +
      "export fun use(x: Box): Int = x.twice()\n" +
      "export let out: Int = use(Box({value = 3}))\n",
    ]]);

    expect(main["out"]).toBe(6);
  });

  test("a `let` lambda body dot-calls a `let`-header operation declared above it", async () => {
    const main = await runProject([["/main.hex",
      BOX + TWICE_LET +
      "export let use(x: Box): Int = x.twice()\n" +
      "export let out: Int = use(Box({value = 3}))\n",
    ]]);

    expect(main["out"]).toBe(6);
  });

  test("declaration order is irrelevant to a call site in another module", async () => {
    // §4.2's import-insensitivity: an importer sees the whole exported surface,
    // so where `twice` sits in its home file is not the importer's business.
    const main = await runProject([
      ["/main.hex",
        "import Boxes from \"./boxes\"\n" +
        "export let out: Int = Boxes.Box({value = 3}).twice()\n",
      ],
      ["/boxes.hex",
        "export record Box = {value: Int}\n" +
        "export let unrelated: Int = 1\n" +
        "export fun twice(b: Box): Int = b.value * 2\n",
      ],
    ]);

    expect(main["out"]).toBe(6);
  });
});

describe("a dot call cannot make a `let` recursive (Functions §6)", () => {
  // The scheme is seeded when the item is inferred, so a candidate that has none
  // while still declared above the call can only be the operation whose own
  // right-hand side the call sits in. Reporting that as a missing operation
  // would be false — the companion declares it.
  const SELF =
    "`dup` is not in scope in its own `let` definition; `let` is non-recursive — use `fun`.";

  test("a self dot call takes the non-recursive-`let` report", () => {
    expect(projectDiagnostics(
      BOX + "export let dup(b: Box): Box = b.dup()\n",
    )).toEqual([SELF]);
  });

  test("...from an inner block of the same right-hand side too", () => {
    expect(projectDiagnostics(
      BOX +
      "export let dup(b: Box): Box =\n" +
      "    let again = b.dup()\n" +
      "    again\n",
    )).toEqual([SELF]);
  });

  test("a genuinely absent operation keeps its own report", () => {
    expect(projectDiagnostics(
      BOX + "export let use(b: Box): Int = b.nope()\n",
    )).toEqual([
      "`Box` has no field `nope`, its companion exports no operation `nope`, " +
      "and no constraint honored at `Box` has a subject-first member `nope`; " +
      "call an available subject-first function explicitly",
    ]);
  });
});

describe("a `fun` block is one group (Functions §7.3, #700)", () => {
  test("mutual recursion inside the block compiles and runs", async () => {
    const main = await runProject([["/main.hex",
      "fun\n" +
      "    even(n: Int): Bool = if n == 0 then True else odd(n - 1)\n" +
      "    odd(n: Int): Bool = if n == 0 then False else even(n - 1)\n" +
      "export let fourIsEven: Bool = even(4)\n" +
      "export let threeIsEven: Bool = even(3)\n",
    ]]);

    expect(main["fourIsEven"]).toBe(true);
    expect(main["threeIsEven"]).toBe(false);
  });

  test("two separate `fun`s are two blocks, adjacent or not", () => {
    // Adjacency is no longer load-bearing: the same program draws the same
    // wrap rewrite whether or not an item stands between the two `fun`s.
    expect(projectDiagnostics(
      "fun even(n: Int): Bool = if n == 0 then True else odd(n - 1)\n" +
      "let gap: Int = 1\n" +
      "fun odd(n: Int): Bool = if n == 0 then False else even(n - 1)\n" +
      "export let fourIsEven: Bool = even(4)\n",
    )).toEqual([CROSS_BLOCK("odd")]);

    expect(projectDiagnostics(
      "fun even(n: Int): Bool = if n == 0 then True else odd(n - 1)\n" +
      "fun odd(n: Int): Bool = if n == 0 then False else even(n - 1)\n" +
      "export let fourIsEven: Bool = even(4)\n",
    )).toEqual([CROSS_BLOCK("odd")]);
  });

  test("a comment between members does not end the block", async () => {
    const main = await runProject([["/main.hex",
      "fun\n" +
      "    even(n: Int): Bool = if n == 0 then True else odd(n - 1)\n" +
      "    // the parity pair\n" +
      "    (** Answers whether `n` is odd. *)\n" +
      "    odd(n: Int): Bool = if n == 0 then False else even(n - 1)\n" +
      "export let fourIsEven: Bool = even(4)\n",
    ]]);

    expect(main["fourIsEven"]).toBe(true);
  });

  test("membership does not monomorphize an independent member", async () => {
    // §7.3: grouping bounds visibility, not typing. The knot is the SCC of the
    // references actually written, so `ident` generalizes before `atInt`'s body
    // is checked and its use at `Int` there costs it nothing.
    const main = await runProject([["/main.hex",
      "fun\n" +
      "    ident(value) = value\n" +
      "    atInt(n: Int): Int = ident(n)\n" +
      "export let text: String = ident(\"hex\")\n" +
      "export let number: Int = atInt(7)\n",
    ]]);

    expect(main["text"]).toBe("hex");
    expect(main["number"]).toBe(7);
  });

  test("a member outside the block is reachable by dot once declared", async () => {
    const main = await runProject([["/main.hex",
      BOX + TWICE_FUN +
      "export let out: Int = Box({value = 3}).twice()\n",
    ]]);

    expect(main["out"]).toBe(6);
  });
});

describe("a dot call never targets its own `fun` block (§9 row 13)", () => {
  test("a sibling member is refused with the name spelling", () => {
    // *(#700.)* Siblings are members of **one block** now; two adjacent `fun`s
    // are two blocks, and the ban does not reach across them.
    expect(projectDiagnostics(
      BOX +
      "fun\n" +
      "    export twice(b: Box): Int = b.value * 2\n" +
      "    export quadruple(b: Box): Int = b.twice() * 2\n",
    )).toEqual([
      "a dot call cannot target its own `fun` block; spell the call by name: `twice(b)`",
    ]);
  });

  test("the member itself is refused too — recursion is spelled by name", () => {
    expect(projectDiagnostics(
      BOX +
      "export fun countDown(b: Box): Int =\n" +
      "    if b.value == 0 then 0 else Box({value = b.value - 1}).countDown()\n",
    )).toEqual([
      "a dot call cannot target its own `fun` block; spell the call by name: `countDown(…)`",
    ]);
  });

  test("a `let` read from inside a block is not a block member", async () => {
    // The ban is membership, not enclosure: a body inside the block may still
    // dot-call anything declared above the block.
    const main = await runProject([["/main.hex",
      BOX + TWICE_LET +
      "export fun go(b: Box, n: Int): Int =\n" +
      "    if n == 0 then b.twice() else go(b, n - 1)\n" +
      "export let out: Int = go(Box({value = 3}), 2)\n",
    ]]);

    expect(main["out"]).toBe(6);
  });

  test("an earlier block is not the caller's own block", async () => {
    const main = await runProject([["/main.hex",
      BOX +
      TWICE_FUN +
      "let boundary: Int = 0\n" +
      "export fun quadruple(b: Box): Int = b.twice() * 2\n" +
      "export let out: Int = quadruple(Box({value = 3}))\n",
    ]]);

    expect(main["out"]).toBe(12);
  });
});

describe("the term names a type declaration binds read top-down (§7.2)", () => {
  test("a type-position mention above the declaration is free", () => {
    expect(diagnostics([["/main.hex",
      "export fun unwrap(b: Box): Int = b.value\n" +
      "export record Box = {value: Int}\n",
    ]])).toEqual([]);
  });

  test("...but a value-position constructor use is not", () => {
    expect(diagnostics([["/main.hex",
      "export fun wrap(n: Int): Box = Box({value = n})\n" +
      "export record Box = {value: Int}\n",
    ]])).toEqual([DECLARED_LATER("Box")]);
  });

  test("a union constructor is the same", () => {
    expect(diagnostics([["/main.hex",
      "export let here: Spot = Origin\n" +
      "export union Spot = Origin | Away(Int)\n",
    ]])).toEqual([DECLARED_LATER("Origin")]);
  });

  test("a constraint member is the same", () => {
    expect(diagnostics([["/main.hex",
      "export record Box = {value: Int}\n" +
      "export let label: Int = render(Box({value = 1}))\n" +
      "export constraint Render<a> =\n" +
      "    render(value: a): Int\n" +
      "honor Render<Box> =\n" +
      "    render(value) = value.value\n",
    ]])).toEqual([DECLARED_LATER("render")]);
  });

  test("an exception constructor is the same", () => {
    expect(diagnostics([["/main.hex",
      "export let e: Exn = Bad(1)\n" +
      "exception Bad(Int)\n",
    ]])).toEqual([DECLARED_LATER("Bad")]);
  });

  test("a match arm above the union names the union as the move", () => {
    expect(diagnostics([["/main.hex",
      "export fun distance(s: Spot): Int = match s\n" +
      "    Origin => 0\n" +
      "    Away(n) => n\n" +
      "export union Spot = Origin | Away(Int)\n",
    ]])[0]).toBe(
      "`Origin` is declared later in this block; declarations are read " +
      "top-down — move the union's declaration above this use",
    );
  });

  test("a catch arm above the exception names the exception", () => {
    expect(diagnostics([["/main.hex",
      "export fun safe(): Int =\n" +
      "    try\n" +
      "        1\n" +
      "    catch\n" +
      "        Bad(n) => n\n" +
      "exception Bad(Int)\n",
    ]])[0]).toBe(
      "`Bad` is declared later in this block; declarations are read " +
      "top-down — move the exception's declaration above this use",
    );
  });

  test("a constructor named in a `fun` body above the union is the same", () => {
    expect(diagnostics([["/main.hex",
      "export fun start(): Spot = Origin\n" +
      "export union Spot = Origin | Away(Int)\n",
    ]])).toEqual([DECLARED_LATER("Origin")]);
  });
});

describe("an import straddles the reading laws it imports (Modules §3, #465, #762)", () => {
  /**
   * Modules §3: no import exemption from the reading laws exists. An import
   * binds only its module alias (#762) — nothing enters either namespace
   * directly — but what the alias *reaches* obeys **the same namespace split
   * as the declaration it qualifies** (Declarations Preamble §7.2's straddle
   * rule): a type or constraint reached through the alias (`Geo.Point`,
   * `Geo.Walk`) is order-insensitive, a term reached through it (`Geo.area`,
   * a qualified constructor call, a constraint member) is read top-down at the
   * item. The repair a term reference above the line gets is the import's
   * own, because the alias is not bound there: the line that brings it is
   * what moves.
   *
   * Every ordering pin carries its control — the same source with the import at
   * the top, compiled and *run*, so that "read top-down" is a statement about
   * where the line sits and not about the shape being wrong.
   */

  const GEOMETRY = [
    "/geometry.hex",
    "export record Point = {x: Int, y: Int}\n" +
    "export union Shape = Circle(radius: Int) | Square(side: Int)\n" +
    "export type Span = Int\n" +
    "export let area(p: Point): Int = p.x * p.y\n" +
    "export constraint Walk<a> =\n" +
    "    step(subject: a): Int\n",
  ] as const;

  describe("the term half reads top-down", () => {
    // #762 deleted the named import, so nothing is bound bare any more; what
    // is left to pin is that a reference reached *through the alias* — a
    // function, a record constructor called as a value — still reads
    // top-down from the `import` line, same as any other term-namespace use.
    // The pattern-position half of this (`Geo.Circle(r)` in a `match` arm)
    // and the constraint-member half (`Geo.step(1)`) are pinned already,
    // below, at "the alias straddles too" and "a member of a constraint the
    // exporter declares does read top-down" — this block does not repeat them.
    test("a value reference above the import that binds it", () => {
      expect(diagnostics([GEOMETRY, ["/main.hex",
        "export let early: Int = Geometry.area(Geometry.Point({x = 2, y = 3}))\n" +
        "import Geometry from \"./geometry\"\n",
      ]])).toEqual([MOVE_IMPORT("Geometry.area"), MOVE_IMPORT("Geometry.Point")]);
    });

    test("...and the control below the import runs", async () => {
      const exports = await runProject([GEOMETRY, ["/main.hex",
        "import Geometry from \"./geometry\"\n" +
        "export let below: Int = Geometry.area(Geometry.Point({x = 2, y = 3}))\n",
      ]]);

      expect(exports.below).toBe(6);
    });

    test("a qualified union constructor, in value position", () => {
      expect(diagnostics([GEOMETRY, ["/main.hex",
        "export let early: Geometry.Shape = Geometry.Circle(4)\n" +
        "import Geometry from \"./geometry\"\n",
      ]])).toEqual([MOVE_IMPORT("Geometry.Circle")]);
    });
  });

  describe("the type half is order-insensitive", () => {
    // #762: a named import that only *renamed the winner of a collision*
    // (§3's old "only what binds reads top-down" pin, PACES/CONTEST above)
    // has no seat left — a module alias never collides with a same-spelled
    // local constraint, they live in different namespaces, so there is no
    // longer a contest whose loser's members might or might not be one line
    // away. What remains is the property below: a type or constraint reached
    // through the alias resolves the same whether the `import` line sits
    // above or below the reference.
    test("a record, a union, and an alias, all named above their import", () => {
      expect(diagnostics([GEOMETRY, ["/main.hex",
        "export fun across(p: Geometry.Point): Int = p.x\n" +
        "export fun sides(s: Geometry.Shape): Int = 4\n" +
        "export let width: Geometry.Span = 3\n" +
        "import Geometry from \"./geometry\"\n",
      ]])).toEqual([]);
    });

    test("a local record whose field type is imported, the import at the bottom", () => {
      expect(diagnostics([GEOMETRY, ["/main.hex",
        "export record Placed = {at: Geometry.Point, label: String}\n" +
        "export fun where(p: Placed): Int = p.at.x\n" +
        "import Geometry from \"./geometry\"\n",
      ]])).toEqual([]);
    });

    test("a constraint name in a binder above its import", () => {
      expect(diagnostics([GEOMETRY, ["/main.hex",
        "export fun pace<a: Geometry.Walk>(x: a, fallback: Int): Int = fallback\n" +
        "import Geometry from \"./geometry\"\n",
      ]])).toEqual([]);
    });

    test("an `honor` above its import discharges against the *imported* declaration", async () => {
      // The identity pin, and the one the old behaviour failed loudest: before
      // #465 this reported `unknown constraint \`Walk\``, the name having been
      // minted file-scoped because the import had not been walked yet. The
      // member is reached by dispatch (`.step()`), since #762 leaves nothing
      // bare for a bare `step(…)` call to name.
      const exports = await runProject([GEOMETRY, ["/main.hex",
        "record Leg = {count: Int}\n" +
        "honor Geometry.Walk<Leg> =\n" +
        "    step(l) = l.count + 40\n" +
        "import Geometry from \"./geometry\"\n" +
        "export let paces: Int = Leg({count = 2}).step()\n",
      ]]);

      expect(exports.paces).toBe(42);
    });
  });

  describe("the alias straddles too (§3.3)", () => {
    test("`Geo.Point` in an annotation is free above the item", () => {
      expect(diagnostics([GEOMETRY, ["/main.hex",
        "export fun across(p: Geo.Point): Int = p.x\n" +
        "import Geo from \"./geometry\"\n",
      ]])).toEqual([]);
    });

    test("...but `Geo.area(p)` is a term the line binds, and reads top-down", () => {
      expect(diagnostics([GEOMETRY, ["/main.hex",
        "export fun size(p: Geo.Point): Int = Geo.area(p)\n" +
        "import Geo from \"./geometry\"\n",
      ]])).toEqual([MOVE_IMPORT("Geo.area")]);
    });

    test("...as does `Geo.Circle(r)` in a pattern", () => {
      expect(diagnostics([GEOMETRY, ["/main.hex",
        "export fun radius(s: Geo.Shape): Int =\n" +
        "    match s\n" +
        "        Geo.Circle(r) => r\n" +
        "        _ => 0\n" +
        "import Geo from \"./geometry\"\n",
      ]])[0]).toBe(MOVE_IMPORT("Geo.Circle"));
    });

    test("...and both controls below the item run", async () => {
      const exports = await runProject([GEOMETRY, ["/main.hex",
        "import Geo from \"./geometry\"\n" +
        "export fun size(p: Geo.Point): Int = Geo.area(p)\n" +
        "export fun radius(s: Geo.Shape): Int =\n" +
        "    match s\n" +
        "        Geo.Circle(r) => r\n" +
        "        Geo.Square(side) => side\n" +
        "export let box: Int = size(Geo.Point({x = 5, y = 5}))\n" +
        "export let round: Int = radius(Geo.Circle(7))\n",
      ]]);

      expect(exports.box).toBe(25);
      expect(exports.round).toBe(7);
    });
  });

  describe("only what the alias binds reads top-down either (§3.3)", () => {
    /**
     * The other half of "only what binds", for the namespace form. A qualified
     * spelling the exporter does not offer is bound by no line, so it is no
     * later declaration and the import-shaped repair would be a lie of the worst
     * kind: acting on it produces a *different* error at the same use. Every pin
     * here therefore compares the reference above the item against the same
     * source with the item moved above it — the repair the message proposes.
     *
     * §3.3's surfaces are wider than a named import's, and every one of them is
     * a spelling the line does bind: the exporter's terms, the members of
     * constraints it declares, the members of instances it honors at a type of
     * its own (§5.3), and the provided row (Collections Part 5 §4). A
     * constructor pattern reads `terms` alone, a constraint member not being a
     * constructor.
     */

    const NOT_EXPORTED = (alias: string, name: string): string =>
      `module \`${alias}\` does not export \`${name}\``;

    test("a field the exporter never offers reports what moving the import would", () => {
      const above = diagnostics([GEOMETRY, ["/main.hex",
        "export let early: Int = Geo.zork(1)\n" +
        "import Geo from \"./geometry\"\n",
      ]]);

      expect(above).toEqual([NOT_EXPORTED("Geo", "zork")]);
      // The proposed repair, carried out: an identical report is the proof that
      // the declared-later wording would have sent the reader nowhere.
      expect(diagnostics([GEOMETRY, ["/main.hex",
        "import Geo from \"./geometry\"\n" +
        "export let early: Int = Geo.zork(1)\n",
      ]])).toEqual(above);
    });

    test("...and in pattern position, where the surface is `terms` alone", () => {
      const above = diagnostics([GEOMETRY, ["/main.hex",
        "export fun radius(s: Geo.Shape): Int =\n" +
        "    match s\n" +
        "        Geo.Zork(r) => r\n" +
        "        _ => 0\n" +
        "import Geo from \"./geometry\"\n",
      ]]);

      // The whole list, cascades included: a repair that leaves the diagnostics
      // identical is the claim, and a first entry alone would not carry it.
      expect(above).toEqual([
        NOT_EXPORTED("Geo", "Zork"),
        "unknown name `r`",
        "this match arm is unreachable; an earlier pattern matches everything",
      ]);
      expect(diagnostics([GEOMETRY, ["/main.hex",
        "import Geo from \"./geometry\"\n" +
        "export fun radius(s: Geo.Shape): Int =\n" +
        "    match s\n" +
        "        Geo.Zork(r) => r\n" +
        "        _ => 0\n",
      ]])).toEqual(above);
    });

    test("a member of a constraint the exporter declares does read top-down", () => {
      // §3.3: a declared constraint's members qualify through the alias as
      // ordinary terms, so the line binds `Geo.step` and moving it is the repair.
      expect(diagnostics([GEOMETRY, ["/main.hex",
        "export let early: Int = Geo.step(1)\n" +
        "import Geo from \"./geometry\"\n",
      ]])).toEqual([MOVE_IMPORT("Geo.step")]);
    });

    test("...as does a member a prelude constraint's honor supplies (§5.3's uniform access)", () => {
      // The honored-member read is the widest of §3.3's surfaces and the one an
      // exporter's `terms` alone would miss: `Boxed` exports no `show`, and
      // `B.show` still resolves below the item. #762 narrows *which* honors
      // this surface reaches, though: the spelling it emits has to be one the
      // honoring module can reach with no import — and #762 leaves no import
      // smaller than a module for a project constraint's member to ride, so
      // only a prelude constraint's honor (reachable without any import at
      // all) still answers here; a project-declared constraint's honor does
      // not (`resolver.ts`'s `#honoredMemberAccess`, reading `#reachPreludeTerm`).
      const BOXED = ["/boxed.hex",
        "export record Box = {n: Int}\n" +
        "honor Show<Box> =\n" +
        "    show(b) = \"Box(${b.n})\"\n",
      ] as const;

      expect(diagnostics([BOXED, ["/main.hex",
        "export let early: String = B.show(B.Box({n = 7}))\n" +
        "import B from \"./boxed\"\n",
      ]])).toEqual([MOVE_IMPORT("B.show"), MOVE_IMPORT("B.Box")]);
    });

    test("...and the control below the item runs", async () => {
      const exports = await runProject([
        ["/boxed.hex",
          "export record Box = {n: Int}\n" +
          "honor Show<Box> =\n" +
          "    show(b) = \"Box(${b.n})\"\n"],
        ["/main.hex",
          "import B from \"./boxed\"\n" +
          "export let boxed: String = B.show(B.Box({n = 4}))\n"],
      ]);

      expect(exports.boxed).toBe("Box(4)");
    });

    test("...and so does a provided row, which no source `honor` backs", () => {
      // The last of §3.3's surfaces, and the one nothing else in this file could
      // reach: `Vector.toSeq` is the row Collections Part 5 §4 seats at the
      // companion, spelled through an explicit import of the very file the
      // prelude seated — the Playground's shape. It is a member the exporter
      // neither exports nor declares nor honors in text, and it still resolves
      // below the item, so above the item it is a later declaration like any
      // other. Without the surface consulted, this use resolves *silently*.
      expect(diagnostics([
        ["/Vector.hex", PRELUDE_SOURCES["Vector.hex"]!],
        ["/main.hex",
          "export let n: Int = Vector.toSeq([1, 2]).length()\n" +
          "import Vector from \"./Vector\"\n"],
      ])).toEqual([MOVE_IMPORT("Vector.toSeq")]);
    });

    test("...at the seven aliases a row is seated at, and nowhere else", () => {
      // A seated file is not a row. Any project file whose basename matches a
      // prelude module takes that module's seat, so `Int` and `Debug` are
      // addressable the same way `Vector` is — and neither carries a row, so
      // `Int.toSeq` is bound by no line and the item-shaped repair would be the
      // §3 lie again, one surface further in.
      const seated = (alias: string) =>
        [`/${alias}.hex`, PRELUDE_SOURCES[`${alias}.hex`]!] as const;

      for (const alias of ["Int", "Debug"]) {
        const above = diagnostics([seated(alias), ["/main.hex",
          `export let n: Int = ${alias}.toSeq(1)\n` +
          `import ${alias} from "./${alias}"\n`]]);

        expect(above).toEqual([NOT_EXPORTED(alias, "toSeq")]);
        expect(diagnostics([seated(alias), ["/main.hex",
          `import ${alias} from "./${alias}"\n` +
          `export let n: Int = ${alias}.toSeq(1)\n`]])).toEqual(above);
      }

      // Driven by the set the resolver reads, so an alias added to it without a
      // row to seat there fails here rather than in somebody's error message.
      for (const alias of PROVIDED_ROW_ALIASES) {
        const use = `export let n: Int = ${alias}.toSeq(subject).length()\n`;
        const item = `import ${alias} from "./${alias}"\n`;

        expect(diagnostics([seated(alias), ["/main.hex", use + item]]))
          .toContain(MOVE_IMPORT(`${alias}.toSeq`));
        // `subject` is unbound, so the moved source is in error either way; what
        // it may not say is that the member the repair promised is not there.
        expect(diagnostics([seated(alias), ["/main.hex", item + use]]))
          .not.toContain(NOT_EXPORTED(alias, "toSeq"));
      }
    }, 20000);

    test("an exporter with errors of its own still answers what it binds", () => {
      // The interface a failed compilation leaves is what this read has, and it
      // is enough: the surface question is about the exporter's *names*, which
      // survive its body's errors. So one broken module does not turn every
      // qualified spelling above an import into a promise the repair breaks.
      const BROKEN = ["/broken.hex",
        "export let ok(n: Int): Int = n\n" +
        "export let bad(n: Int): Int = nope(n)\n",
      ] as const;

      expect(diagnostics([BROKEN, ["/main.hex",
        "export let early: Int = Lib.zork(1)\n" +
        "import Lib from \"./broken\"\n",
      ]])).toEqual(["unknown name `nope`", NOT_EXPORTED("Lib", "zork")]);
      expect(diagnostics([BROKEN, ["/main.hex",
        "export let early: Int = Lib.ok(1)\n" +
        "import Lib from \"./broken\"\n",
      ]])).toEqual(["unknown name `nope`", MOVE_IMPORT("Lib.ok")]);
    });

    test("an unresolvable specifier binds no alias at all, in either position", () => {
      // No exporter, so the item binds nothing and registers nothing — the
      // qualifier is not a module here at any line, and the reading laws never
      // enter. The item's own report is the one that names the repair.
      expect(diagnostics([["/main.hex",
        "export let early: Int = Nope.zork(1)\n" +
        "import Nope from \"./nowhere\"\n",
      ]])).toEqual([
        "unknown name `Nope`",
        "cannot resolve module `./nowhere` from `/main.hex`",
        "cannot resolve module `./nowhere`",
      ]);
      expect(diagnostics([["/main.hex",
        "export fun pick(s: Int): Int =\n" +
        "    match s\n" +
        "        Nope.Zork(x) => x\n" +
        "        _ => 0\n" +
        "import Nope from \"./nowhere\"\n",
      ]])[0]).toBe("unknown module alias `Nope`");
    });
  });

  // #762 retired this describe block wholesale. "one span, two reports" pinned
  // a name a named import bound in *both* namespaces at once — one span
  // producing a type-collision report and a term-rebinding report together,
  // type first. A module alias is bound in neither namespace a declaration
  // occupies (it is its own namespace, per Modules §3.2), so a same-spelled
  // local declaration never contests it — there is no longer a shape that
  // produces two reports at one span this way. Alias-vs-alias and
  // alias-vs-local collisions are `namespace-alias-collision.test.ts`'s
  // subject, and they are single reports, not this pin's paired kind.

  describe("load order and emission are untouched (§8.2)", () => {
    test("a module whose imports sit at the bottom still loads them first", () => {
      const project = compileFiles([GEOMETRY, ["/main.hex",
        "export fun corner(p: Geometry.Point): Int = p.y\n" +
        "export let origin: Int = 0\n" +
        "import Geometry from \"./geometry\"\n",
      ]]);

      expect(project.diagnostics).toEqual([]);
      // §8.2 is depth-first in *source* order over the graph, which the item's
      // position within a file never entered. `/geometry.hex` precedes the
      // module that imports it, wherever the line sits in it.
      expect(project.modules.map(({ source }) => source.path)).toEqual([
        "/geometry.hex",
        "/main.hex",
      ]);
    });

    test("and the emitted module compiles and executes", async () => {
      // ESM hoists imports, so a bottom-of-file `import` is unconstrained at
      // emission — what is pinned is that the program links and runs, not where
      // the statement landed in the text.
      const files = [GEOMETRY, ["/main.hex",
        "export fun corner(p: Geometry.Point): Int = p.y + 1\n" +
        "import Geometry from \"./geometry\"\n" +
        "export let high: Int = corner(Geometry.Point({x = 1, y = 8}))\n",
      ]] as const;

      expect(compileFiles(files).modules.at(-1)!.javascript.text).toContain(
        'import * as Geometry from "./geometry.js";',
      );
      expect((await runProject(files)).high).toBe(9);
    });
  });
});
