import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runMain, runProject } from "../support/test-project.js";

/**
 * PR β of #335: **every** shipped constraint is declared by a `.hex` module in
 * the prelude, so every member is an export in bare scope
 * (`spec/notes/constraint-members-are-values.md` §6 step 3). The pilot proved
 * the mechanism on `Show`; this file measures what the other nine buy.
 *
 * The headline is the note's §4 second bullet: a generic `compare`, a generic
 * `equals`, a generic `div` — spellings that had **no** form at all before,
 * neither bare nor piped nor qualified nor dot-called. Method Syntax §9 row 6
 * has been telling users to "call it directly: `compare(x, y)`" the whole time.
 *
 * Everything here executes. A member that compiles and dispatches to the wrong
 * instance is the failure mode this arc is most exposed to, and only running
 * the emitted JavaScript sees it.
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

describe("the control: diagnostics are project-level, so prove the probe can fail", () => {
  test("an unknown name is still refused", () => {
    expect(projectDiagnostics("export let r: Bool = equalz(1, 1)\n"))
      .toEqual(["unknown name `equalz`"]);
  });
});

describe("generic member calls exist (the note's §4: previously unspellable)", () => {
  test("a generic `compare` — Method Syntax §9 row 6's promise, discharged", async () => {
    const exports = await runMain([
      "export let ordering<a: Ord>(left: a, right: a): Ordering = compare(left, right)",
      "",
      "export let ints: String = \"${ordering(1, 2)}\"",
      "export let texts: String = \"${ordering(\"b\", \"a\")}\"",
      "export let bools: String = \"${ordering(False, False)}\"",
      "",
    ].join("\n"));

    expect(exports.ints).toBe("Less");
    expect(exports.texts).toBe("Greater");
    expect(exports.bools).toBe("Equal");
  });

  test("a generic `equals`, dispatching per instantiation", async () => {
    const exports = await runMain([
      "export let same<a: Eq>(left: a, right: a): Bool = equals(left, right)",
      "",
      "export let onInts: Bool = same(3, 3)",
      "export let onText: Bool = same(\"a\", \"b\")",
      "",
    ].join("\n"));

    expect(exports.onInts).toBe(true);
    expect(exports.onText).toBe(false);
  });

  /**
   * `Integral`'s members had no spelling in *any* form before this: the
   * constraint was pre-registered by name only, so `div` was reachable at a
   * concrete type through the `Int.div` guard and nowhere else. The Euclidean
   * answer is what distinguishes it from `quot` — `-7 div 2` is `-4` (the
   * remainder is non-negative unconditionally), `-7 quot 2` is `-3`.
   */
  test("a generic `div` and `quot`, with the Euclidean/truncated split visible", async () => {
    const exports = await runMain([
      "export let euclidean<a: Integral>(left: a, right: a): a = div(left, right)",
      "export let truncated<a: Integral>(left: a, right: a): a = quot(left, right)",
      "",
      "export let downInt: Int = euclidean(-7, 2)",
      "export let towardZeroInt: Int = truncated(-7, 2)",
      "export let downBig: BigInt = euclidean(-7n, 2n)",
      "export let towardZeroBig: BigInt = truncated(-7n, 2n)",
      "",
    ].join("\n"));

    expect(exports.downInt).toBe(-4);
    expect(exports.towardZeroInt).toBe(-3);
    expect(exports.downBig).toBe(-4n);
    expect(exports.towardZeroBig).toBe(-3n);
  });

  test("bare `hash`, in pipe and higher-order position as well as applied", async () => {
    const exports = await runMain([
      "export let applied: Int = hash(42)",
      "export let piped: Int = 42 |> hash",
      "",
      "export let ones: Int = hash(1)",
      "export let twos: Int = hash(2)",
      "export let threes: Int = hash(3)",
      "export let mapped: Vector(Int) = Vector.fromSeq([1, 2, 3].toSeq().map(hash))",
      "",
    ].join("\n"));

    // Pipe is the same value applied, and mapping it is the same value again:
    // one polymorphic member, instantiated per use, with no second access
    // system for the higher-order case (note consequence 2).
    expect(exports.piped).toBe(exports.applied);
    expect([...(exports.mapped as Iterable<number>)])
      .toEqual([exports.ones, exports.twos, exports.threes]);
    expect(new Set([exports.ones, exports.twos, exports.threes]).size).toBe(3);
  });
});

describe("qualified access to a declaring module (ordinary access to an export)", () => {
  test("`Eq.equals`, `Ord.compare`, `Num.add`, `Hash.hash`, `Integral.gcd`", async () => {
    const exports = await runMain([
      "export let equal: Bool = Eq.equals(1, 1)",
      "export let unequal: Bool = Eq.notEquals(1, 2)",
      "export let ordered: String = \"${Ord.compare(1, 2)}\"",
      "export let summed: Int = Num.add(1, 2)",
      "export let hashed: Bool = Hash.hash(1) == hash(1)",
      "export let divisor: BigInt = Integral.gcd(12n, 8n)",
      "export let joined: String = Concat.concat(\"a\", \"b\")",
      "",
    ].join("\n"));

    expect(exports.equal).toBe(true);
    expect(exports.unequal).toBe(true);
    expect(exports.ordered).toBe("Less");
    expect(exports.summed).toBe(3);
    expect(exports.hashed).toBe(true);
    expect(exports.divisor).toBe(4n);
    expect(exports.joined).toBe("ab");
  });
});

describe("`Eq`'s defaulted `notEquals` (Constraints §2's first default)", () => {
  test("an instance that omits it inherits the negation, bare and through `!=`", async () => {
    const exports = await runMain([
      "export record Odd = {n: Int}",
      "",
      "honor Eq<Odd> =",
      "    equals(left, right) = left.n == right.n",
      "",
      "export let differ: Bool = notEquals(Odd({n = 1}), Odd({n = 2}))",
      "export let agree: Bool = notEquals(Odd({n = 1}), Odd({n = 1}))",
      "export let viaOperator: Bool = Odd({n = 1}) != Odd({n = 2})",
      "",
    ].join("\n"));

    expect(exports.differ).toBe(true);
    expect(exports.agree).toBe(false);
    expect(exports.viaOperator).toBe(true);
  });

  /**
   * *How* the inheritance is emitted, not just that it answers — because the
   * two are separable, and running the program does not tell them apart.
   *
   * Constraints §6.5 gives an exported declaration's default a **hoisted
   * helper**: the home module emits one `__default_<member>` function and
   * every inheriting instance fills its slot by reference to it, importing the
   * helper through the constraint's import item. A prelude declaration has no
   * such item — the synthesized prelude import deliberately carries no
   * constraints (#153) — so the reference has no route and the checker keeps
   * prelude defaults out of that fork entirely, leaving the emitter's wired-in
   * completion to answer them (`#reachableConstraintHelpers`).
   *
   * Without that gate the instance literal carries **both**: a `notEquals` key
   * calling an unbound `__default…`, and the wired-in `notEquals` key
   * beside it. It is a duplicate JavaScript key, so which one survives is
   * decided by emission order — at this shape the wired one happens to come
   * last and win, leaving the broken reference dangling and harmless, and at
   * other shapes it does not and the call throws a `ReferenceError`. A
   * behavioural pin therefore cannot see this: it has to read the text.
   */
  test("the inherited default emits no reference to a helper that cannot travel", () => {
    const project = compileMain([
      "export record Pair = {n: Int}",
      "",
      "honor Eq<Pair> =",
      "    equals(left, right) = left.n == right.n",
      "",
      "export let differ: Bool = notEquals(Pair({n = 1}), Pair({n = 2}))",
      "",
    ].join("\n"));

    expect(project.diagnostics).toEqual([]);
    const text = project.modules
      .find(({ source }) => source.path === "/main.hex")!.javascript.text;

    expect(text).not.toContain("__default");
    // One key, not two: a duplicate is a silent shadow, not a syntax error.
    expect(text.match(/notEquals:/gu) ?? []).toHaveLength(1);
  });

  /**
   * The override door §2 opens for efficiency. It is deliberately spelled here
   * as a *law-breaking* override, because that is the only override whose
   * effect is observable: if the completion still fired, the answers below
   * would be the negation instead.
   */
  test("an override is honored, bare and through `!=`", async () => {
    const exports = await runMain([
      "export record Weird = {n: Int}",
      "",
      "honor Eq<Weird> =",
      "    equals(left, right) = left.n == right.n",
      "    notEquals(left, right) = False",
      "",
      "export let bare: Bool = notEquals(Weird({n = 1}), Weird({n = 2}))",
      "export let viaOperator: Bool = Weird({n = 1}) != Weird({n = 2})",
      "",
    ].join("\n"));

    expect(exports.bare).toBe(false);
    expect(exports.viaOperator).toBe(false);
  });
});

/**
 * The accepted collision. `Concat.hex` exports the member `concat` and
 * `Seq.hex` exports the function `concat`, so a consumer's bare `concat` has
 * two prelude exporters and takes Modules §5.5's refusal — the same law the
 * prelude already applies to any name two of its members export, with no
 * constraint-specific machinery and no renaming.
 */
describe("`concat` has two prelude exporters (Modules §5.5, accepted)", () => {
  test("the bare name is refused, naming both qualified homes", () => {
    expect(projectDiagnostics("export let r: String = concat(\"a\", \"b\")\n")).toEqual([
      "the prelude name `concat` is ambiguous: exported by `Concat` and `Seq`; " +
        "write `Concat.concat` or `Seq.concat`",
    ]);
  });

  test("both qualified spellings work, and dot call is untouched", async () => {
    const exports = await runMain([
      "let left: Seq(Int) = [1, 2].toSeq()",
      "let right: Seq(Int) = [3].toSeq()",
      "",
      "export let qualifiedSeq: Vector(Int) = Vector.fromSeq(Seq.concat(left, right))",
      "export let dotCall: Vector(Int) = Vector.fromSeq(left.concat(right))",
      "export let qualifiedMember: String = Concat.concat(\"a\", \"b\")",
      "export let viaOperator: String = \"a\" ++ \"b\"",
      "",
    ].join("\n"));

    expect([...(exports.qualifiedSeq as Iterable<number>)]).toEqual([1, 2, 3]);
    expect([...(exports.dotCall as Iterable<number>)]).toEqual([1, 2, 3]);
    expect(exports.qualifiedMember).toBe("ab");
    expect(exports.viaOperator).toBe("ab");
  });
});

describe("`Integral` is a held declaration now, not a name", () => {
  test("a module-level redeclaration is refused as a pre-registered twin", () => {
    expect(projectDiagnostics([
      "constraint Integral<a: (Num, Ord)> =",
      "    div(left: a, right: a): a",
      "",
    ].join("\n"))).toEqual([
      "constraint `Integral` is pre-registered and cannot be redeclared",
    ]);
  });

  /**
   * Intrinsics §9.2's transitional guard is on its own schedule and is not
   * retired here; the polymorphic spelling coexists with it, and both give the
   * Euclidean answer (note §5 item 10).
   */
  test("the `Int.div` guard spelling still works beside the member", async () => {
    const exports = await runMain([
      "export let guarded: Int = Int.div(-7, 2)",
      "export let member: Int = div(-7, 2)",
      "export let qualified: Int = Integral.div(-7, 2)",
      "",
    ].join("\n"));

    expect(exports.guarded).toBe(-4);
    expect(exports.member).toBe(-4);
    expect(exports.qualified).toBe(-4);
  });
});

describe("`Hash` stays derivable-only with its declaration in view", () => {
  /**
   * The refusal is checked *before* the declaration lookup, so making `Hash`'s
   * declaration visible could not have weakened it — but "could not have" is
   * the kind of claim this arc has been wrong about before, so it is measured.
   */
  test("a hand-written `honor Hash<T>` is refused with the derivable-only diagnostic", () => {
    expect(projectDiagnostics([
      "export record Point = {x: Int}",
      "",
      "honor Hash<Point> =",
      "    hash(value) = value.x",
      "",
    ].join("\n"))).toEqual([
      "`Hash` instances cannot be hand-written; use `derives Hash` on the " +
        "declaration of the subject type",
    ]);
  });

  test("and a derived one still answers", async () => {
    const exports = await runMain([
      "export record Point derives (Eq, Hash) = {x: Int}",
      "",
      "export let stable: Bool = hash(Point({x = 1})) == hash(Point({x = 1}))",
      "export let distinct: Bool = hash(Point({x = 1})) == hash(Point({x = 2}))",
      "",
    ].join("\n"));

    expect(exports.stable).toBe(true);
    expect(exports.distinct).toBe(false);
  });
});

/**
 * `Rat.hex` is the migration's worked example (note §5 item 7). Its
 * `add`/`subtract`/`multiply`/`divide`/`negate` used to be module-level exports
 * that the honor blocks delegated to — a pattern consequence 3 makes ill-formed
 * — so the bodies moved into the blocks and the shims are gone. Every consumer
 * spelling that worked before still works, which is the point of measuring it
 * rather than reasoning about it.
 */
describe("Rat after the fold-in", () => {
  const project = [
    ["/main.hex", [
      "import * as Rat from \"./Rat\"",
      "",
      "let half: Rat.Rat = Rat.create(1n, 2n)",
      "let third: Rat.Rat = Rat.create(1n, 3n)",
      "",
      "export let sum: String = \"${half + third}\"",
      "export let difference: String = \"${half - third}\"",
      "export let product: String = \"${half * third}\"",
      "export let quotient: String = \"${half / third}\"",
      "export let negated: String = \"${-half}\"",
      "export let ordered: Bool = third < half",
      "export let interpolated: String = \"${half}\"",
      "export let reciprocal: String = \"${Rat.reciprocal(third)}\"",
      "",
    ].join("\n")],
    ["/Rat.hex", stdlib("Rat.hex")],
  ] as const;

  test("every operator face still computes", async () => {
    const exports = await runProject(project);

    expect(exports.sum).toBe("5/6");
    expect(exports.difference).toBe("1/6");
    expect(exports.product).toBe("1/6");
    expect(exports.quotient).toBe("3/2");
    expect(exports.negated).toBe("-1/2");
    expect(exports.ordered).toBe(true);
    expect(exports.interpolated).toBe("1/2");
    expect(exports.reciprocal).toBe("3/1");
  });

  test("`divide`'s zero check moved with its body", async () => {
    const exports = await runProject([
      ["/main.hex", [
        "import * as Rat from \"./Rat\"",
        "",
        "export fun attempt(): String =",
        "    \"${Rat.create(1n, 2n) / Rat.create(0n, 5n)}\"",
        "",
      ].join("\n")],
      ["/Rat.hex", stdlib("Rat.hex")],
    ]);

    expect(exports.attempt as () => string).toThrowError(
      expect.objectContaining({
        name: "DivideByZeroError",
        message: "Rat.divide: divisor is zero",
      }),
    );
  });

  /**
   * `Num.add`, not the bare `add` this test's name was written for: since #373
   * `stdlib/Set.hex` exports `add`, so the bare spelling is a collided prelude
   * name and Modules §5.5 refuses it in favour of the qualified home. What is
   * being tested survives the change whole — the route from a *prelude export*
   * of the member to the instance honored in another module — because the
   * qualified spelling reaches the same export the bare one did.
   */
  test("`Num.add` at `Rat` reaches the honored member through the prelude export", async () => {
    const exports = await runProject([
      ["/main.hex", [
        "import * as Rat from \"./Rat\"",
        "",
        "export let bare: String =",
        "    \"${Num.add(Rat.create(1n, 2n), Rat.create(1n, 3n))}\"",
        "export let generic<a: Num>(left: a, right: a): a = Num.add(left, right)",
        "export let throughGeneric: String =",
        "    \"${generic(Rat.create(1n, 2n), Rat.create(1n, 3n))}\"",
        "",
      ].join("\n")],
      ["/Rat.hex", stdlib("Rat.hex")],
    ]);

    expect(exports.bare).toBe("5/6");
    expect(exports.throughGeneric).toBe("5/6");
  });
});
