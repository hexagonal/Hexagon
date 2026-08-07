import { describe, expect, test } from "vitest";

import {
  compileFiles,
  compileMain,
  projectDiagnostics,
  runMain,
  runProject,
} from "../support/test-project.js";

/**
 * PR γ of #304/#335: **constraint members join the dot** — through the instances
 * a known type honors and through a declared variable's written bounds, never
 * through search (Method Syntax §7, reversal record §16.2).
 *
 * Everything that can run, runs. A dot call that compiles and dispatches to the
 * wrong instance is the failure mode this arc is most exposed to, and only
 * executing the emitted JavaScript sees it — the same reason PR α's three
 * recursion pins execute.
 *
 * The programs are deliberately byte-distinct from one another: two conformance
 * modules whose emitted JavaScript is identical share one instance through the
 * ESM data-URL cache, and a pin that silently measures its neighbour's module is
 * a pin that cannot fail.
 */

const STDLIB = import.meta.glob("../../../stdlib/*.hex", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

/** The canonical `stdlib/` source, by basename — the file a real project ships. */
function stdlib(basename: string): string {
  const entry = Object.entries(STDLIB).find(([path]) => path.endsWith(`/${basename}`));
  if (entry === undefined) throw new Error(`no stdlib/${basename}`);
  return entry[1];
}

/** Every diagnostic message a multi-module project produced, in order. */
function diagnostics(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

describe("the control: diagnostics are project-level, so prove the probe can fail", () => {
  test("an unknown name is still refused", () => {
    expect(projectDiagnostics("export let n: Int = totl(1)\n")).toEqual([
      "unknown name `totl`",
    ]);
  });
});

describe("#304's expected-outcome table, executed", () => {
  /**
   * The four rows the issue was filed on, plus the `Integral` row the direction
   * note added. None of them waits for a companion module: `show` is `Show`'s
   * member at each type, selected through the compiler's wired instances, and
   * `div` is `Integral`'s at `Int`.
   *
   * The bare-literal row is the one the defaulting amendment (§3.5) buys. Its
   * receiver carries `Num` at the dot and nothing else, so under the old order
   * the fallback imposed a row that `Num` could not discharge — a guaranteed
   * error. Defaulting now settles `Int` first and the goal re-fires as dispatch.
   */
  test("`42.show()`, `(42: Nat).show()`, `42n.show()`, `42.0.show()` all render 42", async () => {
    const exports = await runMain([
      "export let plain: String = 42.show()",
      "export let counted: String = (42: Nat).show()",
      "export let big: String = 42n.show()",
      "export let fractional: String = 42.0.show()",
      "",
    ].join("\n"));

    expect(exports.plain).toBe("42");
    expect(exports.counted).toBe("42");
    expect(exports.big).toBe("42");
    expect(exports.fractional).toBe("42");
  });

  test("`7.div(2)` is 3 — `Integral`'s member at `Int`, no companion involved", async () => {
    const exports = await runMain([
      "export let euclidean: Int = 7.div(2)",
      "export let negative: Int = (0 - 7).div(2)",
      "",
    ].join("\n"));

    // `-7 div 2` is -4: the Euclidean remainder is non-negative unconditionally,
    // which is what distinguishes `div` from `quot`.
    expect(exports.euclidean).toBe(3);
    expect(exports.negative).toBe(-4);
  });

  test("a nominal receiver dispatches its own instance's member", async () => {
    const exports = await runMain([
      "export record Coin = {face: Int}",
      "",
      "honor Show<Coin> =",
      '    show(coin) = "Coin#${coin.face}"',
      "",
      "export let minted: String = Coin({face = 7}).show()",
      "",
    ].join("\n"));

    expect(exports.minted).toBe("Coin#7");
  });

  test("a prelude union receiver reaches its derived instance", async () => {
    const exports = await runMain([
      "export let yes: String = True.show()",
      "export let no: String = False.show()",
      "",
    ].join("\n"));

    expect(exports.yes).toBe("True");
    expect(exports.no).toBe("False");
  });
});

describe("declared type variables dispatch their bounds' members (§3.4)", () => {
  test("`value.show()` under `a: Show`, executed at two types", async () => {
    const exports = await runMain([
      "export let display<a: Show>(value: a): String = value.show()",
      "",
      "export let numeric: String = display(11)",
      'export let textual: String = display("eleven")',
      "",
    ].join("\n"));

    expect(exports.numeric).toBe("11");
    expect(exports.textual).toBe("eleven");
  });

  test("`x.compare(y)` under `a: Ord`, and `x.equals(y)` through the base constraint", async () => {
    const exports = await runMain([
      "export let ranked<a: Ord>(left: a, right: a): String = \"${left.compare(right)}\"",
      "export let alike<a: Ord>(left: a, right: a): Bool = left.equals(right)",
      "",
      "export let numbers: String = ranked(2, 9)",
      'export let words: String = ranked("z", "a")',
      "export let twins: Bool = alike(4, 4)",
      "",
    ].join("\n"));

    // Constraints §2.1: `Ord` entails `Eq`, so `equals` is as reachable through
    // the binder as `compare` is — the bases-included half of §3.4's row.
    expect(exports.numbers).toBe("Less");
    expect(exports.words).toBe("Greater");
    expect(exports.twins).toBe(true);
  });

  /**
   * §16.2's forcing exhibit, executed on a nested value.
   *
   * The own-name refusal removes the bare spelling inside a member's own body,
   * and in a *parameterized* instance the recursive position has the declared
   * variable's type — where a constraint declared in the honoring module has no
   * qualified spelling at all, because a module cannot name itself. Without
   * bound-member dispatch this rewrite would not exist to write, which is why
   * James ruled the bounds row on exactly this shape.
   */
  test("a parameterized instance spells its recursion with the dot at the rigid position", async () => {
    const exports = await runMain([
      "export constraint Sketch<a> =",
      "    sketch(value: a): String",
      "",
      "honor Sketch<Int> =",
      '    sketch(n) = "#${n}"',
      "",
      "export record Crate(a) = {held: a}",
      "",
      "honor<a: Sketch> Sketch<Crate(a)> =",
      '    sketch(crate) = "[${crate.held.sketch()}]"',
      "",
      // Annotated because `Sketch` is a user constraint and so outside §4's
      // closed defaultable set — nothing settles these literals to `Int`.
      "let four: Int = 4",
      "let five: Int = 5",
      "export let shallow: String = sketch(Crate({held = four}))",
      "export let nested: String = sketch(Crate({held = Crate({held = five})}))",
      "",
    ].join("\n"));

    expect(exports.shallow).toBe("[#4]");
    expect(exports.nested).toBe("[[#5]]");
  });

  test("a bound with no such member takes §9 row 7's options message, never a row", () => {
    expect(projectDiagnostics(
      "export let go<a: Show>(value: a): Int = value.process()\n",
    )).toEqual([
      "`a` is a declared type variable, so `.process` can only be one of its " +
      "constraints' members, and none of `a`'s constraints has a subject-first " +
      "member `process`; add the constraint to the parameter's binder, use a " +
      "concrete nominal type, or call a qualified function",
    ]);
  });
});

describe("the defaulting step precedes the row fallback (§3.3, §3.5)", () => {
  test("`(x + x).show()` infers `Int` and runs", async () => {
    const exports = await runMain([
      "export let doubled(x: Int): String = (x + x).show()",
      "",
      "export let paired: String = doubled(21)",
      "",
    ].join("\n"));

    expect(exports.paired).toBe("42");
  });

  /**
   * Test §14(n), reworded by the amendment. `x` picks up `Num` from `add`; at the
   * deadline the defaulting step settles it to `Int`, the goal re-fires, and
   * `total` is no field, companion operation, or honored member of `Int`. Same
   * program, same refusal — now phrased against `Int` rather than against a row
   * that could never discharge `Num`.
   */
  test("an unknown name on a defaultable receiver is the row-4 error, phrased against `Int`", () => {
    expect(projectDiagnostics(
      "let m(x) = add(x, x.total(1))\nexport let n: Int = m(1)\n",
    )).toEqual([
      "`Int` has no field `total`, its companion exports no operation `total`, " +
      "and no constraint honored at `Int` has a subject-first member `total`; " +
      "call an available subject-first function explicitly",
    ]);
  });

  test("evidence arriving later in the owner region still resolves the goal", async () => {
    const exports = await runMain([
      "let measure(v) =",
      "    let width = v.length()",
      "    let known: Vector(Int) = v",
      "    width",
      "",
      "export let counted: Int = measure([3, 1, 4])",
      "",
    ].join("\n"));

    // §14(d): the goal pends past the inner `let`, and `v`'s annotation below
    // the dot is what makes the receiver head-known at the region's deadline.
    expect(exports.counted).toBe(3);
  });
});

describe("qualified access reaches the members a module honors (Modules §5.3)", () => {
  test("`Rat.add(r1, r2)` is `Num<Rat>`'s member, executed", async () => {
    const exports = await runProject([
      ["/Rat.hex", stdlib("Rat.hex")],
      ["/main.hex", [
        'import * as Rat from "./Rat"',
        "",
        "export let total: String = \"${Rat.add(Rat.fromInt(1), Rat.fromInt(2))}\"",
        "export let scaled: String = \"${Rat.multiply(Rat.fromInt(3), Rat.fromInt(4))}\"",
        "",
      ].join("\n")],
    ]);

    expect(exports.total).toBe("3/1");
    expect(exports.scaled).toBe("12/1");
  });

  test("the module-less primitive companions carry the member spellings", async () => {
    const exports = await runMain([
      "export let integral: String = Int.show(1)",
      "export let counting: String = Nat.show((2: Nat))",
      "export let large: String = BigInt.show(3n)",
      "export let inexact: String = Float.show(4.0)",
      'export let textual: String = String.show("five")',
      "",
    ].join("\n"));

    expect(exports.integral).toBe("1");
    expect(exports.counting).toBe("2");
    expect(exports.large).toBe("3");
    expect(exports.inexact).toBe("4");
    expect(exports.textual).toBe("five");
  });

  test("`Bool.show(True)` reaches the derived instance", async () => {
    const exports = await runMain([
      "export let flag: String = Bool.show(False)",
      "",
    ].join("\n"));

    expect(exports.flag).toBe("False");
  });

  test("the declaring module's polymorphic read still wins", async () => {
    const exports = await runMain([
      "export let anyType<a: Show>(value: a): String = Show.show(value)",
      "",
      "export let onInt: String = anyType(6)",
      'export let onText: String = anyType("six")',
      "",
    ].join("\n"));

    // §5.3: `Show.show` is the *declaration's* export, so it is still
    // polymorphic — the honored-member read is the third one, never the first.
    expect(exports.onInt).toBe("6");
    expect(exports.onText).toBe("six");
  });

  test("a qualified member reference is pinned at the type the module honors", () => {
    expect(projectDiagnostics('export let wrong: String = Int.show("hi")\n')).toEqual([
      "type mismatch: expected Int, found String",
    ]);
  });

  test("`Int.div` keeps the intrinsic route the §9.2 schedule owns", async () => {
    const exports = await runMain([
      "export let quotient: Int = Int.div(9, 4)",
      "",
    ].join("\n"));

    expect(exports.quotient).toBe(2);
  });

  test("honoring one constraint at several own types makes the spelling ambiguous", () => {
    expect(diagnostics([
      ["/shapes.hex", [
        "export record Disc = {radius: Int}",
        "export record Bar = {width: Int}",
        "",
        "honor Show<Disc> =",
        '    show(disc) = "Disc"',
        "",
        "honor Show<Bar> =",
        '    show(bar) = "Bar"',
        "",
      ].join("\n")],
      ["/main.hex", [
        'import * as Shapes from "./shapes"',
        "",
        "export let drawn: String = Shapes.show(Shapes.Disc({radius = 1}))",
        "",
      ].join("\n")],
    ])).toEqual([
      "`Shapes.show` is ambiguous: `Shapes` honors a constraint with a member " +
      "`show` at `Disc` and `Bar`. Write the dot call on a value of the type you " +
      "mean, the bare `show(…)`, or the declaring module's qualified spelling.",
    ]);
  });

  /**
   * The one-exporter law (Constraints §4.6's last bullet). If honoring modules
   * poured their member bindings into consumers' bare scope, `show` would have
   * as many exporters as the prelude has companions and Modules §5.5 would
   * refuse the bare name everywhere. Qualification is the only outside route.
   */
  test("an honoring module's member is not a bare export in consumers", () => {
    expect(diagnostics([
      ["/dial.hex", [
        "export record Dial = {mark: Int}",
        "",
        "honor Show<Dial> =",
        '    show(dial) = "Dial"',
        "",
      ].join("\n")],
      ["/main.hex", [
        'import { Dial, show } from "./dial"',
        "",
        "export let read: String = show(Dial({mark = 2}))",
        "",
      ].join("\n")],
    ])).toEqual([
      "module `./dial` does not export `show`",
    ]);
  });
});

describe("duplicate claimants refuse, and never rank (§6, §9 row 6)", () => {
  test("two constraints honored at one type refuse the fused form, naming both homes", () => {
    expect(diagnostics([
      ["/loud.hex", [
        "export constraint Loud<a> =",
        "    volume(value: a): Int",
        "",
      ].join("\n")],
      ["/soft.hex", [
        "export constraint Soft<a> =",
        "    volume(value: a): Int",
        "",
      ].join("\n")],
      ["/main.hex", [
        'import * as Loud from "./loud"',
        'import * as Soft from "./soft"',
        "",
        "export record Gauge = {needle: Int}",
        "",
        "honor Loud.Loud<Gauge> =",
        "    volume(gauge) = gauge.needle",
        "",
        "honor Soft.Soft<Gauge> =",
        "    volume(gauge) = 0 - gauge.needle",
        "",
        "export let reading: Int = Gauge({needle = 3}).volume()",
        "",
      ].join("\n")],
    ])).toEqual([
      "`volume` after a dot is ambiguous at `Gauge`: `Loud`'s member `volume`, " +
      "`Soft`'s member `volume`. Write `Loud.volume(…)` or `Soft.volume(…)`.",
    ]);
  });

  test("a binder carrying two same-spelled members refuses on the declared variable", () => {
    expect(diagnostics([
      ["/near.hex", [
        "export constraint Near<a> =",
        "    reach(value: a): Int",
        "",
      ].join("\n")],
      ["/far.hex", [
        "export constraint Far<a> =",
        "    reach(value: a): Int",
        "",
      ].join("\n")],
      ["/main.hex", [
        'import * as Near from "./near"',
        'import * as Far from "./far"',
        "",
        "export let span<a: (Near.Near, Far.Far)>(value: a): Int = value.reach()",
        "",
      ].join("\n")],
    ])).toEqual([
      "`reach` after a dot is ambiguous on `a`: `Near` and `Far` each declare a " +
      "member `reach`. Write `Near.reach(…)` or `Far.reach(…)`.",
    ]);
  });

  test("a visible field and an honored member collide at the fused form", () => {
    expect(projectDiagnostics([
      "export record Label = {show: Int}",
      "",
      "honor Show<Label> =",
      '    show(label) = "Label"',
      "",
      "export let printed: String = Label({show = 1}).show()",
      "",
    ].join("\n"))).toEqual([
      "`show` after a dot is ambiguous at `Label`: a field `show`, `Show`'s " +
      "member `show`. Write `Show.show(…)`, or `(…​.show)` for the field.",
    ]);
  });
});

describe("member bindings enter the module's order at their own line (§4.6)", () => {
  test("a block above the one that binds a sibling's name takes the declared-later error", () => {
    const messages = projectDiagnostics([
      "export record Ratio = {top: Int, bottom: Int}",
      "",
      "honor Frac<Ratio> =",
      "    divide(left, right) = multiply(left, right)",
      "",
      "honor Num<Ratio> =",
      "    add(left, right) = left",
      "    multiply(left, right) = right",
      "    fromNat(n) = Ratio({top = 0, bottom = 1})",
      "",
    ].join("\n"));

    // Never "unknown name", which would be false — the fix is the ordinary one:
    // order the blocks.
    expect(messages).toContain(
      "`multiply` is bound by the `Num` instance below this use; declarations " +
      "are read top-down — move the instance above this use, or reach it " +
      "through dispatch",
    );
  });

  test("the same module reordered compiles, and the sibling call runs", async () => {
    const exports = await runMain([
      "export record Span = {lo: Int, hi: Int}",
      "",
      "honor Num<Span> =",
      "    add(left, right) = Span({lo = left.lo + right.lo, hi = left.hi + right.hi})",
      "    multiply(left, right) = Span({lo = left.lo * right.lo, hi = left.hi * right.hi})",
      "    fromNat(n) = Span({lo = 0, hi = 0})",
      "",
      "honor Signed<Span> =",
      "    subtract(left, right) = add(left, right)",
      "    negate(value) = value",
      "    fromInt(n) = Span({lo = 0, hi = 0})",
      "",
      "export let joined: Int = Span({lo = 1, hi = 2}).subtract(Span({lo = 3, hi = 4})).hi",
      "",
    ].join("\n"));

    // A sibling member's bare spelling, below its line, means that binding —
    // and `subtract` reaches it, so the dot call on the result reads `hi`.
    expect(exports.joined).toBe(6);
  });
});

describe("§9 row 8: the post-finalisation contradiction names its cause", () => {
  /**
   * The worst error this feature can produce, at maximal distance from its
   * cause. `render`'s parameter is never head-known, so it finalises at the row
   * the fallback imposed; the contradiction surfaces at a *use*, where a naive
   * "`Int` is not a record" says nothing about why the row exists.
   *
   * The member clause is γ's addition (§3.6, amended 2026-08-07): before it the
   * rescue could only speak for companion operations, and `show` is nobody's
   * companion operation.
   */
  test("a row-finalised parameter meeting a nominal is redirected, member clause", () => {
    expect(projectDiagnostics([
      "let render(v) = v.show()",
      "let counted: Int = 42",
      "export let out: String = render(counted)",
      "",
    ].join("\n"))).toEqual([
      "this value's type was inferred as a record with a `show` field because " +
      "its type was unknown where it was written; `Int` is not a record. " +
      "Annotate it to use dispatch, or call `Show.show(…)` directly.",
    ]);
  });

  test("the companion clause names the companion, by head and not by display", () => {
    expect(projectDiagnostics([
      "let measure(v) = v.length()",
      "let items: Vector(Int) = [1, 2]",
      "export let out: Int = measure(items)",
      "",
    ].join("\n"))).toEqual([
      "this value's type was inferred as a record with a `length` field because " +
      "its type was unknown where it was written; `Vector(Int)` is not a record. " +
      "Annotate it to use dispatch, or call `Vector.length(…)` directly.",
    ]);
  });
});

describe("what member dispatch emits (§8.1)", () => {
  /**
   * "Member dispatch emits exactly what the bare member call emits at the same
   * type; the dot spelling adds no emission shape of its own." Measured on the
   * two shapes that differ from each other — a monomorphic use, where selection
   * erases to the concrete instance's slot, and a generic one, where the
   * forwarder takes passed evidence.
   */
  test("the dot and the bare call emit the same text", () => {
    const dotted = compileMain([
      "export record Tick = {n: Int}",
      "",
      "honor Show<Tick> =",
      '    show(tick) = "t"',
      "",
      "export let ground: String = Tick({n = 1}).show()",
      "export let generic<a: Show>(value: a): String = value.show()",
      "",
    ].join("\n"));
    const bare = compileMain([
      "export record Tick = {n: Int}",
      "",
      "honor Show<Tick> =",
      '    show(tick) = "t"',
      "",
      "export let ground: String = show(Tick({n = 1}))",
      "export let generic<a: Show>(value: a): String = show(value)",
      "",
    ].join("\n"));

    expect(dotted.diagnostics).toEqual([]);
    expect(bare.diagnostics).toEqual([]);
    expect(dotted.modules.at(-1)!.javascript.text).toBe(
      bare.modules.at(-1)!.javascript.text,
    );
  });
});
