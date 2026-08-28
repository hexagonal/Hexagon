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
        "export fun go(p: Point, q: Point): Ordering = compare(p, q)",
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
        "export fun go(p: Point, q: Point): Ordering = compare(p, q)",
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
        "export fun go(p: Point, q: Point): Ordering = compare(p, q)",
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
        "export fun go(p: Point, q: Point): Ordering = compare(p, q)",
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
        "import { Widget } from \"./widget\"",
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
      "type `Point` has no `Hash` instance; `Hash` instances cannot be hand-written, " +
        "so the only repair is `derives (Eq, Hash)` on the declaration of `Point` " +
        "in `./main.hex`",
    );
  });

  test("a list already there, `Eq` derived — `Hash` alone joins it", () => {
    expect(projectDiagnostics(
      "record Point derives Eq = {n: Int}\n" +
        "export let bad: Set(Point) = Set.add(Set.empty, Point({n = 1}))\n",
    )).toContain(
      "type `Point` has no `Hash` instance; `Hash` instances cannot be hand-written, " +
        "so the only repair is adding `Hash` to `Point`'s `derives` list " +
        "in `./main.hex`",
    );
  });

  test("a list already there and `Eq` absent — the base joins it too", () => {
    expect(projectDiagnostics(
      "record Point derives Show = {n: Int}\n" +
        "export let bad: Set(Point) = Set.add(Set.empty, Point({n = 1}))\n",
    )).toContain(
      "type `Point` has no `Hash` instance; `Hash` instances cannot be hand-written, " +
        "so the only repair is adding `(Eq, Hash)` to `Point`'s `derives` list " +
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
        "import { Point } from \"./point\"",
        "",
        "export let bad: Set(Point) = Set.add(Set.empty, Point({n = 1}))",
        "",
      ].join("\n")],
    ])).toEqual([
      "type `Point` has no `Hash` instance; `Hash` instances cannot be hand-written, " +
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

  test("the wrapper-key report offers no `derives` and no seat", () => {
    // The negative half: a `derives Hash` fixit here would be an impossible
    // one, which is the single thing §7.6 rules out by name.
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

  test("a user constraint is untouched, whatever it is spelled", () => {
    // The identity gate, from the side that matters most: a module's own
    // `constraint Show` is a *different* constraint (§5.1.1), and its missing
    // instance has no `derives` form to offer. Read by name, this would print a
    // fixit that does not compile. `Show` itself is non-redeclarable, so the
    // nearest legal spelling stands in.
    expect(messagesOf([
      ["/render.hex", [
        "export constraint Render<a> =",
        "    render(subject: a): String",
        "",
      ].join("\n")],
      ["/main.hex", [
        "import { Render } from \"./render\"",
        "",
        "export record Panel = {width: Int}",
        "",
        "export fun go(p: Panel): String = render(p)",
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
        "export fun go(m: Option(Int), n: Option(Int)): Ordering = compare(m, n)",
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
    // the closed-pair clause stands alone.
    expect(projectDiagnostics("export fun gap(a: Nat, b: Nat): Nat = a - b\n")).toEqual([
      "type `Nat` has no `Signed` instance; its only legal homes are the module " +
        "declaring `Signed` and `Nat`'s prelude companion module, both outside project " +
        "source, so this pair's honored set is closed — change the type, or go through " +
        "the operations those homes export",
    ]);
  });

  test("a structural subject keeps the bare head, at a derivable constraint too", () => {
    // §7.6's subject carve-out is upstream of the whole composition: a tuple
    // has no declaring module, so neither clause nor fixit is true about it.
    expect(messagesOf([
      ["/main.hex", [
        "export fun go(p: ((Int) -> Int)): String = show(p)",
        "",
      ].join("\n")],
    ])).toEqual(["functions have no `Show` instance"]);
  });
});
