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
    expect(projectDiagnostics("module Main\n\n" + "export let n: Int = totl(1)\n")).toEqual([
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
      "module Main",
      "",
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
      "module Main",
      "",
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
      "module Main",
      "",
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
      "module Main",
      "",
      "export let yes: String = True.show()",
      "export let no: String = False.show()",
      "",
    ].join("\n"));

    expect(exports.yes).toBe("True");
    expect(exports.no).toBe("False");
  });
});

describe("only subject-first members are in the operation set (§4.2)", () => {
  /**
   * "A subject-first member is one whose first parameter's declared type is the
   * constraint's subject variable itself … `fromNat(value: Nat): a` does not
   * qualify (the subject appears only in the return), so `42.fromNat(…)` is not
   * a spelling and never will be."
   *
   * Pinned with §9 row 5's near-miss, which is the half a reader can act on: the
   * member exists and has a spelling, just not this one.
   */
  test("a member whose subject appears only in the return is not a spelling", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let n: Int = 3.fromNat(2)\n")).toEqual([
      "`Int` has no field `fromNat`, its companion exports no operation `fromNat`, " +
      "and no constraint whose instance at `Int` is visible in this module has a subject-first member `fromNat`; " +
      "`Num`'s member `fromNat` does not take its constraint's subject first — " +
      "call it as `Num.fromNat(…)`",
    ]);
    // The offered spelling, through the declaring module, compiles; the bare
    // one the hint used to name is the member channel's refusal (Modules §5.5).
    expect(projectDiagnostics("module Main\n\n" + "export let n: Int = Num.fromNat(2)\n")).toEqual([]);
    expect(projectDiagnostics("module Main\n\n" + "export let n: Int = fromNat(2)\n")).toEqual([
      "no bare `fromNat`; write `Num.fromNat(2)`",
    ]);
  });

  /**
   * The filter's teeth, and the reason a near-miss message is not the whole of
   * it. `wrap`'s first parameter is `Int` — not the subject — and the constraint
   * is honored **at `Int`**, so the parameter's type coincides with the
   * receiver's. Drop the subject-first test and `3.wrap()` does not merely lose
   * a hint: it *dispatches*, silently, as `wrap(3)`. The companion pin below
   * proves the call it would have become is well-typed, which is what makes the
   * refusal load-bearing rather than incidental.
   */
  test("a coincidental first-parameter type is refused, not dispatched", () => {
    expect(projectDiagnostics([
      "module Main",
      "",
      "constraint Wrap<a> =",
      "    wrap(count: Int) -> a",
      "",
      "honor Wrap<Int> =",
      "    wrap(count) = count * 2",
      "",
      "export let doubled: Int = 3.wrap()",
      "",
    ].join("\n"))).toEqual([
      "`Int` has no field `wrap`, its companion exports no operation `wrap`, and " +
      "no constraint whose instance at `Int` is visible in this module has a subject-first member `wrap`; " +
      "`Wrap`'s member `wrap` does not take its constraint's subject first — " +
      "call it as `wrap(…)`",
    ]);
  });

  test("the same member is well-typed and runs under its bare spelling", async () => {
    const exports = await runMain([
      "module Main",
      "",
      "constraint Wrap<a> =",
      "    wrap(count: Int) -> a",
      "",
      "honor Wrap<Int> =",
      "    wrap(count) = count * 3",
      "",
      "export let tripled: Int = wrap(3)",
      "",
    ].join("\n"));

    expect(exports.tripled).toBe(9);
  });
});

describe("declared type variables dispatch their bounds' members (§3.4)", () => {
  test("`value.show()` under `a: Show`, executed at two types", async () => {
    const exports = await runMain([
      "module Main",
      "",
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
      "module Main",
      "",
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
      "module Main",
      "",
      "export constraint Sketch<a> =",
      "    sketch(value: a) -> String",
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

  /**
   * The bounds arm carries §4.2's subject-first filter too, and it has to: the
   * candidate set here is the *whole* of what a declared variable can reach, so
   * a member the binder does hold but that does not take its constraint's
   * subject first must fall out before dispatch is attempted, not after.
   * `Tag`'s `tag` is in `a`'s bounds by name and absent from its operation set.
   */
  test("a bound member that is not subject-first is no spelling on the variable either", () => {
    expect(projectDiagnostics([
      "module Main",
      "",
      "constraint Tag<a> =",
      "    tag(label: String, value: a) -> String",
      "",
      'export let describe<a: Tag>(value: a): String = value.tag("x")',
      "",
    ].join("\n"))).toEqual([
      "`a` is a declared type variable, so `.tag` can only be one of its " +
      "constraints' members, and none of `a`'s constraints has a subject-first " +
      "member `tag`; add the constraint to the parameter's binder, use a " +
      "concrete nominal type, or call a qualified function",
    ]);
  });

  test("a bound with no such member takes §9 row 7's options message, never a row", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let go<a: Show>(value: a): Int = value.process()\n",
    )).toEqual([
      "`a` is a declared type variable, so `.process` can only be one of its " +
      "constraints' members, and none of `a`'s constraints has a subject-first " +
      "member `process`; add the constraint to the parameter's binder, use a " +
      "concrete nominal type, or call a qualified function",
    ]);
  });
});

describe("a numeric literal subject takes its default at the dot (§3.3)", () => {
  test("`(x + x).show()` infers `Int` and runs", async () => {
    const exports = await runMain([
      "module Main",
      "",
      "export let doubled(x: Int): String = (x + x).show()",
      "",
      "export let paired: String = doubled(21)",
      "",
    ].join("\n"));

    expect(exports.paired).toBe("42");
  });

  /**
   * Test §14(n). The literal's type is fresh and its own, so the subject takes
   * `Int` at the dot, and `total` is no field, companion operation, or honored
   * member of `Int`: the refusal is phrased against `Int`.
   */
  test("an unknown name on a literal subject is the row-4 error, phrased against `Int`", () => {
    expect(projectDiagnostics("module Main\n\n" + "export let n: Int = 7.total(1)\n",
    )).toEqual([
      "`Int` has no field `total`, its companion exports no operation `total`, " +
      "and no constraint whose instance at `Int` is visible in this module has a subject-first member `total`; " +
      "call an available subject-first function explicitly",
    ]);
  });
});

describe("qualified access reaches the members a module honors (Modules §5.3)", () => {
  test("`Rat.add(r1, r2)` is `Num<Rat>`'s member, executed", async () => {
    const exports = await runProject([
      ["/Rat.hex", stdlib("Rat.hex")],
      ["/main.hex", "module Main\n\n" + [
        'import Rat',
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
      "module Main",
      "",
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
      "module Main",
      "",
      "export let flag: String = Bool.show(False)",
      "",
    ].join("\n"));

    expect(exports.flag).toBe("False");
  });

  test("the declaring module's polymorphic read still wins", async () => {
    const exports = await runMain([
      "module Main",
      "",
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
    expect(projectDiagnostics("module Main\n\n" + 'export let wrong: String = Int.show("hi")\n')).toEqual([
      "type mismatch: expected Int, found String",
    ]);
  });

  test("`Int.div` keeps the intrinsic route the §9.2 schedule owns", async () => {
    const exports = await runMain([
      "module Main",
      "",
      "export let quotient: Int = Int.div(9, 4)",
      "",
    ].join("\n"));

    expect(exports.quotient).toBe(2);
  });

  test("honoring one constraint at several own types makes the spelling ambiguous", async () => {
    const shapes = ["/shapes.hex", "module Shapes\n\n" + [
      "export record Disc derives (Eq) = {radius: Int}",
      "export record Bar derives (Eq) = {width: Int}",
      "",
      "honor Show<Disc> =",
      '    show(disc) = "Disc"',
      "",
      "honor Show<Bar> =",
      '    show(bar) = "Bar"',
      "",
      "honor Ord<Disc> =",
      "    compare(a, b) = Ordering.Equal",
      "",
      "honor Ord<Bar> =",
      "    compare(a, b) = Ordering.Less",
      "",
    ].join("\n")] as const;
    // Each spelling the refusal offers is one the next compile accepts: bare
    // `show(…)`, because `show` is the prelude's bare member, but never a bare
    // `compare(…)`, which the member channel refuses (Modules §5.5).
    expect(diagnostics([
      shapes,
      ["/main.hex", "module Main\n\n" + [
        'import Shapes',
        "",
        "export let drawn: String = Shapes.show(Shapes.Disc({radius = 1}))",
        "export let ordered: Ordering = Shapes.compare(Shapes.Bar({width = 1}), Shapes.Bar({width = 2}))",
        "",
      ].join("\n")],
    ])).toEqual([
      "`Shapes.show` is ambiguous: `Shapes` honors a constraint with a member " +
      "`show` at `Disc` and `Bar`; write the dot call on a value of the type you " +
      "mean, `show(…)`, or `Show.show(…)`",
      "`Shapes.compare` is ambiguous: `Shapes` honors a constraint with a member " +
      "`compare` at `Disc` and `Bar`; write the dot call on a value of the type you " +
      "mean, or `Ord.compare(…)`",
    ]);
    const exports = await runProject([
      shapes,
      ["/main.hex", "module Main\n\n" + [
        'import Shapes',
        "",
        "export let dotted: String = Shapes.Disc({radius = 1}).show()",
        "export let bare: String = show(Shapes.Disc({radius = 1}))",
        "export let qualified: String = Show.show(Shapes.Bar({width = 1}))",
        "export let ordered: Ordering = Ord.compare(Shapes.Bar({width = 1}), Shapes.Bar({width = 2}))",
        "",
      ].join("\n")],
    ]);
    expect([exports.dotted, exports.bare, exports.qualified]).toEqual(["Disc", "Disc", "Bar"]);
    expect((exports.ordered as { tag: string }).tag).toBe("Less");
  });

  /**
   * The one-exporter law (Constraints §4.6's last bullet) used to be measured
   * against a *bare* grab: `import { Dial, show } from "./dial"` tried to pull
   * the honored member into the consumer's own bare scope by name, alongside
   * the type, and was refused because `dial.hex` exports no term called
   * `show` — an honor block is not an export, so a named import naming it had
   * nothing to bind.
   *
   * #762 removed the whole channel that test measured: an import binds a
   * module and nothing smaller, so there is no way to *attempt* pulling a
   * bare `show` out of `dial.hex` by name any more, successfully or not — the
   * failure mode is now structurally unreachable rather than refused. What
   * survives is the positive half — qualification reaching the honored member
   * through the module alias — and that is exactly what `Rat.add`, `Int.show`
   * and the ambiguity test above already measure, so no replacement pin is
   * added here; the property has no seat of its own left to hold.
   */
});

describe("duplicate claimants refuse, and never rank (§6, §9 row 6)", () => {
  test("two constraints honored at one type refuse the fused form, naming both homes", () => {
    expect(diagnostics([
      ["/loud.hex", "module Loud\n\n" + [
        "export constraint Loud<a> =",
        "    volume(value: a) -> Int",
        "",
      ].join("\n")],
      ["/soft.hex", "module Soft\n\n" + [
        "export constraint Soft<a> =",
        "    volume(value: a) -> Int",
        "",
      ].join("\n")],
      ["/main.hex", "module Main\n\n" + [
        'import Loud',
        'import Soft',
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
      "`Soft`'s member `volume`; write `Loud.volume(…)` or `Soft.volume(…)`",
    ]);
  });

  test("a binder carrying two same-spelled members refuses on the declared variable", () => {
    expect(diagnostics([
      ["/near.hex", "module Near\n\n" + [
        "export constraint Near<a> =",
        "    reach(value: a) -> Int",
        "",
      ].join("\n")],
      ["/far.hex", "module Far\n\n" + [
        "export constraint Far<a> =",
        "    reach(value: a) -> Int",
        "",
      ].join("\n")],
      ["/main.hex", "module Main\n\n" + [
        'import Near',
        'import Far',
        "",
        "export let span<a: (Near.Near, Far.Far)>(value: a): Int = value.reach()",
        "",
      ].join("\n")],
    ])).toEqual([
      "`reach` after a dot is ambiguous on `a`: `Near`'s member `reach`, `Far`'s " +
      "member `reach`; write `Near.reach(…)` or `Far.reach(…)`",
    ]);
  });

  /**
   * A module cannot name itself, so a claimant whose constraint this module
   * declares has no qualified spelling — the refusal offers the bare one in its
   * place. Written with one local declaration and one namespace-imported: two
   * same-spelled members declared in *one* module collide at the second
   * declaration, so this is the only shape the case has.
   */
  test("a refusal inside the declaring module spells its own claimant bare", () => {
    expect(diagnostics([
      ["/quiet.hex", "module Quiet\n\n" + [
        "export constraint Quiet<a> =",
        "    level(value: a) -> Int",
        "",
      ].join("\n")],
      ["/main.hex", "module Main\n\n" + [
        'import Quiet',
        "",
        "constraint Brash<a> =",
        "    level(value: a) -> Int",
        "",
        "export record Meter = {ticks: Int}",
        "",
        "honor Brash<Meter> =",
        "    level(meter) = meter.ticks",
        "",
        "honor Quiet.Quiet<Meter> =",
        "    level(meter) = 0",
        "",
        "export let reading: Int = Meter({ticks = 5}).level()",
        "",
      ].join("\n")],
    ])).toEqual([
      "`level` after a dot is ambiguous at `Meter`: `Brash`'s member `level`, " +
      "`Quiet`'s member `level`; write `level(…)` or `Quiet.level(…)`",
    ]);
  });

  /**
   * Two member bindings of one spelling in one module, and the bare spelling
   * reaches neither (Constraints §4.6's first and fourth bullets, #757): with
   * no refusal of its own, bare `show` is the prelude's `show`, as in a module
   * that honors nothing, and at `Probe` it selects `Show<Probe>`. `Warm`'s
   * member is reached through its declaring module's qualified spelling.
   *
   * Formerly the bare use was refused here as ambiguous between the two
   * constraints; that refusal existed only because honoring made a member
   * bare, and it went with that reading.
   */
  test("two constraints binding one spelling leave bare `show` the prelude's", async () => {
    const files: readonly (readonly [string, string])[] = [
      ["/warm.hex", "module Warm\n\n" + [
        "export constraint Warm<a> =",
        "    show(value: a) -> String",
        "",
      ].join("\n")],
      ["/main.hex", "module Main\n\n" + [
        'import Warm',
        "",
        "export record Probe = {reading: Int}",
        "",
        "honor Warm<Probe> =",
        '    show(probe) = "warm"',
        "",
        "honor Show<Probe> =",
        '    show(probe) = "shown"',
        "",
        "export let taken: String = show(Probe({reading = 2}))",
        "export let warmed: String = Warm.show(Probe({reading = 2}))",
        "",
      ].join("\n")],
    ];
    expect(diagnostics(files)).toEqual([]);
    const exports = await runProject(files);
    expect(exports.taken).toBe("shown");
    expect(exports.warmed).toBe("warm");
  });

  /**
   * The counter-shape, and the reason the arm above needs one: where the
   * spelling is the module's **own declaration's**, the polymorphic read wins
   * (the note's consequence 4) — there is one denotation, so nothing is
   * ambiguous, and the honor block below binds no second meaning.
   */
  test("a locally declared constraint's own member is not made ambiguous by honoring", async () => {
    const exports = await runMain([
      "module Main",
      "",
      "constraint Brash<a> =",
      "    show(value: a) -> String",
      "",
      "export record Meter = {ticks: Int}",
      "",
      "honor Brash<Meter> =",
      '    show(meter) = "brash"',
      "",
      "honor Show<Meter> =",
      '    show(meter) = "polite"',
      "",
      "export let read: String = show(Meter({ticks = 1}))",
      "",
    ].join("\n"));

    expect(exports.read).toBe("brash");
  });

  test("a visible field and an honored member collide at the fused form", () => {
    expect(projectDiagnostics([
      "module Main",
      "",
      "export record Label = {show: Int}",
      "",
      "honor Show<Label> =",
      '    show(label) = "Label"',
      "",
      "export let printed: String = Label({show = 1}).show()",
      "",
    ].join("\n"))).toEqual([
      "`show` after a dot is ambiguous at `Label`: a field `show`, `Show`'s " +
      "member `show`; write `Show.show(…)`, or `(…​.show)` for the field",
    ]);
  });
});

describe("a sibling's spelling in an honor block, and the knot (§4.6, §4.8)", () => {
  /**
   * Honoring binds no bare name (Constraints §4.6, #757), so a bare sibling
   * call inside an honor block is Modules §5.5's refusal, with the dot and
   * qualified routes in the program's own words — wherever the sibling's honor
   * stands. The order law still holds for every route that reaches the member:
   * the dot rewrite above the `Num` honor is a use of `Num<Ratio>` above its
   * honor, and is refused as one (§4.8).
   */
  test("a bare sibling is the §5.5 refusal, and its dot rewrite above the honor is a use above it", () => {
    const program = (divide: string): string => [
      "module Main",
      "",
      "export record Ratio = {top: Int, bottom: Int}",
      "",
      "honor Frac<Ratio> =",
      `    divide(left, right) = ${divide}`,
      "",
      "honor Num<Ratio> =",
      "    add(left, right) = left",
      "    multiply(left, right) = right",
      "    fromNat(n) = Ratio({top = 0, bottom = 1})",
      "",
    ].join("\n");

    const bare = projectDiagnostics(program("multiply(left, right)"));
    expect(bare).toContain(
      "no bare `multiply`; write `left.multiply(right)` or `Num.multiply(left, right)`",
    );
    expect(bare.some((message) => message.includes("below this use"))).toBe(false);
    expect(projectDiagnostics(program("left.multiply(right)"))).toContain(
      "`Num<Ratio>` is used here, and its honor is declared below it; " +
      "declarations are read top-down — move the honor above this use",
    );
  });

  test("inside one honor group, a bare sibling is still refused, and the dot sees every member (§4.8)", () => {
    const program = (divide: string): string => [
      "module Main",
      "",
      "export record Ratio = {top: Int, bottom: Int}",
      "",
      "honor",
      "    Frac<Ratio> =",
      `        divide(left, right) = ${divide}`,
      "    Num<Ratio> =",
      "        add(left, right) = left",
      "        multiply(left, right) = right",
      "        fromNat(n) = Ratio({top = 0, bottom = 1})",
      "    Signed<Ratio> =",
      "        subtract(left, right) = left",
      "        negate(value) = value",
      "        fromInt(n) = Ratio({top = 0, bottom = 1})",
      "",
      "export let r: Ratio = Ratio({top = 1, bottom = 2}) / Ratio({top = 3, bottom = 4})",
      "",
    ].join("\n");

    expect(projectDiagnostics(program("multiply(left, right)"))).toEqual([
      "no bare `multiply`; write `left.multiply(right)` or `Num.multiply(left, right)`",
    ]);
    expect(projectDiagnostics(program("left.multiply(right)"))).toEqual([]);
  });

  test("the same module reordered: the bare sibling is refused, and its dot rewrite runs", async () => {
    const program = (subtract: string): string => [
      "module Main",
      "",
      "export record Span = {lo: Int, hi: Int}",
      "",
      "honor Num<Span> =",
      "    add(left, right) = Span({lo = left.lo + right.lo, hi = left.hi + right.hi})",
      "    multiply(left, right) = Span({lo = left.lo * right.lo, hi = left.hi * right.hi})",
      "    fromNat(n) = Span({lo = 0, hi = 0})",
      "",
      "honor Signed<Span> =",
      `    subtract(left, right) = ${subtract}`,
      "    negate(value) = value",
      "    fromInt(n) = Span({lo = 0, hi = 0})",
      "",
      "export let joined: Int = Span({lo = 1, hi = 2}).subtract(Span({lo = 3, hi = 4})).hi",
      "",
    ].join("\n");

    expect(projectDiagnostics(program("multiply(left, right)"))).toEqual([
      "no bare `multiply`; write `left.multiply(right)` or `Num.multiply(left, right)`",
    ]);
    // The dot reaches `Num<Span>`'s `multiply`, so `subtract` answers 2 * 4.
    const exports = await runMain(program("left.multiply(right)"));
    expect(exports.joined).toBe(8);
  });
});

describe("what a bare member spelling means in its honoring module (§4.6, #757)", () => {
  /**
   * Honoring binds no bare name: a bare `show` in a module honoring
   * `Show<Crate>` is the prelude's `show`, at every type, exactly as in a
   * module that honors nothing. It answers `Show<Int>` at `42` and the
   * module's own instance at a `Crate`, by ordinary dispatch. (The rejected
   * reading — the member bare and monomorphic at the honored type — would
   * refuse the first line; Constraints §4.6 records why it was not taken.)
   */
  test("a bare `show` is the prelude's at another type and at the honored one", async () => {
    const exports = await runMain([
      "module Main",
      "",
      "export record Crate = {v: Int}",
      "",
      "honor Show<Crate> =",
      '    show(crate) = "Crate"',
      "",
      "export let elsewhere: String = show(42)",
      "export let honored: String = show(Crate({v = 1}))",
      "",
    ].join("\n"));

    expect(exports.elsewhere).toBe("42");
    expect(exports.honored).toBe("Crate");
  });
});

describe("§9 row 8: a field call's row meeting a nominal names the operation", () => {
  /**
   * A parenthesized field call on an untyped parameter is row-polymorphic
   * (§3.6); the contradiction surfaces at a *use*, where a naive "`Int` is not
   * a record" says nothing about why the row exists or what was likely meant.
   * The member clause: `show` is nobody's companion operation.
   */
  test("a row-finalised parameter meeting a nominal is redirected, member clause", () => {
    expect(projectDiagnostics([
      "module Main",
      "",
      "let render(v) = (v.show)()",
      "let counted: Int = 42",
      "export let out: String = render(counted)",
      "",
    ].join("\n"))).toEqual([
      "this value's type was inferred as a record with a `show` field because " +
      "its type was unknown where it was written; `Int` is not a record; " +
      "annotate it to use dispatch, or call `Show.show(…)` directly",
    ]);
  });

  test("the companion clause names the companion, by head and not by display", () => {
    expect(projectDiagnostics([
      "module Main",
      "",
      "let measure(v) = (v.length)()",
      "let items: Vector(Int) = [1, 2]",
      "export let out: Int = measure(items)",
      "",
    ].join("\n"))).toEqual([
      "this value's type was inferred as a record with a `length` field because " +
      "its type was unknown where it was written; `Vector(Int)` is not a record; " +
      "annotate it to use dispatch, or call `Vector.length(…)` directly",
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
      "module Main",
      "",
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
      "module Main",
      "",
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
