import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, projectDiagnostics, runMain, runProject } from "../support/test-project.js";

/**
 * Conformance for the **nominal record's pattern eliminator** — the constructor
 * pattern (#591).
 *
 * Pattern Matching §2.2: "Constructor patterns apply to `union` constructors,
 * prelude exceptions in catch arms … and **nominal `record` constructors**:
 * `Point(pat)` is legal and destructures through the nominal wall, where `pat`
 * matches the underlying record value — the pattern-side dual of the
 * constructor term." Modules §4.2 states the same thing from the other end and
 * fixes how it travels: "A nominal record's pattern eliminator is the
 * constructor pattern, **name-carried like construction**."
 *
 * The form was normative in two specs and spellable nowhere. Two refusals stood
 * in front of it, one per pass, and both had to go for either half to work: the
 * resolver's constructor lookup admitted only symbols of kind `constructor`
 * (a record's is `record-constructor`), which is why even `let Crate(r) = c`
 * reported "unknown constructor"; and the checker's `match` dispatch had no
 * `NominalRecord` scrutinee arm, which is why a `match` on one reported "cannot
 * match on `Crate` yet" beside it.
 *
 * The invariants the pins below are built around:
 *
 * - **One row, one reader.** The sub-pattern checks against the row the
 *   constructor's own scheme carries (Products §5.1's `Point : {closed row} ->
 *   Point`), so a pattern cannot see a different record than `p.x` or
 *   `{p with …}` sees. The irrefutability judgment reads `#nominalRecordFields`,
 *   which is that same reader (#587).
 * - **Name-carried, not reach-carried.** The representation travels with the
 *   type (§4.2, #587); the *name* does not. Outside the home module the pattern
 *   works exactly when the constructor name is in scope, and the refusal when it
 *   is not is the ordinary unknown-name one — the same door construction uses.
 * - **The constructor erases, so the pattern erases** (Products §5.4). The
 *   runtime value *is* the record: no tag is tested and no payload field is
 *   read, the sub-pattern matching the value itself.
 */

const CRATE = "export record Crate = {n: Float, tag: String}\n";

/** One emitted module's JavaScript, by source path. */
function emitted(files: readonly (readonly [string, string])[], path: string): string {
  const compiled = compileFiles(files);
  const module = compiled.modules.find(({ source }) => source.path === path);
  if (module === undefined) throw new Error(`${path} was not emitted`);
  return module.javascript.text;
}

function mainJs(source: string): string {
  const compiled = compileMain(source);
  return compiled.modules.find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
}

describe("the constructor pattern destructures a nominal record in its home module", () => {
  test("the filed acceptance: `let Crate(r) = c` binds the underlying record", async () => {
    // §2.2's "`pat` matches the underlying record value" at its simplest: the
    // sub-pattern is a bare binder, so `r` *is* the structural record — and is
    // accepted where that row is written, which is the whole claim.
    expect(projectDiagnostics(
      CRATE +
      "fun width(r: {n: Float, tag: String}): Float = r.n\n" +
      "export fun get(c: Crate): Float =\n" +
      "    let Crate(r) = c\n" +
      "    width(r)\n",
    )).toEqual([]);

    const exports = await runMain(
      CRATE +
      "export fun get(c: Crate): Float =\n" +
      "    let Crate(r) = c\n" +
      "    r.n\n" +
      "export let v: Float = get(Crate({n = 2.5, tag = \"a\"}))\n",
    );
    expect(exports.v).toBe(2.5);
  });

  test("the useful spelling: `let Crate({n})`, punned, against the declaration's row", async () => {
    const exports = await runMain(
      CRATE +
      "export fun label(c: Crate): String =\n" +
      "    let Crate({n, tag}) = c\n" +
      "    \"${tag}:${n}\"\n" +
      "export let v: String = label(Crate({n = 1.5, tag = \"z\"}))\n",
    );
    expect(exports.v).toBe("z:1.5");
  });

  test("record sub-patterns nest and rename like any other record pattern", async () => {
    const exports = await runMain(
      "export record Inner = {depth: Int}\n" +
      "export record Outer = {inner: Inner, name: String}\n" +
      "export fun reach(o: Outer): Int =\n" +
      "    let Outer({inner = Inner({depth}), name = _}) = o\n" +
      "    depth\n" +
      "export let v: Int = reach(Outer({inner = Inner({depth = 7}), name = \"o\"}))\n",
    );
    expect(exports.v).toBe(7);
  });

  test("a parameterized record instantiates its row at the pattern", async () => {
    expect(projectDiagnostics(
      "export record Box(a) = {item: a}\n" +
      "export fun bump(b: Box(Int)): Int =\n" +
      "    let Box({item}) = b\n" +
      "    item + 1\n",
    )).toEqual([]);

    const exports = await runMain(
      "export record Box(a) = {item: a}\n" +
      "export fun bump(b: Box(Int)): Int =\n" +
      "    match b\n" +
      "        Box({item}) => item + 1\n" +
      "export let v: Int = bump(Box({item = 41}))\n",
    );
    expect(exports.v).toBe(42);
  });

  test("`opaque` changes nothing inside the home module (§4.2)", () => {
    expect(compileFiles([
      ["/geo.hex",
        "opaque record Crate = {n: Float}\n" +
        "export fun size(c: Crate): Float =\n" +
        "    let Crate({n}) = c\n" +
        "    n\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([]);
  });
});

describe("a `match` on a nominal-record scrutinee", () => {
  test("one arm with an irrefutable sub-pattern is exhaustive, and runs", async () => {
    expect(projectDiagnostics(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    match c\n" +
      "        Crate({n}) => n\n",
    )).toEqual([]);

    const exports = await runMain(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    match c\n" +
      "        Crate({n}) => n\n" +
      "export let v: Float = size(Crate({n = 3.5, tag = \"a\"}))\n",
    );
    expect(exports.v).toBe(3.5);
  });

  test("a refutable sub-pattern leaves the match open, and the witness is the constructor", () => {
    // §7.1's finite-shape clause at one constructor; §7.3's degenerate
    // rendering, which for a sole constructor is its name.
    expect(projectDiagnostics(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    match c\n" +
      "        Crate({tag = \"a\"}) => 1.0\n",
    )).toEqual(["match is missing cases: `Crate(_)`"]);
  });

  test("a refutable arm followed by a covering one is exhaustive, and both run", async () => {
    expect(projectDiagnostics(
      CRATE +
      "export fun name(c: Crate): String =\n" +
      "    match c\n" +
      "        Crate({tag = \"a\"}) => \"first\"\n" +
      "        Crate({tag}) => tag\n",
    )).toEqual([]);

    const exports = await runMain(
      CRATE +
      "export fun name(c: Crate): String =\n" +
      "    match c\n" +
      "        Crate({tag = \"a\"}) => \"first\"\n" +
      "        Crate({tag}) => tag\n" +
      "export let hit: String = name(Crate({n = 0.0, tag = \"a\"}))\n" +
      "export let miss: String = name(Crate({n = 0.0, tag = \"b\"}))\n",
    );
    expect([exports.hit, exports.miss]).toEqual(["first", "b"]);
  });

  test("an arm shadowed by an earlier covering arm is unreachable (§7.2)", () => {
    expect(projectDiagnostics(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    match c\n" +
      "        Crate({n}) => n\n" +
      "        Crate({n}) => n\n",
    )).toEqual(["this match arm is unreachable; an earlier pattern matches everything"]);
  });

  test("a catch-all still covers, and still shadows", () => {
    expect(projectDiagnostics(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    match c\n" +
      "        _ => 0.0\n",
    )).toEqual([]);
    expect(projectDiagnostics(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    match c\n" +
      "        _ => 0.0\n" +
      "        Crate({n}) => n\n",
    )).toEqual(["this match arm is unreachable; an earlier pattern matches everything"]);
  });

  test("a guarded arm contributes nothing to coverage (§7.1)", () => {
    // With no unguarded arm at all, nothing has split the domain, and §7.3's
    // "prefer the shallowest witness that is genuinely missing" answers `_`
    // rather than naming the sole constructor: every value is uncovered.
    expect(projectDiagnostics(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    match c\n" +
      "        Crate({n}) when n > 0.0 => n\n",
    )).toEqual(["match is missing cases: `_`"]);
  });

  test("the pattern nests inside a union arm", async () => {
    const exports = await runMain(
      CRATE +
      "export fun size(c: Option(Crate)): Float =\n" +
      "    match c\n" +
      "        Some(Crate({n})) => n\n" +
      "        _ => 0.0\n" +
      "export let some: Float = size(Some(Crate({n = 4.0, tag = \"a\"})))\n" +
      "export let none: Float = size(None)\n",
    );
    expect([exports.some, exports.none]).toEqual([4.0, 0.0]);
  });

  test("nested under a union slot, a sole-constructor sub-pattern covers (§7.1)", () => {
    // **#594**, both halves at once. The slot of `Some(a)` used to be read off
    // the *declaration*, where it is a bare type variable carrying no shape, so
    // a constructor sub-pattern under it decomposed nothing and the arm never
    // covered `Some`. The matrix reads the **instantiated** slot — `Wrapped`
    // here — where a sole constructor is exactly what §5.1 says it is, and the
    // two spellings of a newtype answer alike.
    const nested = (arm: string, declaration: string) => projectDiagnostics(
      declaration +
      "export fun size(o: Option(Wrapped)): Int =\n" +
      "    match o\n" +
      `        ${arm}\n` +
      "        None => 0\n",
    );
    expect(nested("Some(Wrapped(n)) => n", "export union Wrapped = Wrapped(Int)\n"))
      .toEqual([]);
    expect(nested("Some(Wrapped({n})) => n", "export record Wrapped = {n: Int}\n"))
      .toEqual([]);
  });

  test("`as` binds the whole nominal value beside the destructured fields", async () => {
    const exports = await runMain(
      CRATE +
      "export fun twice(c: Crate): Float =\n" +
      "    match c\n" +
      "        Crate({n}) as whole => n + whole.n\n" +
      "export let v: Float = twice(Crate({n = 1.5, tag = \"a\"}))\n",
    );
    expect(exports.v).toBe(3.0);
  });
});

describe("every binding position takes it, gated only by irrefutability (§6)", () => {
  test("a lambda parameter destructures, and runs", async () => {
    expect(projectDiagnostics(
      CRATE +
      "let size: (Crate) -> Float = Crate({n}) => n\n" +
      "export let v: Float = size(Crate({n = 1.0, tag = \"a\"}))\n",
    )).toEqual([]);

    const exports = await runMain(
      CRATE +
      "let size: (Crate) -> Float = Crate({n}) => n\n" +
      "export let v: Float = size(Crate({n = 9.0, tag = \"a\"}))\n",
    );
    expect(exports.v).toBe(9.0);
  });

  test("a `for..in` loop variable destructures, and runs", async () => {
    expect(projectDiagnostics(
      CRATE +
      "export fun total(cs: Vector(Crate)): Float =\n" +
      "    var sum = 0.0\n" +
      "    for Crate({n}) in cs\n" +
      "        sum := sum + n\n" +
      "    sum\n",
    )).toEqual([]);

    const exports = await runMain(
      CRATE +
      "export fun total(cs: Vector(Crate)): Float =\n" +
      "    var sum = 0.0\n" +
      "    for Crate({n}) in cs\n" +
      "        sum := sum + n\n" +
      "    sum\n" +
      "export let v: Float = total([Crate({n = 1.5, tag = \"a\"}), Crate({n = 2.0, tag = \"b\"})])\n",
    );
    expect(exports.v).toBe(3.5);
  });

  test("the gate is the sub-pattern's, and it still bites in each seat (§5.3)", () => {
    // The constructor half is irrefutable by §5.1's table — "a record
    // constructor is always sole constructor" — so a refusal here can only come
    // from the inside of the pattern, and does.
    expect(projectDiagnostics(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    let Crate({tag = \"a\"}) = c\n" +
      "    1.0\n",
    )).toEqual([
      "this pattern can fail: `Crate(_)`; use `match`",
    ]);
    expect(projectDiagnostics(
      CRATE +
      "let size: (Crate) -> Float = Crate({tag = \"a\"}) => 1.0\n" +
      "export let v: Float = size(Crate({n = 1.0, tag = \"a\"}))\n",
    )).toEqual([
      "this pattern can fail: `Crate(_)`; use `match` — " +
        "for a match function, write `match` with arms",
    ]);
    expect(projectDiagnostics(
      CRATE +
      "export fun total(cs: Vector(Crate)): Float =\n" +
      "    var sum = 0.0\n" +
      "    for Crate({tag = \"a\"}) in cs\n" +
      "        sum := sum + 1.0\n" +
      "    sum\n",
    )).toEqual([
      "this pattern can fail: `Crate(_)`; use `match`",
    ]);
  });

  test("a `catch` arm is the one position it does not reach", () => {
    // Type-appropriate, per §6.2: a catch arm's scrutinee is `Exn`, and a
    // record constructor is not an exception constructor. The message is the
    // existing one for a non-exception constructor in that seat.
    expect(projectDiagnostics(
      CRATE +
      "export fun size(): Float =\n" +
      "    try\n" +
      "        1.0\n" +
      "    catch\n" +
      "        Crate({n}) => n\n",
    )).toEqual(["`Crate` is not an exception constructor"]);
  });
});

describe("the bare record pattern is redirected, not mismatched (§2.4)", () => {
  test("in a `let`, the redirect names the constructor and the written fields", () => {
    expect(projectDiagnostics(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    let {n} = c\n" +
      "    n\n",
    )).toEqual(["`Crate` is a nominal record; destructure it with `Crate({n})`"]);
  });

  test("in a `match` arm, the same redirect", () => {
    expect(projectDiagnostics(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    match c\n" +
      "        {n, tag} => n\n",
    )).toEqual([
      // One error, not two: a record pattern is structurally irrefutable, so
      // the arm still reads as a catch-all for coverage and no missing-case
      // report piles on behind the redirect.
      "`Crate` is a nominal record; destructure it with `Crate({n, tag})`",
    ]);
  });

  test("opacity intercepts the redirect outside the home module (§2.4)", () => {
    // The redirect signposts the constructor, and outside an opaque record's
    // home that constructor is private — so the opaque family's own refusal
    // stands in its place, in the shape its two siblings already have. Nothing
    // is leaked on the way: the sentence carries no field name and no
    // constructor spelling, which is the field privacy §4.2 calls load-bearing.
    // The alias is spelled `Crate`, so §5.1 rule 2's companion fallback carries
    // the type bare with no named import to carry it (#762).
    const messages = compileFiles([
      ["/geo.hex",
        "opaque record Crate = {n: Float}\n" +
        "export fun make(): Crate = Crate({n = 1.0})\n"],
      ["/main.hex",
        'import Crate from "./geo"\n' +
        "export fun size(c: Crate): Float =\n" +
        "    let {n} = c\n" +
        "    n\n"],
    ]).diagnostics.map(({ message }) => message);
    expect(messages).toEqual([
      "cannot destructure opaque record `Crate`; use an operation exported by its home module",
    ]);
    expect(messages.join("\n")).not.toContain("`n`");
    expect(messages.join("\n")).not.toContain("Crate({");
  });

  test("the interception reads opacity where the field access reads it", () => {
    // Off the *program's* copy of the declaration, not the importer's flag
    // (#587/#589) — so a type that reached this module through an imported
    // signature, its name never spelled here, answers exactly as an imported
    // one does. The transparent twin below is the control: same reach, same
    // seat, and the redirect is what fires there.
    const reached = (head: string) => compileFiles([
      ["/geo.hex",
        `${head} record Crate = {n: Float}\n` +
        "export fun make(): Crate = Crate({n = 1.0})\n"],
      ["/mid.hex",
        'import Geo from "./geo"\n' +
        "export fun forged(): Geo.Crate = Geo.make()\n"],
      ["/main.hex",
        'import Mid from "./mid"\n' +
        "export fun size(): Float =\n" +
        "    let {n} = Mid.forged()\n" +
        "    n\n"],
    ]).diagnostics.map(({ message }) => message);
    expect(reached("opaque")).toEqual([
      "cannot destructure opaque record `Crate`; use an operation exported by its home module",
    ]);
    expect(reached("export")).toEqual([
      "`Crate` is a nominal record; destructure it with `Crate({n})`",
    ]);
  });

  test("inside the home module `opaque` changes nothing, and the redirect stands", () => {
    // §4.2's own sentence. The home module sees everything, so the seat has a
    // spelling to send the reader to and sends them to it.
    expect(compileFiles([
      ["/geo.hex",
        "opaque record Crate = {n: Float}\n" +
        "export fun size(c: Crate): Float =\n" +
        "    let {n} = c\n" +
        "    n\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      "`Crate` is a nominal record; destructure it with `Crate({n})`",
    ]);
  });

  test("a `match` arm outside the home module is intercepted too", () => {
    expect(compileFiles([
      ["/geo.hex",
        "opaque record Crate = {n: Float}\n" +
        "export fun make(): Crate = Crate({n = 1.0})\n"],
      ["/main.hex",
        'import Crate from "./geo"\n' +
        "export fun size(c: Crate): Float =\n" +
        "    match c\n" +
        "        {n} => n\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      "cannot destructure opaque record `Crate`; use an operation exported by its home module",
    ]);
  });

  test("a structural record scrutinee is untouched by the redirect", () => {
    expect(projectDiagnostics(
      "export fun size(c: {n: Float}): Float =\n" +
      "    let {n} = c\n" +
      "    n\n",
    )).toEqual([]);
  });
});

describe("arity is one, positional (§2.2)", () => {
  test("two sub-patterns draw the unions' own arity sentence", () => {
    expect(projectDiagnostics(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    match c\n" +
      "        Crate({n}, x) => n\n",
    )).toEqual(["constructor pattern `Crate` expects 1 arguments, got 2"]);
  });

  test("the bare payload constructor draws it too, and covers nothing", () => {
    expect(projectDiagnostics(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    match c\n" +
      "        Crate => 1.0\n",
    )).toEqual([
      // One report, not two: the matrix widens the missing sub-pattern to `_`,
      // so the arity defect is not also charged as a coverage gap (#594).
      "constructor pattern `Crate` expects 1 arguments, got 0",
    ]);
  });
});

describe("outside the home module the name carries it, and only the name", () => {
  const GEO = CRATE + "export fun make(): Crate = Crate({n = 6.0, tag = \"g\"})\n";

  test("the alias's own spelling brings the pattern bare, through rule 3 (#763)", async () => {
    // No import binds a name any smaller than a module now (#762) — a bare
    // constructor abroad is Modules §5.1 rule 3's companion fallback: the
    // alias is spelled `Crate`, the module exports a same-spelled constructor,
    // and term position has nothing of its own to answer with.
    expect(compileFiles([
      ["/geo.hex", GEO],
      ["/main.hex",
        'import Crate from "./geo"\n' +
        "export fun size(c: Crate): Float =\n" +
        "    let Crate({n}) = c\n" +
        "    n\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([]);

    const exports = await runProject([
      ["/geo.hex", GEO],
      ["/main.hex",
        'import Crate from "./geo"\n' +
        "export fun size(c: Crate): Float =\n" +
        "    match c\n" +
        "        Crate({n}) => n\n" +
        "export let v: Float = size(Crate.make())\n"],
    ]);
    expect(exports.v).toBe(6.0);
  });

  test("a module alias qualifies it, exactly as it qualifies a union's (§3.3)", async () => {
    expect(compileFiles([
      ["/geo.hex", GEO],
      ["/main.hex",
        'import Geo from "./geo"\n' +
        "export fun size(c: Geo.Crate): Float =\n" +
        "    let Geo.Crate({n}) = c\n" +
        "    n\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([]);

    const exports = await runProject([
      ["/geo.hex", GEO],
      ["/main.hex",
        'import Geo from "./geo"\n' +
        "export fun size(c: Geo.Crate): Float =\n" +
        "    match c\n" +
        "        Geo.Crate({n}) => n\n" +
        "export let v: Float = size(Geo.make())\n"],
    ]);
    expect(exports.v).toBe(6.0);
  });

  test("with the alias spelled the same, the constructor is bare through rule 3 alone", () => {
    // §4.2's "the *name* does not travel" is still true — this is not the door,
    // it is rule 3 firing in the resolver, before the door is ever consulted
    // (Pattern Matching §2.2's own ordering). A `let`'s subject is typed first
    // regardless, so this seat cannot tell the two mechanisms apart on its own;
    // `qualified-constructor-patterns.test.ts` §303 pins the mechanism itself.
    expect(compileFiles([
      ["/geo.hex", GEO],
      ["/main.hex",
        'import Crate from "./geo"\n' +
        "export fun size(): Float =\n" +
        "    let Crate({n}) = Crate.make()\n" +
        "    n\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([]);
  });

  test("without a supplying seat, the door is closed — the alias's own rewrite is offered", () => {
    // A lambda parameter is a door seat only where a #513 supplying seat hands
    // its type in (Pattern Matching §2.2); an unannotated `let` gives the
    // lambda none, so the pattern's expected type is a fresh variable when it
    // is checked and the closed-door refusal fires, naming the qualified
    // spelling the visible alias reaches (`Geo.Crate`, since the alias here is
    // spelled `Geo`, not `Crate`, so rule 3 never fires either) and the seat
    // that would open the door.
    expect(compileFiles([
      ["/geo.hex", GEO],
      ["/main.hex",
        'import Geo from "./geo"\n' +
        "let size = Crate({n}) => n\n" +
        "export let v: Float = size(Geo.make())\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      "no bare `Crate` here: its type is not determined at this pattern — " +
        "write `Geo.Crate(…)`, or bind the function with its own annotated `let`",
    ]);
  });

  test("an opaque record refuses outside its home, even through the alias's own spelling (§4.2)", () => {
    // Modules §5.1's own sentence: rule 3 "reads the module's *exported*
    // constructor, so an opaque record's constructor is out of reach abroad
    // exactly as its qualified spelling is" — and Pattern Matching §2.2's
    // door, reached here because rule 3 found nothing, reads the declaration
    // rather than scope, which makes it the one reader that could hand back a
    // constructor no spelling in this module can write. It asks
    // `#recordRepresentationVisible` before it answers, so the refusal is the
    // opaque family's own — the sibling of the field access and the update.
    expect(compileFiles([
      ["/geo.hex",
        "opaque record Crate = {n: Float}\n" +
        "export fun size(c: Crate): Float =\n" +
        "    let Crate({n}) = c\n" +
        "    n\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([]);
  });
});

describe("a `match` on a nominal-record scrutinee", () => {
  test("one arm with an irrefutable sub-pattern is exhaustive, and runs", async () => {
    expect(projectDiagnostics(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    match c\n" +
      "        Crate({n}) => n\n",
    )).toEqual([]);

    const exports = await runMain(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    match c\n" +
      "        Crate({n}) => n\n" +
      "export let v: Float = size(Crate({n = 3.5, tag = \"a\"}))\n",
    );
    expect(exports.v).toBe(3.5);
  });

  test("a refutable sub-pattern leaves the match open, and the witness is the constructor", () => {
    // §7.1's finite-shape clause at one constructor; §7.3's degenerate
    // rendering, which for a sole constructor is its name.
    expect(projectDiagnostics(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    match c\n" +
      "        Crate({tag = \"a\"}) => 1.0\n",
    )).toEqual(["match is missing cases: `Crate(_)`"]);
  });

  test("a refutable arm followed by a covering one is exhaustive, and both run", async () => {
    expect(projectDiagnostics(
      CRATE +
      "export fun name(c: Crate): String =\n" +
      "    match c\n" +
      "        Crate({tag = \"a\"}) => \"first\"\n" +
      "        Crate({tag}) => tag\n",
    )).toEqual([]);

    const exports = await runMain(
      CRATE +
      "export fun name(c: Crate): String =\n" +
      "    match c\n" +
      "        Crate({tag = \"a\"}) => \"first\"\n" +
      "        Crate({tag}) => tag\n" +
      "export let hit: String = name(Crate({n = 0.0, tag = \"a\"}))\n" +
      "export let miss: String = name(Crate({n = 0.0, tag = \"b\"}))\n",
    );
    expect([exports.hit, exports.miss]).toEqual(["first", "b"]);
  });

  test("an arm shadowed by an earlier covering arm is unreachable (§7.2)", () => {
    expect(projectDiagnostics(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    match c\n" +
      "        Crate({n}) => n\n" +
      "        Crate({n}) => n\n",
    )).toEqual(["this match arm is unreachable; an earlier pattern matches everything"]);
  });

  test("a catch-all still covers, and still shadows", () => {
    expect(projectDiagnostics(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    match c\n" +
      "        _ => 0.0\n",
    )).toEqual([]);
    expect(projectDiagnostics(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    match c\n" +
      "        _ => 0.0\n" +
      "        Crate({n}) => n\n",
    )).toEqual(["this match arm is unreachable; an earlier pattern matches everything"]);
  });

  test("a guarded arm contributes nothing to coverage (§7.1)", () => {
    // With no unguarded arm at all, nothing has split the domain, and §7.3's
    // "prefer the shallowest witness that is genuinely missing" answers `_`
    // rather than naming the sole constructor: every value is uncovered.
    expect(projectDiagnostics(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    match c\n" +
      "        Crate({n}) when n > 0.0 => n\n",
    )).toEqual(["match is missing cases: `_`"]);
  });

  test("the pattern nests inside a union arm", async () => {
    const exports = await runMain(
      CRATE +
      "export fun size(c: Option(Crate)): Float =\n" +
      "    match c\n" +
      "        Some(Crate({n})) => n\n" +
      "        _ => 0.0\n" +
      "export let some: Float = size(Some(Crate({n = 4.0, tag = \"a\"})))\n" +
      "export let none: Float = size(None)\n",
    );
    expect([exports.some, exports.none]).toEqual([4.0, 0.0]);
  });

  test("nested under a union slot, a sole-constructor sub-pattern covers (§7.1)", () => {
    // **#594**, both halves at once. The slot of `Some(a)` used to be read off
    // the *declaration*, where it is a bare type variable carrying no shape, so
    // a constructor sub-pattern under it decomposed nothing and the arm never
    // covered `Some`. The matrix reads the **instantiated** slot — `Wrapped`
    // here — where a sole constructor is exactly what §5.1 says it is, and the
    // two spellings of a newtype answer alike.
    const nested = (arm: string, declaration: string) => projectDiagnostics(
      declaration +
      "export fun size(o: Option(Wrapped)): Int =\n" +
      "    match o\n" +
      `        ${arm}\n` +
      "        None => 0\n",
    );
    expect(nested("Some(Wrapped(n)) => n", "export union Wrapped = Wrapped(Int)\n"))
      .toEqual([]);
    expect(nested("Some(Wrapped({n})) => n", "export record Wrapped = {n: Int}\n"))
      .toEqual([]);
  });

  test("`as` binds the whole nominal value beside the destructured fields", async () => {
    const exports = await runMain(
      CRATE +
      "export fun twice(c: Crate): Float =\n" +
      "    match c\n" +
      "        Crate({n}) as whole => n + whole.n\n" +
      "export let v: Float = twice(Crate({n = 1.5, tag = \"a\"}))\n",
    );
    expect(exports.v).toBe(3.0);
  });
});

describe("every binding position takes it, gated only by irrefutability (§6)", () => {
  test("a lambda parameter destructures, and runs", async () => {
    expect(projectDiagnostics(
      CRATE +
      "let size: (Crate) -> Float = Crate({n}) => n\n" +
      "export let v: Float = size(Crate({n = 1.0, tag = \"a\"}))\n",
    )).toEqual([]);

    const exports = await runMain(
      CRATE +
      "let size: (Crate) -> Float = Crate({n}) => n\n" +
      "export let v: Float = size(Crate({n = 9.0, tag = \"a\"}))\n",
    );
    expect(exports.v).toBe(9.0);
  });

  test("a `for..in` loop variable destructures, and runs", async () => {
    expect(projectDiagnostics(
      CRATE +
      "export fun total(cs: Vector(Crate)): Float =\n" +
      "    var sum = 0.0\n" +
      "    for Crate({n}) in cs\n" +
      "        sum := sum + n\n" +
      "    sum\n",
    )).toEqual([]);

    const exports = await runMain(
      CRATE +
      "export fun total(cs: Vector(Crate)): Float =\n" +
      "    var sum = 0.0\n" +
      "    for Crate({n}) in cs\n" +
      "        sum := sum + n\n" +
      "    sum\n" +
      "export let v: Float = total([Crate({n = 1.5, tag = \"a\"}), Crate({n = 2.0, tag = \"b\"})])\n",
    );
    expect(exports.v).toBe(3.5);
  });

  test("the gate is the sub-pattern's, and it still bites in each seat (§5.3)", () => {
    // The constructor half is irrefutable by §5.1's table — "a record
    // constructor is always sole constructor" — so a refusal here can only come
    // from the inside of the pattern, and does.
    expect(projectDiagnostics(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    let Crate({tag = \"a\"}) = c\n" +
      "    1.0\n",
    )).toEqual([
      "this pattern can fail: `Crate(_)`; use `match`",
    ]);
    expect(projectDiagnostics(
      CRATE +
      "let size: (Crate) -> Float = Crate({tag = \"a\"}) => 1.0\n" +
      "export let v: Float = size(Crate({n = 1.0, tag = \"a\"}))\n",
    )).toEqual([
      "this pattern can fail: `Crate(_)`; use `match` — " +
        "for a match function, write `match` with arms",
    ]);
    expect(projectDiagnostics(
      CRATE +
      "export fun total(cs: Vector(Crate)): Float =\n" +
      "    var sum = 0.0\n" +
      "    for Crate({tag = \"a\"}) in cs\n" +
      "        sum := sum + 1.0\n" +
      "    sum\n",
    )).toEqual([
      "this pattern can fail: `Crate(_)`; use `match`",
    ]);
  });

  test("a `catch` arm is the one position it does not reach", () => {
    // Type-appropriate, per §6.2: a catch arm's scrutinee is `Exn`, and a
    // record constructor is not an exception constructor. The message is the
    // existing one for a non-exception constructor in that seat.
    expect(projectDiagnostics(
      CRATE +
      "export fun size(): Float =\n" +
      "    try\n" +
      "        1.0\n" +
      "    catch\n" +
      "        Crate({n}) => n\n",
    )).toEqual(["`Crate` is not an exception constructor"]);
  });
});

describe("the bare record pattern is redirected, not mismatched (§2.4)", () => {
  test("in a `let`, the redirect names the constructor and the written fields", () => {
    expect(projectDiagnostics(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    let {n} = c\n" +
      "    n\n",
    )).toEqual(["`Crate` is a nominal record; destructure it with `Crate({n})`"]);
  });

  test("in a `match` arm, the same redirect", () => {
    expect(projectDiagnostics(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    match c\n" +
      "        {n, tag} => n\n",
    )).toEqual([
      // One error, not two: a record pattern is structurally irrefutable, so
      // the arm still reads as a catch-all for coverage and no missing-case
      // report piles on behind the redirect.
      "`Crate` is a nominal record; destructure it with `Crate({n, tag})`",
    ]);
  });

  test("opacity intercepts the redirect outside the home module (§2.4)", () => {
    // The redirect signposts the constructor, and outside an opaque record's
    // home that constructor is private — so the opaque family's own refusal
    // stands in its place, in the shape its two siblings already have. Nothing
    // is leaked on the way: the sentence carries no field name and no
    // constructor spelling, which is the field privacy §4.2 calls load-bearing.
    // The alias is spelled `Crate`, so §5.1 rule 2's companion fallback carries
    // the type bare with no named import to carry it (#762).
    const messages = compileFiles([
      ["/geo.hex",
        "opaque record Crate = {n: Float}\n" +
        "export fun make(): Crate = Crate({n = 1.0})\n"],
      ["/main.hex",
        'import Crate from "./geo"\n' +
        "export fun size(c: Crate): Float =\n" +
        "    let {n} = c\n" +
        "    n\n"],
    ]).diagnostics.map(({ message }) => message);
    expect(messages).toEqual([
      "cannot destructure opaque record `Crate`; use an operation exported by its home module",
    ]);
    expect(messages.join("\n")).not.toContain("`n`");
    expect(messages.join("\n")).not.toContain("Crate({");
  });

  test("the interception reads opacity where the field access reads it", () => {
    // Off the *program's* copy of the declaration, not the importer's flag
    // (#587/#589) — so a type that reached this module through an imported
    // signature, its name never spelled here, answers exactly as an imported
    // one does. The transparent twin below is the control: same reach, same
    // seat, and the redirect is what fires there.
    const reached = (head: string) => compileFiles([
      ["/geo.hex",
        `${head} record Crate = {n: Float}\n` +
        "export fun make(): Crate = Crate({n = 1.0})\n"],
      ["/mid.hex",
        'import Geo from "./geo"\n' +
        "export fun forged(): Geo.Crate = Geo.make()\n"],
      ["/main.hex",
        'import Mid from "./mid"\n' +
        "export fun size(): Float =\n" +
        "    let {n} = Mid.forged()\n" +
        "    n\n"],
    ]).diagnostics.map(({ message }) => message);
    expect(reached("opaque")).toEqual([
      "cannot destructure opaque record `Crate`; use an operation exported by its home module",
    ]);
    expect(reached("export")).toEqual([
      "`Crate` is a nominal record; destructure it with `Crate({n})`",
    ]);
  });

  test("inside the home module `opaque` changes nothing, and the redirect stands", () => {
    // §4.2's own sentence. The home module sees everything, so the seat has a
    // spelling to send the reader to and sends them to it.
    expect(compileFiles([
      ["/geo.hex",
        "opaque record Crate = {n: Float}\n" +
        "export fun size(c: Crate): Float =\n" +
        "    let {n} = c\n" +
        "    n\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      "`Crate` is a nominal record; destructure it with `Crate({n})`",
    ]);
  });

  test("a `match` arm outside the home module is intercepted too", () => {
    expect(compileFiles([
      ["/geo.hex",
        "opaque record Crate = {n: Float}\n" +
        "export fun make(): Crate = Crate({n = 1.0})\n"],
      ["/main.hex",
        'import Crate from "./geo"\n' +
        "export fun size(c: Crate): Float =\n" +
        "    match c\n" +
        "        {n} => n\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      "cannot destructure opaque record `Crate`; use an operation exported by its home module",
    ]);
  });

  test("a structural record scrutinee is untouched by the redirect", () => {
    expect(projectDiagnostics(
      "export fun size(c: {n: Float}): Float =\n" +
      "    let {n} = c\n" +
      "    n\n",
    )).toEqual([]);
  });
});

describe("arity is one, positional (§2.2)", () => {
  test("two sub-patterns draw the unions' own arity sentence", () => {
    expect(projectDiagnostics(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    match c\n" +
      "        Crate({n}, x) => n\n",
    )).toEqual(["constructor pattern `Crate` expects 1 arguments, got 2"]);
  });

  test("the bare payload constructor draws it too, and covers nothing", () => {
    expect(projectDiagnostics(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    match c\n" +
      "        Crate => 1.0\n",
    )).toEqual([
      // One report, not two: the matrix widens the missing sub-pattern to `_`,
      // so the arity defect is not also charged as a coverage gap (#594).
      "constructor pattern `Crate` expects 1 arguments, got 0",
    ]);
  });
});

describe("outside the home module the name carries it, and only the name", () => {
  const GEO = CRATE + "export fun make(): Crate = Crate({n = 6.0, tag = \"g\"})\n";

  test("the alias's own spelling brings the pattern bare, through rule 3 (#763)", async () => {
    // No import binds a name any smaller than a module now (#762) — a bare
    // constructor abroad is Modules §5.1 rule 3's companion fallback: the
    // alias is spelled `Crate`, the module exports a same-spelled constructor,
    // and term position has nothing of its own to answer with.
    expect(compileFiles([
      ["/geo.hex", GEO],
      ["/main.hex",
        'import Crate from "./geo"\n' +
        "export fun size(c: Crate): Float =\n" +
        "    let Crate({n}) = c\n" +
        "    n\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([]);

    const exports = await runProject([
      ["/geo.hex", GEO],
      ["/main.hex",
        'import Crate from "./geo"\n' +
        "export fun size(c: Crate): Float =\n" +
        "    match c\n" +
        "        Crate({n}) => n\n" +
        "export let v: Float = size(Crate.make())\n"],
    ]);
    expect(exports.v).toBe(6.0);
  });

  test("a module alias qualifies it, exactly as it qualifies a union's (§3.3)", async () => {
    expect(compileFiles([
      ["/geo.hex", GEO],
      ["/main.hex",
        'import Geo from "./geo"\n' +
        "export fun size(c: Geo.Crate): Float =\n" +
        "    let Geo.Crate({n}) = c\n" +
        "    n\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([]);

    const exports = await runProject([
      ["/geo.hex", GEO],
      ["/main.hex",
        'import Geo from "./geo"\n' +
        "export fun size(c: Geo.Crate): Float =\n" +
        "    match c\n" +
        "        Geo.Crate({n}) => n\n" +
        "export let v: Float = size(Geo.make())\n"],
    ]);
    expect(exports.v).toBe(6.0);
  });

  test("with the alias spelled the same, the constructor is bare through rule 3 alone", () => {
    // §4.2's "the *name* does not travel" is still true — this is not the door,
    // it is rule 3 firing in the resolver, before the door is ever consulted
    // (Pattern Matching §2.2's own ordering). A `let`'s subject is typed first
    // regardless, so this seat cannot tell the two mechanisms apart on its own;
    // `qualified-constructor-patterns.test.ts` §303 pins the mechanism itself.
    expect(compileFiles([
      ["/geo.hex", GEO],
      ["/main.hex",
        'import Crate from "./geo"\n' +
        "export fun size(): Float =\n" +
        "    let Crate({n}) = Crate.make()\n" +
        "    n\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([]);
  });

  test("without a supplying seat, the door is closed — the alias's own rewrite is offered", () => {
    // A lambda parameter is a door seat only where a #513 supplying seat hands
    // its type in (Pattern Matching §2.2); an unannotated `let` gives the
    // lambda none, so the pattern's expected type is a fresh variable when it
    // is checked and the closed-door refusal fires, naming the qualified
    // spelling the visible alias reaches (`Geo.Crate`, since the alias here is
    // spelled `Geo`, not `Crate`, so rule 3 never fires either) and the seat
    // that would open the door.
    expect(compileFiles([
      ["/geo.hex", GEO],
      ["/main.hex",
        'import Geo from "./geo"\n' +
        "let size = Crate({n}) => n\n" +
        "export let v: Float = size(Geo.make())\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      "no bare `Crate` here: its type is not determined at this pattern — " +
        "write `Geo.Crate(…)`, or bind the function with its own annotated `let`",
    ]);
  });

  test("an opaque record refuses outside its home, even through the alias's own spelling (§4.2)", () => {
    // KNOWN FAILURE — reported, not weakened (see the sweep report). Modules
    // §5.1's own sentence: rule 3 "reads the module's exported constructor, so
    // an opaque record's constructor is out of reach abroad exactly as its
    // qualified spelling is." Confirmed still true in expression position
    // (`Crate({n = 1.0})` under the same-spelled alias draws `unknown name
    // \`Crate\``) — but Pattern Matching §2.2's door, reached here because
    // rule 3 found nothing, resolves the head from the **declaration**
    // (`#constructorOfType` in checker.ts) with no call to
    // `#recordRepresentationVisible`, so `let Crate({n}) = c` currently
    // destructures the private field with zero diagnostics. This is the same
    // sentence's other half left unenforced, not a new rule: the pattern
    // eliminator's own opacity check (`#recordConstructorSlot`,
    // checker.ts:6492) never runs for the door-resolved case.
    expect(compileFiles([
      ["/geo.hex",
        "opaque record Crate = {n: Float}\n" +
        "export fun make(): Crate = Crate({n = 1.0})\n"],
      ["/main.hex",
        'import Crate from "./geo"\n' +
        "export fun size(c: Crate): Float =\n" +
        "    let Crate({n}) = c\n" +
        "    n\n"],
    ]).diagnostics.map(({ message }) => message)).toEqual([
      "cannot destructure opaque record `Crate`; use an operation exported by its home module",
    ]);
  });
});

describe("emission erases the wrapper, because there is none (Products §5.4)", () => {
  test("a `let` destructure reads the value directly", () => {
    expect(mainJs(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    let Crate({n}) = c\n" +
      "    n\n",
    )).toContain("const { n } = c;");
  });

  test("a bare sub-pattern binder is one `const`, not a field read", () => {
    expect(mainJs(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    let Crate(r) = c\n" +
      "    r.n\n",
    )).toContain("const r = c;");
  });

  test("a match arm tests no tag", () => {
    const javascript = mainJs(
      CRATE +
      "export fun size(c: Crate): Float =\n" +
      "    match c\n" +
      "        Crate({n}) => n\n",
    );
    expect(javascript).toContain("const n = __match.n;");
    expect(javascript).not.toContain('"Crate"');
    expect(javascript).not.toContain(".tag ===");
  });

  test("a `for..in` loop reads the item itself", () => {
    expect(mainJs(
      CRATE +
      "export fun total(cs: Vector(Crate)): Float =\n" +
      "    var sum = 0.0\n" +
      "    for Crate({n}) in cs\n" +
      "        sum := sum + n\n" +
      "    sum\n",
    )).toContain("const n = __item.n;");
  });

  test("the qualified spelling emits the same erased read", () => {
    expect(emitted([
      ["/geo.hex", CRATE],
      ["/main.hex",
        'import Geo from "./geo"\n' +
        "export fun size(c: Geo.Crate): Float =\n" +
        "    let Geo.Crate({n}) = c\n" +
        "    n\n"],
    ], "/main.hex")).toContain("const { n } = c;");
  });
});
