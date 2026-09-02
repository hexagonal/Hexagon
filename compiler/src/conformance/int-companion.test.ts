import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, projectDiagnostics, runMain, runProject } from "../support/test-project.js";

/**
 * PR δ2 of #344: **`Int` is a source companion.** `stdlib/Int.hex` is the
 * primitive's home module (Constraints §5.3), its eight instances are ordinary
 * `honor` blocks, the checked family of Primitive Types §2.1 are its plain
 * exports, and the compiler's wired `Int` rows — the instance table, the
 * `PrimitiveOperation` door, the `__int*` helper family, and
 * `__checkedPower` — all retired in the same change.
 *
 * `Int` is the workhorse: every bare integer literal defaults to it, so almost
 * nothing in the language is untouched by this move. **Everything that can run,
 * runs.** The failure mode is a clean compile whose JavaScript computes a
 * different answer than it did before — a guard lost with the helper that
 * carried it, an instance selected from a table that should have been empty, a
 * pre-check that rounds before it can see the overflow it is checking for. Only
 * executing the emitted module sees any of that.
 *
 * The programs are deliberately byte-distinct from one another: two conformance
 * modules whose emitted JavaScript is identical share one instance through the
 * ESM data-URL cache, and a pin that silently measures its neighbour's module is
 * a pin that cannot fail.
 */

/** `/main.hex`'s emitted JavaScript, which must have compiled cleanly. */
function emitted(source: string): string {
  const project = compileMain(source);
  expect(project.diagnostics).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
}

/** `stdlib/Int.hex`'s emitted JavaScript, as the prelude compiled it. */
function companion(source: string): string {
  const project = compileMain(source);
  expect(project.diagnostics).toEqual([]);
  return project.modules
    .find(({ source: file }) => file.path.endsWith("/Int.hex"))!.javascript.text;
}

/** Every diagnostic message a multi-module project produced, in order. */
function diagnostics(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

/** What a thunk threw, or `undefined` if it returned. */
function threw(run: () => unknown): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("the control: diagnostics are project-level, so prove the probe can fail", () => {
  test("an unknown name is still refused", () => {
    expect(projectDiagnostics("export let r: Bool = equalz(1, 1)\n"))
      .toEqual(["unknown name `equalz`"]);
  });
});

describe("the four spellings are one implementation", () => {
  /**
   * The qualified spelling, the dot call, the bare member under a written bound,
   * and the generic route all reach the same member of the same instance. This
   * is what the migration had to preserve exactly: before #344 three of these
   * four were a compiler row rather than a member at all.
   */
  test("`div` agrees qualified, after a dot, and under a bound", async () => {
    const exports = await runMain([
      "export let qualified: Int = Int.div(-7, 2)",
      "export let dotted: Int = (-7).div(2)",
      "export let bound<a: Integral>(left: a, right: a): a = Integral.div(left, right)",
      "export let generic: Int = bound(-7, 2)",
      "",
    ].join("\n"));

    expect(exports["qualified"]).toBe(-4);
    expect(exports["dotted"]).toBe(-4);
    expect(exports["generic"]).toBe(-4);
  });
});

describe("Division & Remainder §2's table, executed at `Int`", () => {
  /**
   * The whole sign matrix, in one program. `div`/`mod` are Euclidean — the
   * remainder is never negative — and `quot`/`rem` are truncated, the remainder
   * taking the sign of the dividend. The two conventions agree only when both
   * operands are non-negative, which is why every sign pair is here.
   */
  test("Euclidean and truncated agree only where §2 says they do", async () => {
    const exports = await runMain([
      "export let quotients: Vector(Int) = [",
      "    Int.div(7, 2), Int.div(-7, 2), Int.div(7, -2), Int.div(-7, -2)]",
      "export let remainders: Vector(Int) = [",
      "    Int.mod(7, 2), Int.mod(-7, 2), Int.mod(7, -2), Int.mod(-7, -2)]",
      "export let truncated: Vector(Int) = [",
      "    Int.quot(7, 2), Int.quot(-7, 2), Int.quot(7, -2), Int.quot(-7, -2)]",
      "export let stumps: Vector(Int) = [",
      "    Int.rem(7, 2), Int.rem(-7, 2), Int.rem(7, -2), Int.rem(-7, -2)]",
      "",
    ].join("\n"));

    expect([...(exports["quotients"] as Iterable<unknown>)]).toEqual([3, -4, -3, 4]);
    expect([...(exports["remainders"] as Iterable<unknown>)]).toEqual([1, 1, 1, 1]);
    expect([...(exports["truncated"] as Iterable<unknown>)]).toEqual([3, -3, -3, 3]);
    expect([...(exports["stumps"] as Iterable<unknown>)]).toEqual([1, -1, 1, -1]);
  });

  /** §2's identity, which is what makes the Euclidean pair a *pair*. */
  test("`div(l, r) * r + mod(l, r) == l` at every sign", async () => {
    const exports = await runMain([
      "let holds(left: Int, right: Int): Bool =",
      "    Int.div(left, right) * right + Int.mod(left, right) == left",
      "export let identities: Vector(Bool) = [",
      "    holds(9, 4), holds(-9, 4), holds(9, -4), holds(-9, -4), holds(0, 5)]",
      "",
    ].join("\n"));

    expect([...(exports["identities"] as Iterable<unknown>)]).toEqual([true, true, true, true, true]);
  });
});

describe("the guards moved into source and kept their names", () => {
  /**
   * Every zero-divisor guard is Hexagon in `stdlib/Int.hex` now, throwing
   * `stdlib/Integral.hex`'s declared exception. Each names *its own* member, so
   * the message identifies the operation that threw — which is what the
   * declaration's doc comment promises, and what a shared helper could not do.
   */
  test("each member throws `DivideByZeroError` naming itself", async () => {
    const exports = await runMain([
      "export let byDiv(): Int = Int.div(1, 0)",
      "export let byMod(): Int = Int.mod(2, 0)",
      "export let byQuot(): Int = Int.quot(3, 0)",
      "export let byRem(): Int = Int.rem(4, 0)",
      "",
    ].join("\n"));

    const messages = ["div", "mod", "quot", "rem"].map((member) => {
      const name = `by${member[0]!.toUpperCase()}${member.slice(1)}`;
      const error = threw(exports[name] as () => unknown) as Error;
      expect(error.name).toBe("DivideByZeroError");
      return error.message;
    });

    expect(messages).toEqual([
      "Int.div: divisor is zero",
      "Int.mod: divisor is zero",
      "Int.quot: divisor is zero",
      "Int.rem: divisor is zero",
    ]);
  });

  /**
   * The throw is `$hex`-branded, which is how a Hexagon `catch` recognizes it as
   * one of its own rather than as a host error (FFI Part 3). The retired helper
   * built its `Error` by hand and never carried the brand.
   *
   * The obvious stronger case — a `catch DivideByZeroError(message) =>` clause —
   * cannot be written yet: a *prelude-declared* exception constructor is not in
   * scope in a `catch` pattern, which is #345 and is the same at `BigInt`
   * (measured on the pre-#344 compiler, so it is neither this change's doing nor
   * this change's to fix).
   */
  test("the throw carries the Hexagon exception brand", async () => {
    const exports = await runMain([
      "export let branded(): Int = Int.quot(5, 0)",
      "",
    ].join("\n"));

    expect(threw(exports["branded"] as () => unknown))
      .toMatchObject({ name: "DivideByZeroError", $hex: "Integral" });
  });

  /** A generic body reaching the member gets the guard with it. */
  test("the guard travels through a dictionary, not only through the qualified call", async () => {
    const exports = await runMain([
      "let halve<a: Integral>(value: a, by: a): a = Integral.div(value, by)",
      "export let fine: Int = halve(84, 2)",
      "export let boom(): Int = halve(84, 0)",
      "",
    ].join("\n"));

    expect(exports["fine"]).toBe(42);
    expect(threw(exports["boom"] as () => unknown))
      .toMatchObject({ name: "DivideByZeroError", message: "Int.div: divisor is zero" });
  });
});

describe("Integral §4's `gcd` laws", () => {
  test("`gcd` is non-negative, sign-insensitive, and absorbs zero", async () => {
    const exports = await runMain([
      "export let divisors: Vector(Int) = [",
      "    Int.gcd(0, 0), Int.gcd(-12, 0), Int.gcd(0, -12), Int.gcd(12, 18),",
      "    Int.gcd(-12, 18), Int.gcd(12, -18), Int.gcd(-12, -18), Int.gcd(17, 5)]",
      "",
    ].join("\n"));

    expect([...(exports["divisors"] as Iterable<unknown>)])
      .toEqual([0, 12, 12, 6, 6, 6, 6, 1]);
  });

  /**
   * §4's own note: `gcd` never reaches a zero divisor, however it is called —
   * the loop's exit condition is exactly the case its `rem` could fault on.
   */
  test("`gcd(0, 0)` returns rather than throwing", async () => {
    const exports = await runMain([
      "export let safe(): Int = Int.gcd(0, 0)",
      "export let alsoSafe(): Int = Int.gcd(0, 7)",
      "",
    ].join("\n"));

    expect(threw(exports["safe"] as () => unknown)).toBeUndefined();
    expect((exports["alsoSafe"] as () => unknown)()).toBe(7);
  });
});

describe("Primitive Types §2.1's checked family", () => {
  /**
   * The boundary table, cross-checked against `BigInt` **inside the program**.
   * Nothing here trusts this file's arithmetic: each case computes the exact
   * answer at `BigInt`, where there is no boundary, and compares it against the
   * limit — so the expectations below are `true` and `false` rather than
   * numbers a reviewer would have to verify by hand.
   */
  test("the pre-checks agree with exact `BigInt` arithmetic", async () => {
    const exports = await runMain([
      "let limit: Int = 9_007_199_254_740_991",
      "let exactlyFits(left: Int, right: Int): Bool =",
      "    let product = BigInt.fromInt(left) * BigInt.fromInt(right)",
      "    let bound = BigInt.fromInt(limit)",
      "    product <= bound and product >= -bound",
      "let sumFits(left: Int, right: Int): Bool =",
      "    let total = BigInt.fromInt(left) + BigInt.fromInt(right)",
      "    let bound = BigInt.fromInt(limit)",
      "    total <= bound and total >= -bound",
      "let answered(result: Option(Int)): Bool =",
      "    match result",
      "        Some(_) => True",
      "        None => False",
      "// Each pair asks the checked member and the exact `BigInt` computation the",
      "// same question, so a disagreement is a failure whichever one is wrong.",
      "export let products: Vector(Bool) = [",
      "    answered(Int.checkedMul(0, limit)) == exactlyFits(0, limit),",
      "    answered(Int.checkedMul(limit, 1)) == exactlyFits(limit, 1),",
      "    answered(Int.checkedMul(94906266, 94906266)) == exactlyFits(94906266, 94906266),",
      "    answered(Int.checkedMul(94906265, 94906266)) == exactlyFits(94906265, 94906266),",
      "    answered(Int.checkedMul(67108864, 134217728)) == exactlyFits(67108864, 134217728),",
      "    answered(Int.checkedMul(3, -4)) == exactlyFits(3, -4),",
      "    answered(Int.checkedMul(-3, -4)) == exactlyFits(-3, -4)]",
      "export let sums: Vector(Bool) = [",
      "    answered(Int.checkedAdd(limit, 0)) == sumFits(limit, 0),",
      "    answered(Int.checkedAdd(limit, 1)) == sumFits(limit, 1),",
      "    answered(Int.checkedAdd(-limit, -1)) == sumFits(-limit, -1),",
      "    answered(Int.checkedAdd(-limit, 1)) == sumFits(-limit, 1)]",
      "",
    ].join("\n"));

    expect([...(exports["products"] as Iterable<unknown>)])
      .toEqual([true, true, true, true, true, true, true]);
    expect([...(exports["sums"] as Iterable<unknown>)]).toEqual([true, true, true, true]);
  });

  /**
   * The same boundary read as values rather than as agreement, so a reader can
   * see where the edge is. `94906266^2` is the first square past the limit, and
   * `2^26 * 2^27` is the limit plus one exactly.
   */
  test("the answers themselves, at and either side of the edge", async () => {
    const exports = await runMain([
      "let limit: Int = 9_007_199_254_740_991",
      "let orZero(result: Option(Int)): Int =",
      "    match result",
      "        Some(value) => value",
      "        None => 0",
      "let overflowed(result: Option(Int)): Bool =",
      "    match result",
      "        Some(_) => False",
      "        None => True",
      "export let edge: Vector(Bool) = [",
      "    overflowed(Int.checkedMul(94906265, 94906266)),",
      "    overflowed(Int.checkedMul(94906266, 94906266)),",
      "    overflowed(Int.checkedMul(67108864, 134217728)),",
      "    overflowed(Int.checkedAdd(limit, 1)),",
      "    overflowed(Int.checkedAdd(limit, 0)),",
      "// A zero *right* operand answers through the zero arm, never through the",
      "// magnitude compare — `quot(limit, 0)` would throw, and a left-zero case",
      "// cannot prove the arm exists because the compare also answers it.",
      "    overflowed(Int.checkedMul(limit, 0)),",
      "    overflowed(Int.checkedMul(0, 0))]",
      "export let values: Vector(Int) = [",
      "    orZero(Int.checkedMul(0, limit)), orZero(Int.checkedMul(3, -4)),",
      "    orZero(Int.checkedMul(-3, -4)), orZero(Int.checkedAdd(limit, 0)),",
      "    orZero(Int.checkedAdd(-limit, 1))]",
      "",
    ].join("\n"));

    expect([...(exports["edge"] as Iterable<unknown>)])
      .toEqual([false, true, true, true, false, false, false]);
    expect([...(exports["values"] as Iterable<unknown>)])
      .toEqual([0, -12, 12, 9007199254740991, -9007199254740990]);
  });

  /**
   * `checkedSub` negates its right operand and hands the result to
   * `checkedAdd`, which is total only because the safe range is symmetric — so
   * both extremes of that range are exercised as the *right* operand.
   */
  test("`checkedSub` reaches both ends of the symmetric range", async () => {
    const exports = await runMain([
      "let limit: Int = 9_007_199_254_740_991",
      "let orZero(result: Option(Int)): Int =",
      "    match result",
      "        Some(value) => value",
      "        None => 0",
      "let refused(result: Option(Int)): Bool =",
      "    match result",
      "        Some(_) => False",
      "        None => True",
      "export let outcomes: Vector(Bool) = [",
      "    refused(Int.checkedSub(0, -limit)), refused(Int.checkedSub(0, limit)),",
      "    refused(Int.checkedSub(1, -limit)), refused(Int.checkedSub(-1, limit)),",
      "    refused(Int.checkedSub(10, 4))]",
      "export let differences: Vector(Int) = [",
      "    orZero(Int.checkedSub(0, -limit)), orZero(Int.checkedSub(0, limit)),",
      "    orZero(Int.checkedSub(10, 4)), orZero(Int.checkedSub(-10, -4))]",
      "",
    ].join("\n"));

    expect([...(exports["outcomes"] as Iterable<unknown>)])
      .toEqual([false, false, true, true, false]);
    expect([...(exports["differences"] as Iterable<unknown>)])
      .toEqual([9007199254740991, -9007199254740991, 6, -6]);
  });

  /** The type is what §2.1 declares, and a caller may destructure it. */
  test("the checked family answers `Option(Int)`, used as one", async () => {
    const exports = await runMain([
      "export let described: String =",
      "    match Int.checkedAdd(20, 22)",
      "        Some(total) => \"total ${total}\"",
      "        None => \"overflow\"",
      "",
    ].join("\n"));

    expect(exports["described"]).toBe("total 42");
  });
});

describe("`pow` and its guard", () => {
  /**
   * The guard is Hexagon in the companion now, above a door binding that is the
   * raw `**`. The exception is `stdlib/Pow.hex`'s declaration, so it is
   * `$hex`-branded and catchable by name — which the retired `checkedPower`
   * helper's hand-built error was not.
   */
  test("a negative exponent throws `NegativeExponentError`", async () => {
    const exports = await runMain([
      "export let eight: Int = 2 ** 3",
      "export let boom(): Int = 2 ** -3",
      "export let alsoBoom(): Int = 5 ** -1",
      "",
    ].join("\n"));

    expect(exports["eight"]).toBe(8);
    expect(threw(exports["boom"] as () => unknown)).toMatchObject({
      name: "NegativeExponentError",
      message: "an integer exponent cannot be negative",
      $hex: "Pow",
    });
    expect(threw(exports["alsoBoom"] as () => unknown))
      .toMatchObject({ name: "NegativeExponentError" });
  });

  /**
   * The deliberate emission change, pinned. `**` at `Int` no longer inlines: it
   * is the companion's guarded member through the imported dictionary, because
   * inlining `a ** b` here would reinstate the retired unguarded implementation
   * beside the source one.
   */
  test("`**` at `Int` emits as the member call, not as the operator", () => {
    const text = emitted("export let raised: Int = 2 ** 5\n");

    expect(text).toContain("__Pow_Int.pow(2, 5)");
    expect(text).not.toContain("__checkedPower");
    expect(text).not.toContain("2 ** 5");
  });
});

describe("the wired rows are gone, not dormant", () => {
  /**
   * `Int` left the primitive-operation guard (`spec/intrinsics.md` §9.2), so
   * nothing in a consumer's output carries the retired helper family — the
   * division bodies live in `stdlib/Int.hex` and reach the consumer as imports.
   * A row that merely stopped being *selected* would still be emitted the
   * moment something reached it.
   */
  test("no `__int*` helper and no `__checkedPower` survive", () => {
    const text = emitted([
      "export let a: Int = Int.div(9, 4)",
      "export let b: Int = Int.gcd(9, 6)",
      "export let c: Int = Int.quot(9, 4)",
      "export let d: Int = 3 ** 4",
      "",
    ].join("\n"));

    expect(text).not.toContain("__int");
    expect(text).not.toContain("__checkedPower");
    expect(text).toContain('from "./Int.js"');
  });

  /**
   * And there is no other direction left to check: `Float` was the last owner
   * of the `PrimitiveOperation` family, and it left at its own milestone, so
   * `Float.mod` and `Float.rem` are `stdlib/Float.hex`'s plain exports reached
   * by import — the two helpers that carried them are gone with the family.
   */
  test("`Float`'s two are exports of its companion, not helpers", () => {
    const text = emitted([
      "export let a: Float = Float.mod(-7.0, 3.0)",
      "export let b: Float = Float.rem(-7.0, 3.0)",
      "",
    ].join("\n"));

    expect(text).not.toContain("__floatMod");
    expect(text).not.toContain("__floatRem");
    expect(text).toContain('from "./Float.js"');
  });

  /**
   * Integral §8's diagnostics row, which had to survive the re-homing: the
   * spelling now misses as an ordinary does-not-export at a real module, and
   * the curated sentence that says *why* travels with it.
   */
  test("`Int.lcm` misses with its curated hint, not a bare does-not-export", () => {
    expect(projectDiagnostics("export let m: Int = Int.lcm(4, 6)\n")).toEqual([
      "`Int` has no `lcm` — its results overflow `Int`'s safe range for ordinary " +
        "inputs; use `BigInt.lcm`",
    ]);
  });
});

describe("Constraints §6.1's inlining survives the move", () => {
  /**
   * The selection is the source instance's either way; the monomorphic tables
   * render that one selection as the JavaScript operator rather than as a slot
   * read. Byte-stability here is the whole readable-JavaScript goal: `x + y`
   * must not become a dictionary call because its instance changed address.
   */
  test("arithmetic, comparison, and interpolation still emit as operators", () => {
    const text = emitted([
      "export let sum: Int = 20 + 22",
      "export let product: Int = 6 * 7",
      "export let difference: Int = 50 - 8",
      "export let opposite: Int = -42",
      "export let ordered: Bool = 1 < 2",
      "export let identical: Bool = 1 == 1",
      'export let rendered: String = "${43}"',
      "",
    ].join("\n"));

    expect(text).toContain("const sum = 20 + 22;");
    expect(text).toContain("const product = 6 * 7;");
    expect(text).toContain("const difference = 50 - 8;");
    expect(text).toContain("const opposite = -42;");
    expect(text).toContain("const ordered = 1 < 2;");
    expect(text).toContain("const identical = 1 === 1;");
    expect(text).toContain("const rendered = String(43);");
  });

  /** And computes what it always did. */
  test("the same operators still compute their answers", async () => {
    const exports = await runMain([
      "export let sum: Int = 19 + 23",
      "export let ordered: Bool = 100 <= 100",
      'export let rendered: String = "n=${-7}"',
      "export let shown: String = show(44)",
      "export let dotted: String = 45.show()",
      "",
    ].join("\n"));

    expect(exports["sum"]).toBe(42);
    expect(exports["ordered"]).toBe(true);
    expect(exports["rendered"]).toBe("n=-7");
    expect(exports["shown"]).toBe("44");
    expect(exports["dotted"]).toBe("45");
  });
});

describe("the keyless self-identity", () => {
  /**
   * `Signed<Int>`'s `fromInt` converts `Int` to itself, so its body is the
   * plain binding `value` — ordinary Hexagon, no door key. Reached as the
   * qualified member at the companion, which is Modules §5.3's honored-member
   * read, so the slot really does run rather than being erased at the call
   * site: a stub or a missing lowering would answer `undefined` here.
   *
   * Written this way rather than through a `<a: Signed>` binder because a rigid
   * binder cannot host `fromInt`/`fromNat` at all today — `let f<a: Signed>(v:
   * Int): a = Signed.fromInt(v)` is refused as requiring `Int`, on the pre-#344
   * compiler as much as this one. That is a separate defect in the conversion
   * members' generic typing, not this arc's.
   */
  test("`fromInt` at `Int` is the identity, and `fromNat` at `Nat` too", async () => {
    const exports = await runMain([
      "export let itself: Int = Int.fromInt(-13)",
      "export let alsoItself: Nat = Nat.fromNat(13)",
      "export let widened: BigInt = BigInt.fromInt(-13)",
      "export let lifted: Int = Int.fromNat(13)",
      "",
    ].join("\n"));

    expect(exports["itself"]).toBe(-13);
    expect(exports["alsoItself"]).toBe(13);
    expect(exports["widened"]).toBe(-13n);
    expect(exports["lifted"]).toBe(13);
  });

  /**
   * And the slot never materializes for a literal: Numeric Literals §5's
   * erasure means an `Int`-typed literal is the bare JavaScript number, with no
   * `fromNat` call standing in front of it.
   */
  test("an `Int` literal still erases to a bare number", () => {
    const text = emitted([
      "export let plain: Int = 41",
      "export let separated: Int = 1_000_000",
      "export let negative: Int = -12",
      "",
    ].join("\n"));

    expect(text).toContain("const plain = 41;");
    expect(text).toContain("const separated = 1000000;");
    expect(text).toContain("const negative = -12;");
    expect(text).not.toContain("fromNat");
  });
});

describe("Numeric Literals §4's defaulting follows the instances home", () => {
  /**
   * The rule did not change; where the `Int` instances live did. If the
   * membership test still read the retired wired table, every unannotated
   * literal in the language would report as ambiguous.
   */
  test("an unannotated literal is still an `Int`, and bare `gcd` still resolves", async () => {
    const exports = await runMain([
      "let x = 1",
      "export let doubled: Int = x + x",
      "export let common: Int = Integral.gcd(4, 6)",
      "export let powered: Int = 2 ** 4",
      "export let compared: Bool = 3 < 4",
      "",
    ].join("\n"));

    expect(exports["doubled"]).toBe(2);
    expect(exports["common"]).toBe(2);
    expect(exports["powered"]).toBe(16);
    expect(exports["compared"]).toBe(true);
  });

  /**
   * And the set is still closed against user code. `Conjure` is pre-registered
   * by nothing, so it blocks defaulting exactly as §4 requires — the amended
   * test consults the instance table, and this is the case that proves it did
   * not thereby become user-extensible.
   */
  test("a user constraint still blocks defaulting, naming itself", () => {
    expect(diagnostics([
      ["/main.hex",
        "constraint Conjure<a> =\n" +
        "    summon(value: a): a\n" +
        "honor Conjure<Int> =\n" +
        "    summon(value) = value\n" +
        "let blocked = summon(1)\n"],
    ])).toEqual([
      "the literal `1` cannot default to `Int`: `Conjure` is not a defaultable " +
        "constraint; add a type annotation to pin the type",
    ]);
  });
});

describe("`fromInt` gained a second exporter", () => {
  /**
   * `stdlib/Nat.hex` exports a conversion by that name beside `Signed.hex`'s
   * member, so the bare spelling takes Modules §5.5's refusal and names both
   * qualified homes — since #742 in the refusal's own words rather than the
   * ambiguity rule's, which is now the only difference the second exporter
   * makes: the bare spelling was never going to resolve either way.
   */
  test("the bare spelling is refused, naming both homes", () => {
    expect(projectDiagnostics(
      "export let widen<a: Signed>(value: Int): a = fromInt(value)\n",
    )).toContain(
      "no bare `fromInt`; write `Signed.fromInt(value)` or `Nat.fromInt(value)`",
    );
  });


  /** A user module's own `fromInt` is unaffected — it is not a prelude name. */
  test("a module exporting its own `fromInt` still works", async () => {
    const exports = await runProject([
      ["/ids.hex", "export let fromInt(value: Int): String = \"id-${value}\"\n"],
      ["/main.hex",
        'import { fromInt } from "./ids"\n' +
        "export let label: String = fromInt(7)\n"],
    ]);

    expect(exports["label"]).toBe("id-7");
  });
});

describe("Collections Part 2 §2.5's `Hash` row, now hand-written source", () => {
  /**
   * The companion privilege carve-out (Constraints §4.5) is what lets
   * `stdlib/Int.hex` hand-write `Hash<Int>` at all: a primitive has no
   * declaration to hang `derives` on. A record deriving over `Int` fields still
   * derives, and equal values still hash equally — the law the carve-out
   * transfers to the companion.
   */
  test("a record deriving over `Int` fields hashes lawfully", async () => {
    const exports = await runMain([
      "export record Point derives (Eq, Hash) = {x: Int, y: Int}",
      "let here = Point({x = 3, y = 4})",
      "let alsoHere = Point({x = 3, y = 4})",
      "let elsewhere = Point({x = 4, y = 3})",
      "export let same: Bool = here == alsoHere",
      "export let agree: Bool = Hash.hash(here) == Hash.hash(alsoHere)",
      "export let distinct: Bool = here != elsewhere",
      "let seen: Set(Point) = Set.add(Set.add(Set.add(Set.empty, here), alsoHere), elsewhere)",
      "export let collapsed: Int = Set.size(seen)",
      "",
    ].join("\n"));

    expect(exports["same"]).toBe(true);
    expect(exports["agree"]).toBe(true);
    expect(exports["distinct"]).toBe(true);
    expect(exports["collapsed"]).toBe(2);
  });

  /**
   * The carve-out follows compilation privilege: a user module keeps the
   * refusal.
   *
   * Outside the carve-out a primitive is Collections Part 2 §9's **fourth** row
   * (#647) — there is no declaration a `derives` clause could sit on, which is
   * the very fact the carve-out exists for, so the report states it and offers
   * nothing (Modules §7.6's offering discipline). The body carries a literal,
   * which crashed the checker before #651.
   */
  test("a hand-written `honor Hash<Int>` in user source is still refused", () => {
    expect(diagnostics([
      ["/main.hex", "honor Hash<Int> =\n    hash(value) = value * 31\n"],
    ])).toContain(
      "`Hash` instances must be derived, and this subject has no declaration " +
        "that could carry a `derives` clause",
    );
  });
});

describe("the widenings still cross where §5.1 says they do", () => {
  /**
   * `Nat` -> `Int` is the identity over one shared `number`, and `Int` ->
   * `BigInt` is `BigInt(x)`. Both are contextual evidence insertion, and both
   * now consult the companions' source instances rather than the wired table —
   * so the emitted shapes are pinned as well as executed.
   */
  test("`Nat` widens into `Int` and `Int` into `BigInt`", async () => {
    const source = [
      "export let counted(size: Nat): Int = size + 0",
      "export let promoted(value: Int): BigInt = value + 0n",
      "export let bigger: BigInt = promoted(6)",
      "export let narrowed: Int = counted(9)",
      "",
    ].join("\n");
    const exports = await runMain(source);
    const text = emitted(source);

    expect(exports["bigger"]).toBe(6n);
    expect(exports["narrowed"]).toBe(9);
    // The `Nat` widening is representationally nothing; the `BigInt` one is one
    // host call, and neither reaches a `fromNat`/`fromInt` slot.
    expect(text).toContain("const counted = size => size + 0;");
    expect(text).toContain("const promoted = value => BigInt(value) + 0n;");
  });
});

describe("`runtime/VectorTrie.hex`'s index arithmetic, re-routed", () => {
  /**
   * The trie's `Int.div`/`Int.mod` used to resolve through the door this change
   * removed; they are `Integral<Int>`'s members at the companion now. The trie
   * is the one place in the language where that arithmetic runs on a hot path
   * and at every height, so it is exercised past a single leaf — 40 elements
   * spans two, and 1200 spans a third level.
   */
  test("a vector deep enough to descend still reads back what it wrote", async () => {
    const exports = await runMain([
      "let build(count: Int): Vector(Int) =",
      // `built` rather than `values`: `stdlib/Map.hex` exports a bare `values`
      // since #370, and a `let`/`var` may not rebind a prelude name.
      "    var built: Vector(Int) = []",
      "    for index in 1 .. count",
      "        built := built ++ [index * 3]",
      "    built",
      "let wide = build(1200)",
      "export let size: Int = Vector.length(wide)",
      "export let sampled: Vector(Int) = [wide[1], wide[40], wide[41], wide[1200]]",
      "export let updated: Int = Vector.set(wide, 700, -1)[700]",
      "export let summed: Int = Seq.fold(Vector.toSeq(build(40)), 0, (total, value) => total + value)",
      "",
    ].join("\n"));

    expect(exports["size"]).toBe(1200);
    expect([...(exports["sampled"] as Iterable<unknown>)]).toEqual([3, 120, 123, 3600]);
    expect(exports["updated"]).toBe(-1);
    // 3 * (1 + 2 + ... + 40)
    expect(exports["summed"]).toBe(2460);
  });
});

describe("the companion's own emitted shape", () => {
  /**
   * The door bindings lower to bare arrows with nothing behind them, which is
   * what the primop split is for: the natives are JavaScript operators and the
   * guards above them are the Hexagon this file can read.
   */
  test("`Int.js` holds the natives as operators and the guards as source", () => {
    const text = companion("export let n: Int = Int.div(8, 3)\n");

    expect(text).toContain("(__a, __b) => Math.trunc(__a / __b)");
    expect(text).toContain("(__a, __b) => __a % __b");
    expect(text).toContain("(__a, __b) => __a ** __b");
    expect(text).toContain('"Int.div: divisor is zero"');
    expect(text).toContain('"an integer exponent cannot be negative"');
    // The self-identity is the plain binding, with no host call behind it —
    // now the member's own seat, which is where every member's implementation
    // lives since #444 (Constraints §6.1).
    expect(text).toContain("const __Signed_Int_fromInt = value => value;");
    expect(text).toContain("fromInt: __Signed_Int_fromInt");
  });
});
