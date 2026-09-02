import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, projectDiagnostics, runMain, runProject } from "../support/test-project.js";

/**
 * Conformance for **qualified constructor patterns** — Modules §3.3's
 * "Constructors qualify the same way (`Geo.Circle(1.0)`), including in patterns
 * (`match s` / `Geo.Circle(r) => ...`)", which Unions §2 delegates to.
 *
 * The form was spec'd long before it parsed. #466 is what made it load-bearing:
 * once a module's own `union` may occlude a prelude constructor (Modules §5.4),
 * the qualified spelling is the **only** way that module can still match the
 * prelude's — "the occluded prelude constructor stays reachable qualified in
 * both positions". A hatch that does not exist is not a hatch, so these pins are
 * part of that grant, not a nicety beside it.
 *
 * Two qualifiers answer, exactly as in value position (`#namedModule`): an
 * explicit import alias, and the declaring prelude module's own name
 * (§6.4's guaranteed qualified home) — `Ordering.Less`, `Option.Some(v)`,
 * `Bool.True`.
 *
 * The invariant underneath every pin: **the two spellings are one pattern.**
 * Resolution answers with the same symbol, so exhaustiveness — which is keyed on
 * symbol identity — cannot tell them apart, and emission tests the same runtime
 * tag, because the resolved pattern carries the constructor's own name rather
 * than the spelling written at the use site.
 */

describe("a prelude module's own name qualifies its constructors in patterns", () => {
  test("a whole `Ordering` match spelled qualified is exhaustive and runs", async () => {
    // No `_` arm and no missing-case diagnostic: the three qualified patterns
    // cover `Ordering` because they resolve to its three constructors.
    expect(projectDiagnostics(
      "export fun ordering(a: Int, b: Int): String =\n" +
      "    match Ord.compare(a, b)\n" +
      "        Ordering.Less => \"lt\"\n" +
      "        Ordering.Equal => \"eq\"\n" +
      "        Ordering.Greater => \"gt\"\n",
    )).toEqual([]);

    const exports = await runMain(
      "export fun qualified(a: Int, b: Int): String =\n" +
      "    match Ord.compare(a, b)\n" +
      "        Ordering.Less => \"lt\"\n" +
      "        Ordering.Equal => \"eq\"\n" +
      "        Ordering.Greater => \"gt\"\n" +
      "export let below: String = qualified(1, 2)\n" +
      "export let same: String = qualified(2, 2)\n" +
      "export let above: String = qualified(3, 2)\n",
    );

    expect([exports.below, exports.same, exports.above]).toEqual(["lt", "eq", "gt"]);
  });

  test("one missing case is still reported, named by the constructor", () => {
    expect(projectDiagnostics(
      "export fun partial(a: Int, b: Int): String =\n" +
      "    match Ord.compare(a, b)\n" +
      "        Ordering.Less => \"lt\"\n" +
      "        Ordering.Equal => \"eq\"\n",
    // Bare, not qualified: Pattern Matching §7.3's witness tiers are re-cut for
    // the door (#763) — "tier 1 is every constructor the door reaches", and the
    // door reaches every constructor of the scrutinee's own type, `Ordering`'s
    // qualified-only ones included. #742 made `Equal`/`Greater` qualified-only
    // in *expression* position; it never touched the pattern-position witness.
    )).toEqual(["match is missing cases: `Greater`"]);
  });

  /**
   * `Option` mixes qualified and bare arms because it is an *open* union —
   * bare `None` was always in scope. `Ordering` mixes them too, but for a
   * different reason: #763's door.
   */
  test("an open union still mixes qualified and bare arms, one pattern each", async () => {
    expect(projectDiagnostics(
      "export fun mixed(o: Option(Int)): Int =\n" +
      "    match o\n" +
      "        Option.Some(v) => v\n" +
      "        None => 0\n",
    )).toEqual([]);

    const exports = await runMain(
      "export fun mixedArms(o: Option(Int)): Int =\n" +
      "    match o\n" +
      "        Option.Some(v) => v\n" +
      "        None => 0\n" +
      "export let r: Int = mixedArms(Some(7))\n",
    );

    expect(exports.r).toBe(7);
  });

  test("a qualified-only constructor's bare arm resolves through the door instead (#763)", async () => {
    // §742 made every `Ordering` constructor qualified-only in *expression*
    // position, and the bare-prelude refusal that enforces that never runs in
    // pattern position at all (Pattern Matching §2.2): the scrutinee's type is
    // determined at the top of a `match`, so the door reaches `Equal` and
    // `Greater` exactly as it reaches an imported union's constructors. One
    // pattern, two spellings — mixing them draws nothing.
    expect(projectDiagnostics(
      "export fun mixed(a: Int, b: Int): String =\n" +
      "    match Ord.compare(a, b)\n" +
      "        Ordering.Less => \"lt\"\n" +
      "        Equal => \"eq\"\n" +
      "        Greater => \"gt\"\n",
    )).toEqual([]);

    const exports = await runMain(
      "export fun mixedArms(a: Int, b: Int): String =\n" +
      "    match Ord.compare(a, b)\n" +
      "        Ordering.Less => \"lt\"\n" +
      "        Equal => \"eq\"\n" +
      "        Greater => \"gt\"\n" +
      "export let below: String = mixedArms(1, 2)\n" +
      "export let same: String = mixedArms(2, 2)\n" +
      "export let above: String = mixedArms(3, 2)\n",
    );
    expect([exports.below, exports.same, exports.above]).toEqual(["lt", "eq", "gt"]);
  });

  test("the same constructor twice, spelled both ways, is the unreachable-case report", () => {
    // The sharpest statement of the identity claim: a reachability check that
    // compared spellings would see two different patterns here. `Option` is the
    // union that can still be written both ways (#742).
    expect(projectDiagnostics(
      "export fun twice(o: Option(Int)): Int =\n" +
      "    match o\n" +
      "        Option.Some(v) => v\n" +
      "        Some(w) => w\n" +
      "        None => 0\n",
    )).toEqual(["this case is unreachable; `Some` is already handled above"]);
  });

  test("a payload binds through the qualified form", async () => {
    const exports = await runMain(
      "export fun unwrap(o: Option(Int)): Int =\n" +
      "    match o\n" +
      "        Option.Some(v) => v + 1\n" +
      "        Option.None => 0\n" +
      "export let filled: Int = unwrap(Some(41))\n" +
      "export let empty: Int = unwrap(None)\n",
    );

    expect(exports.filled).toBe(42);
    expect(exports.empty).toBe(0);
  });

  test("`Bool.True` and `Bool.False` are ordinary constructor patterns (#147)", async () => {
    const exports = await runMain(
      "export fun word(b: Bool): String =\n" +
      "    match b\n" +
      "        Bool.True => \"yes\"\n" +
      "        Bool.False => \"no\"\n" +
      "export let affirmed: String = word(True)\n" +
      "export let denied: String = word(False)\n",
    );

    expect(exports.affirmed).toBe("yes");
    expect(exports.denied).toBe("no");
  });
});

describe("a module alias qualifies an imported union's constructors in patterns", () => {
  test("`Lib.Circle(r)` matches and binds", async () => {
    expect(compileFiles([
      ["/lib.hex", "export union Shape = Circle(radius: Float) | Square(side: Float)\n"],
      ["/main.hex",
        "import Lib from \"./lib\"\n" +
        "export fun measure(s: Lib.Shape): Float =\n" +
        "    match s\n" +
        "        Lib.Circle(r) => r\n" +
        "        Lib.Square(x) => x\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([]);

    const exports = await runProject([
      ["/lib.hex", "export union Shape = Circle(radius: Float) | Square(side: Float)\n"],
      ["/main.hex",
        "import Lib from \"./lib\"\n" +
        "export fun size(s: Lib.Shape): Float =\n" +
        "    match s\n" +
        "        Lib.Circle(r) => r * 2.0\n" +
        "        Lib.Square(x) => x * 4.0\n" +
        "export let round: Float = size(Lib.Circle(3.0))\n" +
        "export let boxy: Float = size(Lib.Square(3.0))\n"],
    ]);

    expect(exports.round).toBe(6);
    expect(exports.boxy).toBe(12);
  });

  test("an alias-spelled match is exhaustive without a wildcard", () => {
    // Same identity claim through the other qualifier.
    expect(compileFiles([
      ["/lib.hex", "export union Shape = Circle(radius: Float) | Square(side: Float)\n"],
      ["/main.hex",
        "import Lib from \"./lib\"\n" +
        "export fun only(s: Lib.Shape): Float =\n" +
        "    match s\n" +
        "        Lib.Circle(r) => r\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      // #607, re-cut for #763: tier 1 is every constructor the door reaches,
      // and `Square` is reached that way — the scrutinee's type (`Lib.Shape`)
      // is determined at the top of this `match`, so the witness pastes back
      // bare even though nothing in this module's own scope binds it.
      "match is missing cases: `Square(_)`",
    ]);
  });

  // DELETED (#762 sweep): "the two reports agree, alias-qualified and
  // aliased-bare alike" pinned #511 — a renaming import (`Red as Crimson`)
  // giving one constructor a locally-bound bare spelling different from a
  // sibling reached only through the alias, and checked both §7.1's
  // missing-cases witness and §7.2's unreachable-arm report named it the
  // same way. No import binds a name any smaller than a module now (#762),
  // so that per-constructor local spelling has no replacement — rule 3's
  // same-spelled-alias fallback is the only surviving way to get a bare
  // constructor spelling from an import, and it is keyed to the *alias's*
  // spelling, not a per-constructor one. Probing it as a substitute turned
  // up a real spelling disagreement between the two reports (missing-cases
  // prints a rule-3-reached constructor bare; the unreachable-arm report
  // beside it prints the same constructor alias-qualified) — which may be
  // this issue's #511 recurring under the new mechanism, but I did not judge
  // it safe to pin without owner review of whether that is a defect or a
  // deliberate tier split; flagged in the sweep report instead.
});

describe("the hatch #466 depends on: an occluding module still reaches the prelude's", () => {
  test("a module whose union took `Less` and `Greater` over still matches an `Ordering`", async () => {
    // The whole reason qualified patterns had to be implemented for #466. The
    // bare spellings are the module's own union here; `Prelude.` reaches past
    // the reservation to what the prelude declared.
    const exports = await runMain(
      "export union Direction = Less | Greater\n" +
      "export fun mine(d: Direction): String =\n" +
      "    match d\n" +
      "        Less => \"down\"\n" +
      "        Greater => \"up\"\n" +
      "export fun theirs(a: Int, b: Int): String =\n" +
      "    match Ord.compare(a, b)\n" +
      "        Ordering.Less => \"lt\"\n" +
      "        Ordering.Equal => \"eq\"\n" +
      "        Ordering.Greater => \"gt\"\n" +
      "export let own: String = mine(Less)\n" +
      "export let prelude: String = theirs(1, 5)\n",
    );

    expect(exports.own).toBe("down");
    expect(exports.prelude).toBe("lt");
  });

  test("the emitted match tests the constructor's tag, not the spelling", () => {
    // `text` on the resolved pattern is the constructor's own name, which is
    // what emission turns into the tag test. A qualified pattern that carried
    // `Ordering.Less` would compile to a case no value ever equals.
    const javascript = compileMain(
      "export union Direction = Less | Greater\n" +
      "export fun theirs(a: Int, b: Int): String =\n" +
      "    match Ord.compare(a, b)\n" +
      "        Ordering.Less => \"lt\"\n" +
      "        Ordering.Equal => \"eq\"\n" +
      "        Ordering.Greater => \"gt\"\n",
    ).modules.find(({ source }) => source.path === "/main.hex")!.javascript.text;

    expect(javascript).toContain(
      "  const __match = compare(a, b);\n" +
      "  switch (__match.tag) {\n" +
      "    case \"Less\":\n" +
      "      return \"lt\";\n" +
      "    case \"Equal\":\n" +
      "      return \"eq\";\n" +
      "    case \"Greater\":\n" +
      "      return \"gt\";\n",
    );
    expect(javascript).not.toContain("Prelude.");
    // A constructor matched in a pattern compiles to its tag, so the qualified
    // spelling drags in no import of its own — the module's only import here is
    // the one the `compare` call needs.
    expect(javascript.match(/^import /gmu)).toHaveLength(1);
  });
});

describe("catch arms take the same form, and now reach as far", () => {
  /**
   * Catch arms are the flat constructor patterns of Unions §4.2
   * (exceptions.md §5.2), so they run through one pattern resolver and the
   * qualified form arrives there with no arm of its own.
   *
   * When #466 shipped, the *checker* then refused what the resolver had just
   * answered: its exception table held the module's own `exception` items, so
   * an exception the module had not written was refused in a catch arm by
   * either spelling. #469 widened the table to every exception constructor in
   * scope, which is what makes §5.4's "reachable qualified in both positions"
   * true for exceptions too. `qualified-exception-patterns.test.ts` is that
   * arc's conformance; what stays here is the identity claim this file is
   * about — the two spellings resolve alike in catch position as they do in a
   * match.
   */

  // `Boom` names both an alias (rule 3's own spelling) and, through the second
  // alias `Lib`, the qualified form — no named import binds anything smaller
  // than a module now (#762), so a same-spelled alias is what stands in for
  // it here.
  const catchArm = (arm: string): readonly string[] =>
    compileFiles([
      ["/lib.hex", "export exception Boom(code: Int)\n"],
      ["/main.hex",
        "import Lib from \"./lib\"\n" +
        "import Boom from \"./lib\"\n" +
        "export fun f(): Int =\n" +
        "    try\n" +
        "        throw(Boom(3))\n" +
        "    catch\n" +
        `        ${arm} => 1\n`],
    ]).diagnostics.map(({ message }) => message);

  test("a qualified exception pattern parses and resolves, then reads as the bare one does", () => {
    expect(catchArm("Lib.Boom(c)")).toEqual(catchArm("Boom(c)"));
    expect(catchArm("Lib.Boom(c)")).toEqual([]);
  });

  test("an exception the module declares itself is caught through its bare name", async () => {
    // The half constructor occlusion actually needs: the module's own
    // declaration, occluding `Vector.IndexError`, caught by the bare name that
    // occlusion made its own.
    const exports = await runMain(
      "export exception IndexError(code: Int)\n" +
      "export fun caught(): Int =\n" +
      "    try\n" +
      "        throw(IndexError(4))\n" +
      "    catch\n" +
      "        IndexError(c) => c\n" +
      "export let r: Int = caught()\n",
    );

    expect(exports.r).toBe(4);
  });
});

describe("what a qualified constructor pattern refuses", () => {
  test("an unknown qualifier is the same report a type annotation gets", () => {
    expect(projectDiagnostics(
      "export fun f(o: Option(Int)): Int =\n" +
      "    match o\n" +
      "        Nope.Some(v) => v\n" +
      "        _ => 0\n",
    )).toContain("unknown module alias `Nope`");
  });

  test("a name the module does not export is the same report value position gets", () => {
    expect(projectDiagnostics(
      "export fun f(o: Option(Int)): Int =\n" +
      "    match o\n" +
      "        Option.Blah(v) => v\n" +
      "        _ => 0\n",
    )).toContain("module `Option` does not export `Blah`");
  });

  test("a record's constructor answers by both spellings, and refuses by both alike", () => {
    // This *was* the file's "not a constructor" pin: a record's constructor was
    // the one term the kind test rejected, and it rejected it under both
    // spellings. #591 built the eliminator the spec had always named (Pattern
    // Matching §2.2, Modules §4.2), and both kind tests admit
    // `record-constructor` now — so the specimen changed sides, and the
    // invariant it was here to demonstrate is what survives: **one pattern, two
    // spellings.** Same symbol, so the same arity report, worded identically,
    // with only the qualifier differing at the use site.
    //
    // The refusal itself is not re-pinned here because it no longer has a
    // source-reachable specimen: the case rule keeps every other term kind
    // lowercase-start (`let` rejects an uppercase name; an `extern` demands an
    // alias for one), and the parser only builds a constructor pattern —
    // qualified or bare — from an uppercase-start name. The branch is kept in
    // the resolver as the closed door it is.
    const arity = "constructor pattern `Point` expects 1 arguments, got 2";
    expect(compileFiles([
      ["/lib.hex", "export record Point = { x: Int, y: Int }\n"],
      ["/main.hex",
        "import Lib from \"./lib\"\n" +
        "export fun f(p: Lib.Point): Int =\n" +
        "    match p\n" +
        "        Lib.Point(a, b) => a\n"],
    ]).diagnostics.map(({ message }) => message)).toContain(arity);
    expect(compileFiles([
      ["/lib.hex", "export record Point = { x: Int, y: Int }\n"],
      ["/main.hex",
        "import Point from \"./lib\"\n" +
        "export fun f(p: Point): Int =\n" +
        "    match p\n" +
        "        Point(a, b) => a\n"],
    ]).diagnostics.map(({ message }) => message)).toContain(arity);
    expect(compileFiles([
      ["/lib.hex", "export record Point = { x: Int, y: Int }\n"],
      ["/main.hex",
        "import Lib from \"./lib\"\n" +
        "export fun f(p: Lib.Point): Int =\n" +
        "    match p\n" +
        "        Lib.Point({x}) => x\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([]);
  });

  test("a type name behind the alias reads as it does in value position", () => {
    // `terms` is the map both positions consult, and a type is not in it. The
    // qualified pattern therefore says what `Lib.Shape` says as an expression,
    // rather than inventing a pattern-only wording for the same near miss.
    const message = "module `Lib` does not export `Shape`";
    expect(compileFiles([
      ["/lib.hex", "export union Shape = Circle(radius: Float) | Square(side: Float)\n"],
      ["/main.hex",
        "import Lib from \"./lib\"\n" +
        "export fun f(s: Lib.Shape): Int =\n" +
        "    match s\n" +
        "        Lib.Shape(r) => 1\n" +
        "        _ => 0\n"],
    ]).diagnostics.map(({ message: text }) => text)).toContain(message);
    expect(compileFiles([
      ["/lib.hex", "export union Shape = Circle(radius: Float) | Square(side: Float)\n"],
      ["/main.hex",
        "import Lib from \"./lib\"\n" +
        "export let s: Int = Lib.Shape\n"],
    ]).diagnostics.map(({ message: text }) => text)).toContain(message);
  });

  test("an uppercase name followed by anything but `.Upper` is still the bare form", () => {
    // The grammar extension is exactly one dot and an uppercase name after it,
    // so nothing that parsed before parses differently: this is a nullary
    // constructor pattern whose arm body happens to start with a field access.
    expect(projectDiagnostics(
      "export fun f(o: Option({x: Int})): Int =\n" +
      "    match o\n" +
      "        Some(r) => r.x\n" +
      "        None => 0\n",
    )).toEqual([]);
  });
});
