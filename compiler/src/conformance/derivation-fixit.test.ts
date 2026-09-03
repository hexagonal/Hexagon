import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics } from "../support/test-project.js";

/**
 * Conformance for Modules §7.6's **derivation-fixit composition** (#644) — what
 * the missing-instance report says when the constraint the subject lacks is one
 * it could simply `derives`.
 *
 * Constraints §8 has always owed a derivation fixit at this seat; §7.6 is where
 * it meets the legal-homes clause, and the composition is not uniform:
 *
 * - **Appended** at `Eq`/`Ord`/`Show`. Both homes may lawfully hold a
 *   hand-written honor, so the clause stands and the fixit follows it as the
 *   cheaper repair. It names no file, the clause in front of it having just
 *   named the only one it could mean.
 * - **Replacing** at `Hash`. Collections Part 2 §4.1 refuses a hand-written
 *   `Hash` in every user module, so the form the two-home clause invites is
 *   accepted at *neither* home — and §7.6's precedent is that a home is offered
 *   only where what the reader would write there is accepted. The replacement
 *   sentence carries the seat and the path itself. Where the subject's `Eq` is
 *   hand-written, Part 2 §4.3 bars the derivation too, and the wrapper-key
 *   route (§4.5) replaces clause and fixit alike.
 *
 * Both dialects of §8 are pinned in each composition, and both are
 * **base-complete**: an absent base is named alongside, so a reader who follows
 * the fixit does not simply trade this error for the missing-base one.
 *
 * `instance-homes.test.ts` owns the clause itself and its four branches; this
 * file owns what joins it, and the gate — derivability read by *identity*, and
 * a `derives` seat that exists in project source.
 */

const messagesOf = (files: readonly (readonly [string, string])[]): readonly string[] =>
  compileFiles(files).diagnostics.map(({ message }) => message);

describe("appended: `Eq`, `Ord`, `Show` keep the clause and gain the fixit", () => {
  test("no `derives` list yet — the fixit offers the whole clause", () => {
    // §8's first dialect: there is nothing to extend, so the repair is to write
    // the clause. `Show` has no base, so nothing is named alongside it.
    expect(messagesOf([
      ["/main.hex", [
        "export union Colour = Red | Green",
        "",
        "export fun go(c: Colour): String = show(c)",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Colour` has no `Show` instance; it could only be declared in " +
        "`./main.hex` (declares `Colour`) or the module declaring `Show`" +
        "; add `derives Show` to the declaration of `Colour`",
    ]);
  });

  test("a `derives` list already there — the fixit extends it", () => {
    // §8's second dialect. `Eq` is present *and derived*, so `Ord`'s base is
    // satisfied and `Ord` is named alone.
    expect(messagesOf([
      ["/main.hex", [
        "export record Point derives Eq = {n: Int}",
        "",
        "export fun go(p: Point, q: Point): Ordering = Ord.compare(p, q)",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Point` has no `Ord` instance; it could only be declared in " +
        "`./main.hex` (declares `Point`) or the module declaring `Ord`" +
        "; add `Ord` to the `derives` list of `Point`",
    ]);
  });

  test("an absent base is named alongside, in the no-list dialect", () => {
    // James's point 3: a fixit that compiles when followed. A bare
    // `derives Ord` here would only trade this error for the missing-base one,
    // so the whole writable list is offered — and every base of the derivable
    // four is itself derivable, so there always is one.
    expect(messagesOf([
      ["/main.hex", [
        "export record Point = {n: Int}",
        "",
        "export fun go(p: Point, q: Point): Ordering = Ord.compare(p, q)",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Point` has no `Ord` instance; it could only be declared in " +
        "`./main.hex` (declares `Point`) or the module declaring `Ord`" +
        "; add `derives (Eq, Ord)` to the declaration of `Point`",
    ]);
  });

  test("an absent base is named alongside in the list dialect too", () => {
    // The cell the two dialects would be easiest to get half right in: the list
    // exists, and what it carries leaves the base absent all the same.
    expect(messagesOf([
      ["/main.hex", [
        "export record Point derives Show = {n: Int}",
        "",
        "export fun go(p: Point, q: Point): Ordering = Ord.compare(p, q)",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Point` has no `Ord` instance; it could only be declared in " +
        "`./main.hex` (declares `Point`) or the module declaring `Ord`" +
        "; add `(Eq, Ord)` to the `derives` list of `Point`",
    ]);
  });

  test("a hand-written base counts as present — `Ord` is named alone", () => {
    // Absence is measured against the *instance table*, not against the
    // `derives` clause: a hand-written `Eq` satisfies `Ord`'s base as well as a
    // derived one does, and naming `Eq` here would offer a second instance the
    // module already has. (`Hash` is the one constraint for which the
    // provenance of that `Eq` matters — see the wrapper-key case below.)
    expect(messagesOf([
      ["/main.hex", [
        "export record Point = {n: Int}",
        "",
        "honor Eq<Point> =",
        "    equals(left, right) = left.n == right.n",
        "",
        "export fun go(p: Point, q: Point): Ordering = Ord.compare(p, q)",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Point` has no `Ord` instance; it could only be declared in " +
        "`./main.hex` (declares `Point`) or the module declaring `Ord`" +
        "; add `derives Ord` to the declaration of `Point`",
    ]);
  });

  test("the appended fixit names no file — the clause in front of it just did", () => {
    // §7.6's own reason for letting the append go pathless, pinned as the
    // negative it is: the subject's home appears exactly once in the report.
    const [message] = messagesOf([
      ["/widget.hex", "export record Widget = {size: Int}\n"],
      ["/main.hex", [
        // Rule 3's companion fallback (Modules §3.2, #762): same-spelled alias.
        "import Widget from \"./widget\"",
        "",
        "export fun go(w: Widget): String = show(w)",
        "",
      ].join("\n")],
    ]);

    expect(message).toBe(
      "type `Widget` has no `Show` instance; it could only be declared in " +
        "`./widget.hex` (declares `Widget`) or the module declaring `Show`" +
        "; add `derives Show` to the declaration of `Widget`",
    );
    expect(message?.split("./widget.hex").length).toBe(2);
  });
});

describe("replacing: `Hash` offers only the seat the checker would accept", () => {
  test("no list, no `Eq` — the base-complete repair, with its path", () => {
    expect(projectDiagnostics(
      "record Point = {n: Int}\n" +
        "export let bad: Set(Point) = Set.add(Set.empty, Point({n = 1}))\n",
    )).toContain(
      "type `Point` has no `Hash` instance; `Hash` instances must be derived, " +
        "so the only repair is `derives (Eq, Hash)` on the declaration of `Point` " +
        "in `./main.hex`",
    );
  });

  test("a list already there, `Eq` derived — `Hash` alone joins it", () => {
    expect(projectDiagnostics(
      "record Point derives Eq = {n: Int}\n" +
        "export let bad: Set(Point) = Set.add(Set.empty, Point({n = 1}))\n",
    )).toContain(
      "type `Point` has no `Hash` instance; `Hash` instances must be derived, " +
        "so the only repair is adding `Hash` to `Point`'s `derives` list " +
        "in `./main.hex`",
    );
  });

  test("a list already there and `Eq` absent — the base joins it too", () => {
    expect(projectDiagnostics(
      "record Point derives Show = {n: Int}\n" +
        "export let bad: Set(Point) = Set.add(Set.empty, Point({n = 1}))\n",
    )).toContain(
      "type `Point` has no `Hash` instance; `Hash` instances must be derived, " +
        "so the only repair is adding `(Eq, Hash)` to `Point`'s `derives` list " +
        "in `./main.hex`",
    );
  });

  test("no list, `Eq` derived through §4.5's core form — `Hash` alone", () => {
    // The fourth cell of the grid, and the one the gate's two questions make
    // least obvious. Derivation has **two spellings** — `honor Eq<Point> =
    // derive` and the `derives` header sugar — so "no `derives` clause" and "no
    // derived `Eq`" are independent facts, and the dialect question cannot
    // answer the provenance one. A checker that read provenance off the
    // declaration's `derives` list would call this `Eq` hand-written and print
    // the wrapper-key report.
    expect(projectDiagnostics(
      "record Point = {n: Int}\n" +
        "honor Eq<Point> = derive\n" +
        "export let bad: Set(Point) = Set.add(Set.empty, Point({n = 1}))\n",
    )).toContain(
      "type `Point` has no `Hash` instance; `Hash` instances must be derived, " +
        "so the only repair is `derives Hash` on the declaration of `Point` " +
        "in `./main.hex`",
    );
  });

  test("the clause is gone, not merely followed", () => {
    // The whole of James's point 1, as a negative: the two-home template
    // invites a hand-written honor, and neither home would accept one.
    const messages = projectDiagnostics(
      "record Point = {n: Int}\n" +
        "export let bad: Set(Point) = Set.add(Set.empty, Point({n = 1}))\n",
    ).join("\n");

    expect(messages).not.toContain("could only be declared");
    expect(messages).not.toContain("the module declaring `Hash`");
  });

  test("a subject in another module names that module's path, not the reporting one", () => {
    // The replacing sentence carries a path of its own, so which path it is has
    // to be pinned somewhere the two files differ.
    expect(messagesOf([
      ["/point.hex", "export record Point = {n: Int}\n"],
      ["/main.hex", [
        "import Point from \"./point\"",
        "",
        "export let bad: Set(Point) = Set.add(Set.empty, Point({n = 1}))",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Point` has no `Hash` instance; `Hash` instances must be derived, " +
        "so the only repair is `derives (Eq, Hash)` on the declaration of `Point` " +
        "in `./point.hex`",
    ]);
  });

  test("a hand-written `Eq` takes the wrapper-key report instead", () => {
    // Collections Part 2 §4.3 bars the derivation itself here, so there is no
    // repair through this type's own instances at all: the report states the
    // positive requirement and §4.5's sanctioned route, self-containedly.
    expect(projectDiagnostics(
      "record Weird = {s: String}\n" +
        "honor Eq<Weird> =\n" +
        "    equals(left, right) = left.s == right.s\n" +
        "export let bad: Set(Weird) = Set.add(Set.empty, Weird({s = \"K\"}))\n",
    )).toContain(
      "type `Weird` has no `Hash` instance; `derives Hash` requires a derived `Eq`, " +
        "and `Weird` declares its own — key on a wrapper type whose `Eq` and `Hash` " +
        "are both derived",
    );
  });

  test("the wrapper-key report offers neither a repair nor a seat", () => {
    // The negative half: a `derives Hash` *fixit* here would be an impossible
    // one, which is the single thing §7.6 rules out by name. The words
    // `derives Hash` do appear — in the requirement the report states — so what
    // is pinned is the absence of the offer, not of the spelling.
    const messages = projectDiagnostics(
      "record Weird = {s: String}\n" +
        "honor Eq<Weird> =\n" +
        "    equals(left, right) = left.s == right.s\n" +
        "export let bad: Set(Weird) = Set.add(Set.empty, Weird({s = \"K\"}))\n",
    ).join("\n");

    expect(messages).not.toContain("the only repair");
    expect(messages).not.toContain("could only be declared");
  });
});

/**
 * `Eq`'s provenance is the one fact the `Hash` report needs that the consuming
 * module cannot see for itself, and the modal shape of the whole feature is a
 * library type used as a key downstream. `InstanceImport.derived` is what
 * carries the answer; before it existed, `#seedImportedInstance` hard-coded
 * `false` and every imported `Eq` read as hand-written — so the wrapper-key
 * report fired on `export record Point derives Eq` and hid the one-word repair.
 *
 * Both provenances are pinned across a module boundary, and the derived one is
 * pinned across two hops as well: the flag is the declaring module's word, and
 * a transit re-export must not launder it.
 */
describe("`Eq`'s provenance travels with the instance, not with the importer", () => {
  test("a derived `Eq` upstream gets the repair, at the declaring module's path", () => {
    expect(messagesOf([
      ["/point.hex", "export record Point derives Eq = {n: Int}\n"],
      ["/main.hex", [
        "import Point from \"./point\"",
        "",
        "export let bad: Set(Point) = Set.add(Set.empty, Point({n = 1}))",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Point` has no `Hash` instance; `Hash` instances must be derived, " +
        "so the only repair is adding `Hash` to `Point`'s `derives` list " +
        "in `./point.hex`",
    ]);
  });

  test("a hand-written `Eq` upstream gets the wrapper-key report", () => {
    // The other side of the same channel. Getting one of these right by
    // accident is easy — a hard-coded `false` passes this one — so the pair is
    // what makes the pin worth having.
    expect(messagesOf([
      ["/point.hex", [
        "export record Point = {n: Int}",
        "",
        "honor Eq<Point> =",
        "    equals(left, right) = left.n == right.n",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import Point from \"./point\"",
        "",
        "export let bad: Set(Point) = Set.add(Set.empty, Point({n = 1}))",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Point` has no `Hash` instance; `derives Hash` requires a derived `Eq`, " +
        "and `Point` declares its own — key on a wrapper type whose `Eq` and `Hash` " +
        "are both derived",
    ]);
  });

  test("two hops do not launder the flag", () => {
    // `./middle.hex` carries the instance through without declaring it, and a
    // transit module re-exports the dictionary, not the declaration. The
    // provenance is `./point.hex`'s word at both hops, and so is the path.
    expect(messagesOf([
      ["/point.hex", "export record Point derives (Eq, Show) = {n: Int}\n"],
      ["/middle.hex", [
        "import Point from \"./point\"",
        "",
        "export fun make(n: Int): Point = Point({n = n})",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import Middle from \"./middle\"",
        "",
        "export fun go(): Int = Set.size(Set.add(Set.empty, Middle.make(1)))",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Point` has no `Hash` instance; `Hash` instances must be derived, " +
        "so the only repair is adding `Hash` to `Point`'s `derives` list " +
        "in `./point.hex`",
    ]);
  });
});

describe("the gate: what draws no fixit at all", () => {
  test("a non-derivable pre-registered constraint is untouched", () => {
    // `Num` has no derivable form (Constraints §4.5's four, and no more), so
    // the clause stands alone exactly as it did before #644.
    expect(messagesOf([
      ["/main.hex", [
        "export record Box = {value: Float}",
        "honor Pow<Box> =",
        "    pow(value, exponent) = value",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Box` has no `Num` instance; it could only be declared in " +
        "`./main.hex` (declares `Box`) or the module declaring `Num`",
    ]);
  });

  test("a non-derivable user constraint draws no fixit", () => {
    // A user constraint has no `derives` form at all, so nothing is owed here
    // however the subject is declared. The *rival-spelling* case the identity
    // gate is really aimed at cannot be built from source — §5.1.1 makes all
    // eleven pre-registered names non-redeclarable, so no module can declare a
    // second `Show` for a name-keyed test to confuse the first with. The gate
    // is written by identity because that ban is the only thing standing
    // between the two readings, not because a program can tell them apart.
    expect(messagesOf([
      ["/render.hex", [
        "export constraint Render<a> =",
        "    render(subject: a): String",
        "",
      ].join("\n")],
      ["/main.hex", [
        // A constraint's members are reached through the alias or the dot
        // (Modules §3.2, #762) — the bare `render` is nothing now, so the
        // member is called qualified.
        "import Render from \"./render\"",
        "",
        "export record Panel = {width: Int}",
        "",
        "export fun go(p: Panel): String = Render.render(p)",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Panel` has no `Render` instance; it could only be declared in " +
        "`./main.hex` (declares `Panel`) or `./render.hex` (declares `Render`)",
    ]);
  });

  test("a prelude subject has no editable `derives` seat", () => {
    // `Option` carries `derives (Eq, Show)` in `stdlib/Option.hex`, and the
    // reader cannot extend it. This is also the shape a derivable constraint's
    // prelude subject *always* has: both homes are prelude ones, so the closed
    // pair is what stands, and offering `derives Ord` beside it would name a
    // file no reader may edit.
    expect(messagesOf([
      ["/main.hex", [
        "export fun go(m: Option(Int), n: Option(Int)): Ordering = Ord.compare(m, n)",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Option(Int)` has no `Ord` instance; its only legal homes are the module " +
        "declaring `Ord` and the prelude module declaring `Option`, both outside " +
        "project source, so this pair's honored set is closed — change the type, or " +
        "go through the operations those homes export",
    ]);
  });

  test("a primitive subject has no declaration to hang `derives` on", () => {
    // Constraints §5.3's fixed companion home, and no `derives` seat anywhere:
    // the closed-pair clause stands alone — with Method Syntax §9 row 15's
    // rider after it, which is a repair rather than a home (#808).
    expect(projectDiagnostics("export fun gap(a: Nat, b: Nat): Nat = a - b\n")).toEqual([
      "type `Nat` has no `Signed` instance; its only legal homes are the module " +
        "declaring `Signed` and `Nat`'s prelude companion module, both outside project " +
        "source, so this pair's honored set is closed — change the type, or go through " +
        "the operations those homes export; a written `Int` face runs the operation " +
        "and admits the result (`let difference: Int = …`)",
    ]);
  });

  /**
   * **No structural subject reaches the gate at a derivable constraint**, and
   * the two tests below are that fact rather than a branch of it.
   *
   * The four derivable constraints are satisfied componentwise at every
   * structural head (Constraints §4.5), so a structural type never *fails* one
   * as a whole: the failure is its component's, and the component is what the
   * report names. Measured, not assumed — `(Int, (Int) -> Int)`, `{n: (Int) ->
   * Int}` and `Vector((Int) -> Int)` all report on the function inside, at
   * `Show` and at `Hash` alike, and a plain `(Int, Int)` reports nothing at all.
   *
   * So the first test below does not exercise `#derivationFixit`: a `Function`
   * subject is answered by `#validate`'s own ternary, which never reaches
   * `#missingInstanceMessage`. It is kept as the boundary it pins — that the
   * function arm still owns its message — and labelled so no reader mistakes it
   * for coverage of the gate. The second test is the load-bearing half: it is
   * the only way a structural type gets a derivation fixit into a report, and
   * the fixit lands on the **component**, where the `derives` seat is.
   */
  test("a function subject is answered before the composition is reached", () => {
    expect(messagesOf([
      ["/main.hex", [
        "export fun go(p: ((Int) -> Int)): String = show(p)",
        "",
      ].join("\n")],
    ])).toEqual(["functions have no `Show` instance"]);
  });

  test("a structural subject's nominal component is what the fixit names", () => {
    expect(messagesOf([
      ["/main.hex", [
        "export record Odd = {n: Int}",
        "",
        "export fun go(p: (Int, Odd)): String = show(p)",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Odd` has no `Show` instance; it could only be declared in " +
        "`./main.hex` (declares `Odd`) or the module declaring `Show`" +
        "; add `derives Show` to the declaration of `Odd`",
    ]);
  });
});
