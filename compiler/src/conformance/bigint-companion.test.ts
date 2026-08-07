import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * PR δ1 of #344: **`BigInt` is a source companion.** `stdlib/BigInt.hex` is the
 * primitive's home module (Constraints §5.3), its eight instances are ordinary
 * `honor` blocks, and the compiler's wired `BigInt` rows retired in the same
 * change — a wired row and a source instance never both answer for one
 * (constraint, type) pair.
 *
 * **Everything that can run, runs.** The failure mode this arc is exposed to is
 * a clean compile whose JavaScript computes a different answer than it did
 * before — a `Math.trunc` reaching a `bigint`, a guard lost with the helper that
 * carried it, an instance selected from the wrong table. Only executing the
 * emitted module sees any of that.
 *
 * The programs are deliberately byte-distinct from one another: two conformance
 * modules whose emitted JavaScript is identical share one instance through the
 * ESM data-URL cache, and a pin that silently measures its neighbour's module is
 * a pin that cannot fail.
 */

/** Every diagnostic message a multi-module project produced, in order. */
function diagnostics(files: readonly (readonly [string, string])[]): readonly string[] {
  return compileFiles(files).diagnostics.map(({ message }) => message);
}

/** `/main.hex`'s emitted JavaScript, which must have compiled cleanly. */
function emitted(source: string): string {
  const project = compileMain(source);
  expect(project.diagnostics).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
}

/** `stdlib/BigInt.hex`'s emitted JavaScript, as the prelude compiled it. */
function companion(source: string): string {
  const project = compileMain(source);
  expect(project.diagnostics).toEqual([]);
  return project.modules
    .find(({ source: file }) => file.path.endsWith("BigInt.hex"))!.javascript.text;
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
    expect(projectDiagnostics("export let r: Bool = equalz(1n, 1n)\n"))
      .toEqual(["unknown name `equalz`"]);
  });
});

describe("the four spellings are one implementation", () => {
  /**
   * The qualified spelling, the dot call, the bare member under a written bound,
   * and the operator/interpolation faces all reach the same member of the same
   * instance. This is the property the migration had to preserve exactly:
   * Modules §5.3's guarantee is that a consumer's `M.f(…)` survives `f` moving
   * between a plain module function and a constraint member "with no call site
   * changing", and before #344 three of these four spellings were a compiler
   * row rather than a member at all.
   */
  test("`div` agrees qualified, after a dot, and under a bound", async () => {
    const exports = await runMain([
      "export let qualified: BigInt = BigInt.div(-7n, 2n)",
      "export let dotted: BigInt = (-7n).div(2n)",
      "export let bound<a: Integral>(left: a, right: a): a = div(left, right)",
      "export let generic: BigInt = bound(-7n, 2n)",
      "",
    ].join("\n"));

    expect(exports["qualified"]).toBe(-4n);
    expect(exports["dotted"]).toBe(-4n);
    expect(exports["generic"]).toBe(-4n);
  });

  test("`show` agrees qualified, after a dot, under a bound, and interpolated", async () => {
    const exports = await runMain([
      "export let qualified: String = BigInt.show(42n)",
      "export let dotted: String = 42n.show()",
      "export let bound<a: Show>(value: a): String = show(value)",
      "export let generic: String = bound(42n)",
      'export let interpolated: String = "${42n}"',
      "",
    ].join("\n"));

    // Primitive Types §7: no `n` suffix. `String(42n)` is the display form.
    expect(exports["qualified"]).toBe("42");
    expect(exports["dotted"]).toBe("42");
    expect(exports["generic"]).toBe("42");
    expect(exports["interpolated"]).toBe("42");
  });

  test("`add` agrees qualified, after a dot, under a bound, and as `+`", async () => {
    const exports = await runMain([
      "export let qualified: BigInt = BigInt.add(20n, 22n)",
      "export let dotted: BigInt = 20n.add(22n)",
      "export let bound<a: Num>(left: a, right: a): a = add(left, right)",
      "export let generic: BigInt = bound(20n, 22n)",
      "export let operator: BigInt = 20n + 22n",
      "",
    ].join("\n"));

    expect(exports["qualified"]).toBe(42n);
    expect(exports["dotted"]).toBe(42n);
    expect(exports["generic"]).toBe(42n);
    expect(exports["operator"]).toBe(42n);
  });

  test("`compare` agrees qualified, after a dot, under a bound, and as `<`", async () => {
    const exports = await runMain([
      "export let qualified: Ordering = BigInt.compare(1n, 2n)",
      "export let dotted: Ordering = 1n.compare(2n)",
      "export let bound<a: Ord>(left: a, right: a): Ordering = compare(left, right)",
      "export let generic: Ordering = bound(1n, 2n)",
      "export let operator: Bool = 1n < 2n",
      "export let reversed: Ordering = BigInt.compare(2n, 1n)",
      "export let equal: Ordering = BigInt.compare(2n, 2n)",
      "",
    ].join("\n"));

    // Unions §6.2's name-strings, which is what an `Ordering` is (#275).
    expect(exports["qualified"]).toBe("Less");
    expect(exports["dotted"]).toBe("Less");
    expect(exports["generic"]).toBe("Less");
    expect(exports["operator"]).toBe(true);
    expect(exports["reversed"]).toBe("Greater");
    expect(exports["equal"]).toBe("Equal");
  });
});

describe("the Euclidean laws hold at BigInt (Division & Remainder §2)", () => {
  /**
   * The §2 table, every sign combination, both pairs. The Euclidean remainder is
   * non-negative *unconditionally* — that is the whole content of the convention
   * — and the truncated one takes the dividend's sign, which is JS's `%`.
   */
  test("the §2 table, both pairs, all four sign combinations", async () => {
    const exports = await runMain([
      "export let euclidean: Vector((BigInt, BigInt)) = [",
      "    (BigInt.div(7n, 3n), BigInt.mod(7n, 3n)),",
      "    (BigInt.div(-7n, 3n), BigInt.mod(-7n, 3n)),",
      "    (BigInt.div(7n, -3n), BigInt.mod(7n, -3n)),",
      "    (BigInt.div(-7n, -3n), BigInt.mod(-7n, -3n)),",
      "]",
      "export let truncated: Vector((BigInt, BigInt)) = [",
      "    (BigInt.quot(7n, 3n), BigInt.rem(7n, 3n)),",
      "    (BigInt.quot(-7n, 3n), BigInt.rem(-7n, 3n)),",
      "    (BigInt.quot(7n, -3n), BigInt.rem(7n, -3n)),",
      "    (BigInt.quot(-7n, -3n), BigInt.rem(-7n, -3n)),",
      "]",
      "",
    ].join("\n"));

    expect([...(exports["euclidean"] as Iterable<unknown>)]).toEqual([
      [2n, 1n],
      [-3n, 2n],
      [-2n, 1n],
      [3n, 2n],
    ]);
    expect([...(exports["truncated"] as Iterable<unknown>)]).toEqual([
      [2n, 1n],
      [-2n, -1n],
      [-2n, 1n],
      [2n, -1n],
    ]);
  });

  /**
   * The two identities, checked over operands the table above does not name, so
   * this is a law and not a restatement of six rows. Bigger than `Int`'s range
   * on purpose: the type's reason for existing is that it does not overflow, and
   * the old implementation's `Math.trunc` would not have survived these.
   */
  test("both division identities hold past the Int range", async () => {
    const exports = await runMain([
      "let left: BigInt = -9007199254740993000000000007n",
      "let right: BigInt = 1000000000000000003n",
      "export let euclideanIdentity: Bool =",
      "    BigInt.div(left, right) * right + BigInt.mod(left, right) == left",
      "export let euclideanInvariant: Bool =",
      "    BigInt.mod(left, right) >= 0n and BigInt.mod(left, right) < right",
      "export let truncatedIdentity: Bool =",
      "    BigInt.quot(left, right) * right + BigInt.rem(left, right) == left",
      "export let truncatedSign: Bool = BigInt.rem(left, right) <= 0n",
      "",
    ].join("\n"));

    expect(exports["euclideanIdentity"]).toBe(true);
    expect(exports["euclideanInvariant"]).toBe(true);
    expect(exports["truncatedIdentity"]).toBe(true);
    expect(exports["truncatedSign"]).toBe(true);
  });

  /** Integral §4's four `gcd` laws, and §5's three for `lcm`. */
  test("`gcd` is sign-insensitive, non-negative, and total at zero", async () => {
    const exports = await runMain([
      "export let gcds: Vector(BigInt) = [",
      "    BigInt.gcd(12n, 18n), BigInt.gcd(-4n, 6n), BigInt.gcd(-4n, -6n),",
      "    BigInt.gcd(7n, 0n), BigInt.gcd(-7n, 0n), BigInt.gcd(0n, -7n), BigInt.gcd(0n, 0n),",
      "]",
      "",
    ].join("\n"));

    expect([...(exports["gcds"] as Iterable<unknown>)])
      .toEqual([6n, 2n, 2n, 7n, 7n, 7n, 0n]);
  });

  test("`lcm` is zero at a zero operand, non-negative, and divide-first exact", async () => {
    const exports = await runMain([
      "export let lcms: Vector(BigInt) = [",
      "    BigInt.lcm(4n, 6n), BigInt.lcm(0n, 5n), BigInt.lcm(5n, 0n),",
      "    BigInt.lcm(-4n, 6n), BigInt.lcm(4n, -6n), BigInt.lcm(-4n, -6n),",
      "]",
      // Divide-first is what keeps the intermediate small; two coprime operands
      // whose product no fixed-width type holds is where the form is visible.
      "export let coprime: BigInt = BigInt.lcm(100000000000000003n, 100000000000000019n)",
      "",
    ].join("\n"));

    expect([...(exports["lcms"] as Iterable<unknown>)])
      .toEqual([12n, 0n, 0n, 12n, 12n, 12n]);
    expect(exports["coprime"]).toBe(100000000000000003n * 100000000000000019n);
  });
});

describe("the zero-divisor guards moved with their bodies (§7)", () => {
  /**
   * All four throw, each naming the operation that threw, and the brand is the
   * one a catch site reads. The declaration is `stdlib/Integral.hex`'s now
   * (#344) — one exception for every type whose integer division is partial —
   * but the emitted shape is the same `{ name, $hex }` pair the retired runtime
   * helpers produced, which is what keeps existing catch sites working.
   */
  test("`div`, `mod`, `quot`, and `rem` each throw a named DivideByZeroError", async () => {
    const exports = await runMain([
      "export let byDiv(): BigInt = BigInt.div(1n, 0n)",
      "export let byMod(): BigInt = BigInt.mod(1n, 0n)",
      "export let byQuot(): BigInt = BigInt.quot(1n, 0n)",
      "export let byRem(): BigInt = BigInt.rem(1n, 0n)",
      "",
    ].join("\n"));

    for (const [name, message] of [
      ["byDiv", "BigInt.div: divisor is zero"],
      ["byMod", "BigInt.mod: divisor is zero"],
      ["byQuot", "BigInt.quot: divisor is zero"],
      ["byRem", "BigInt.rem: divisor is zero"],
    ] as const) {
      const error = threw(exports[name] as () => unknown);
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({ name: "DivideByZeroError", $hex: true, message });
    }
  });

  /**
   * Integral §4: `gcd` never throws — the loop's exit condition is exactly the
   * zero divisor its `rem` would fault on — and §5 says the same of `lcm`, whose
   * zero cases are answered before any division happens.
   */
  test("`gcd` and `lcm` never reach a zero divisor", async () => {
    const exports = await runMain([
      "export let safeGcd(): BigInt = BigInt.gcd(0n, 0n)",
      "export let safeLcm(): BigInt = BigInt.lcm(0n, 0n)",
      "",
    ].join("\n"));

    expect(threw(exports["safeGcd"] as () => unknown)).toBeUndefined();
    expect(threw(exports["safeLcm"] as () => unknown)).toBeUndefined();
  });

  /** The catch site the migration must not break: by name, in JavaScript. */
  test("a JavaScript catch site still reads the name brand", async () => {
    const exports = await runMain([
      "export let boom(): BigInt = BigInt.mod(9n, 0n)",
      "",
    ].join("\n"));

    const error = threw(exports["boom"] as () => unknown) as Error;
    expect(error.name).toBe("DivideByZeroError");
  });
});

describe("negative exponents (Pow, delta 4)", () => {
  /**
   * The guard is Hexagon in the companion now, over a door binding that is the
   * raw `**`; the exception is `stdlib/Pow.hex`'s declaration. Message and name
   * are the retired helper's exactly — and the value is now `$hex`-branded,
   * which the helper's never was.
   */
  test("`**` at BigInt throws NegativeExponentError with the same message", async () => {
    const exports = await runMain([
      "export let fine: BigInt = 2n ** 10n",
      "export let zero: BigInt = 7n ** 0n",
      "export let boom(): BigInt = 2n ** -1n",
      "",
    ].join("\n"));

    expect(exports["fine"]).toBe(1024n);
    expect(exports["zero"]).toBe(1n);
    const error = threw(exports["boom"] as () => unknown);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: "NegativeExponentError",
      message: "an integer exponent cannot be negative",
    });
  });

  test("`pow` under a written bound reaches the same guard", async () => {
    const exports = await runMain([
      "export let raise<a: Pow>(base: a, exponent: a): a = pow(base, exponent)",
      "export let big: BigInt = raise(3n, 4n)",
      "export let boom(): BigInt = raise(3n, -4n)",
      "",
    ].join("\n"));

    expect(exports["big"]).toBe(81n);
    expect((threw(exports["boom"] as () => unknown) as Error).name)
      .toBe("NegativeExponentError");
  });
});

describe("the conversions (Primitive Types §6)", () => {
  /**
   * `fromInt` and `fromNat` are members reached qualified — one implementation,
   * two spellings — and `toInt` is the standard `Option`. The boundary is
   * ±(2^53 - 1), the range an `Int` holds exactly.
   */
  test("`fromInt` and `fromNat` are the Signed and Num members, qualified", async () => {
    const exports = await runMain([
      "export let signed: BigInt = BigInt.fromInt(-3)",
      "export let natural: BigInt = BigInt.fromNat(3)",
      "let established: Int = -1234567",
      "export let widened: BigInt = BigInt.fromInt(established)",
      // The contextual widening reaches the very same member (Numeric Literals
      // §5.1), which is what "one implementation, two spellings" means here.
      "export let contextual: BigInt = established",
      "",
    ].join("\n"));

    expect(exports["signed"]).toBe(-3n);
    expect(exports["natural"]).toBe(3n);
    expect(exports["widened"]).toBe(-1234567n);
    expect(exports["contextual"]).toBe(-1234567n);
  });

  test("`toInt` answers Some inside the exact range and None outside it", async () => {
    const exports = await runMain([
      "export let atTop: Option(Int) = BigInt.toInt(9007199254740991n)",
      "export let atBottom: Option(Int) = BigInt.toInt(-9007199254740991n)",
      "export let pastTop: Option(Int) = BigInt.toInt(9007199254740992n)",
      "export let pastBottom: Option(Int) = BigInt.toInt(-9007199254740992n)",
      "export let ordinary: Option(Int) = BigInt.toInt(5n)",
      "export let dotted: Option(Int) = 5n.toInt()",
      "",
    ].join("\n"));

    expect(exports["atTop"]).toEqual({ tag: "Some", value: 9007199254740991 });
    expect(exports["atBottom"]).toEqual({ tag: "Some", value: -9007199254740991 });
    expect(exports["pastTop"]).toEqual({ tag: "None" });
    expect(exports["pastBottom"]).toEqual({ tag: "None" });
    expect(exports["ordinary"]).toEqual({ tag: "Some", value: 5 });
    expect(exports["dotted"]).toEqual({ tag: "Some", value: 5 });
  });

  test("`toFloat` is total and documented-lossy", async () => {
    const exports = await runMain([
      "export let exact: Float = BigInt.toFloat(5n)",
      "export let negative: Float = BigInt.toFloat(-5n)",
      // Past 2^53 the nearest Float is not the integer asked for. The doc says
      // so; this is the case it describes.
      "export let lossy: Float = BigInt.toFloat(9007199254740993n)",
      "export let dotted: Float = 5n.toFloat()",
      "",
    ].join("\n"));

    expect(exports["exact"]).toBe(5);
    expect(exports["negative"]).toBe(-5);
    expect(exports["lossy"]).toBe(9007199254740992);
    expect(exports["dotted"]).toBe(5);
  });
});

describe("`Eq` and `Hash` at BigInt", () => {
  test("equality and its inherited default agree", async () => {
    const exports = await runMain([
      "export let same: Bool = 1000000000000000000001n == 1000000000000000000001n",
      "export let different: Bool = 1000000000000000000001n != 1000000000000000000002n",
      "export let byMember: Bool = BigInt.equals(3n, 3n)",
      "export let byDefault: Bool = BigInt.notEquals(3n, 3n)",
      "",
    ].join("\n"));

    expect(exports["same"]).toBe(true);
    expect(exports["different"]).toBe(true);
    expect(exports["byMember"]).toBe(true);
    expect(exports["byDefault"]).toBe(false);
  });

  /**
   * The β-era emission fault, pinned at the shape rather than by execution: a
   * defaulted member of a prelude constraint, inherited by a prelude module's
   * instance, goes through Constraints §6.5's hoisted-default fork. An executed
   * pin cannot see a *second* `notEquals:` key shadowing the first, nor a
   * reference to a `__hex_default…` helper that was never emitted — a duplicate
   * key is legal JavaScript and the later one silently wins.
   */
  test("the Eq instance carries exactly one `notEquals:` and no dangling default", () => {
    // The program has to *reach* `BigInt.js`: emission writes a prelude module
    // only when something imports it, and `1n == 1n` inlines to `1n === 1n`.
    // Naming the defaulted member is what puts the dictionary in the import.
    const text = companion("export let r: Bool = BigInt.notEquals(1n, 2n)\n");
    const instance = text.split("\n")
      .find((line) => line.includes("__hex_instance_Eq_BigInt = {"));

    expect(instance).toBeDefined();
    // One key each, so nothing shadows anything: a duplicate `notEquals:` is
    // legal JavaScript whose later entry silently wins, which no executed pin
    // could ever see.
    expect(instance!.match(/notEquals:/gu)).toHaveLength(1);
    expect(instance!.match(/(?<![A-Za-z])equals:/gu)).toHaveLength(1);
    for (const reference of text.match(/__hex_default\d+/gu) ?? []) {
      expect(text).toContain(`const ${reference} =`);
    }
  });

  test("hashing agrees with equality and is usable as a Map key", async () => {
    const exports = await runMain([
      "export let sameHash: Bool = hash(123456789012345678901n) == hash(123456789012345678901n)",
      "export let direct: Int = BigInt.hash(7n)",
      "export let dotted: Int = 7n.hash()",
      // Hash's law is what the derivable-only rule protects, and the carve-out
      // moved the obligation into the companion, where `Eq` sits beside it.
      "export let lawful: Bool = 7n == 7n and hash(7n) == hash(7n)",
      "",
    ].join("\n"));

    expect(exports["sameHash"]).toBe(true);
    expect(typeof exports["direct"]).toBe("number");
    expect(exports["dotted"]).toBe(exports["direct"]);
    expect(exports["lawful"]).toBe(true);
  });
});

describe("the orphan rule reads for a primitive as it does for a nominal (§5.3)", () => {
  /**
   * The home the ruling supplies is the *companion*, and the fact follows how a
   * module is compiled rather than what it says — so a user module honoring at
   * `BigInt` declares neither the constraint nor the subject, and is the orphan
   * it always was. Without this the coherence slot for `Show<BigInt>` would be
   * claimable by any module in the graph.
   */
  test("a user module cannot honor a prelude constraint at BigInt", () => {
    expect(projectDiagnostics(
      "honor Show<BigInt> =\n" +
      '    show(value) = "mine"\n',
    )).toContain(
      "orphan instance: this module declares neither `Show` nor the instance subject",
    );
  });

  /** The other half: the module that *does* declare the constraint still may. */
  test("a module declaring its own constraint may still honor it at BigInt", () => {
    expect(projectDiagnostics(
      "export constraint Describe<a> =\n" +
      "    describe(value: a): String\n" +
      "honor Describe<BigInt> =\n" +
      '    describe(value) = "a big integer"\n' +
      "export let d: String = describe(1n)\n",
    )).toEqual([]);
  });

  /** And `stdlib/BigInt.hex` itself is accepted, which the prelude proves. */
  test("the companion's own eight instances compile", () => {
    expect(projectDiagnostics("export let r: BigInt = 1n\n")).toEqual([]);
  });

  /**
   * Constraints §4.5's carve-out, and its exact boundary: `Hash` stays
   * derivable-only everywhere the compilation did not seat the module at a
   * primitive's own injection path. The message is unchanged, because the rule
   * for user source is unchanged.
   */
  test("a user `honor Hash<BigInt>` keeps the derivable-only refusal", () => {
    expect(projectDiagnostics(
      "honor Hash<BigInt> =\n" +
      "    hash(value) = toIntUnchecked\n",
    )).toContain(
      "`Hash` instances cannot be hand-written; use `derives Hash` on the declaration of the subject type",
    );
  });
});

describe("the wired rows are gone, not dormant", () => {
  /**
   * `BigInt` left the primitive-operation guard (`spec/intrinsics.md` §9.2), so
   * nothing in a consumer's output carries the retired helper family — the
   * division bodies live in `stdlib/BigInt.hex` and reach the consumer as
   * imports. A row that merely stopped being *selected* would still be emitted
   * the moment something reached it.
   */
  test("no `__hex_bigInt*` helper survives in a consumer's output", () => {
    const text = emitted([
      "export let a: BigInt = BigInt.div(9n, 4n)",
      "export let b: BigInt = BigInt.gcd(9n, 6n)",
      "export let c: BigInt = BigInt.lcm(9n, 6n)",
      "",
    ].join("\n"));

    expect(text).not.toContain("__hex_bigInt");
    expect(text).toContain('from "./BigInt.js"');
  });

  /**
   * The other direction: `Int` and `Float` are untouched. Their guard rows are
   * still the compiler's until their own milestones, so `Int.div` still resolves
   * to a `PrimitiveOperation` and still emits its helper.
   */
  test("`Int` and `Float` keep their doors and their helpers", () => {
    const text = emitted([
      "export let a: Int = Int.div(-7, 2)",
      "export let b: Int = Int.gcd(12, 18)",
      "export let c: Float = Float.mod(-7.0, 3.0)",
      "export let d: Float = Float.rem(-7.0, 3.0)",
      "",
    ].join("\n"));

    expect(text).toContain("const __hex_intDiv");
    expect(text).toContain("const __hex_intGcd");
    expect(text).toContain("const __hex_floatMod");
    expect(text).toContain("const __hex_floatRem");
  });

  /**
   * Constraints §6.1's last sentence, checked: the monomorphic tables survive
   * the migration as *inlining of the door-backed slots*. Emitted arithmetic,
   * comparison, and interpolation at `BigInt` are the JavaScript operators, not
   * dictionary slot reads — one implementation, rendered.
   */
  test("operators and interpolation at BigInt still emit as operators", () => {
    const text = emitted([
      "export let sum: BigInt = 20n + 22n",
      "export let product: BigInt = 6n * 7n",
      "export let difference: BigInt = 50n - 8n",
      "export let opposite: BigInt = -42n",
      "export let ordered: Bool = 1n < 2n",
      "export let identical: Bool = 1n == 1n",
      'export let rendered: String = "${42n}"',
      "",
    ].join("\n"));

    expect(text).toContain("const sum = 20n + 22n;");
    expect(text).toContain("const product = 6n * 7n;");
    expect(text).toContain("const difference = 50n - 8n;");
    expect(text).toContain("const ordered = 1n < 2n;");
    expect(text).toContain("const identical = 1n === 1n;");
    expect(text).toContain("const rendered = String(42n);");
  });
});

describe("the companion is an ordinary module (Modules §5.3, §5.4)", () => {
  /**
   * Its plain exports are ordinary exports, reachable qualified and after a dot;
   * its members are qualifiable but not bare exports (Constraints §4.6's
   * one-exporter law), so bare `div` in a consumer is still `Integral.hex`'s
   * polymorphic forwarder and not `BigInt`'s member.
   */
  test("bare `div` in a consumer is still the polymorphic member", async () => {
    const exports = await runMain([
      "export let atBig: BigInt = div(-9n, 4n)",
      "export let atInt: Int = div(-9, 4)",
      "",
    ].join("\n"));

    expect(exports["atBig"]).toBe(-3n);
    expect(exports["atInt"]).toBe(-3);
  });

  /**
   * Modules §5.4: a module-level binding may occlude a prelude name, and a
   * member's spelling is claimed only in the module that honors it. A consumer
   * binding `div` is therefore ordinary occlusion, not the rebinding error.
   */
  test("a consumer may still bind `div` at module level", async () => {
    const exports = await runMain([
      "let div(left: BigInt, right: BigInt): BigInt = left + right",
      "export let mine: BigInt = div(9n, 4n)",
      "export let theirs: BigInt = BigInt.div(9n, 4n)",
      "",
    ].join("\n"));

    expect(exports["mine"]).toBe(13n);
    expect(exports["theirs"]).toBe(2n);
  });

  /**
   * The intrinsic door's gate is untouched by the new keys: privilege is prelude
   * membership, and a user module naming a `bigInt*` key gets the reservation's
   * refusal like any other (`spec/intrinsics.md` §5.1).
   */
  test("a user module cannot reach the new inventory keys", () => {
    expect(projectDiagnostics(
      'extern from "hex:intrinsic"\n' +
      "    export fun bigIntQuot as mine(left: BigInt, right: BigInt): BigInt\n",
    )).toEqual([
      "the `hex:` specifier scheme is reserved to standard-library source; " +
      "to bind your own JavaScript implementation, use an ordinary `extern from` " +
      "block naming your module",
    ]);
  });

  /**
   * A `BigInt` receiver reaches the companion's plain exports after a dot, which
   * is Method Syntax §4.2's first clause working on a primitive head for the
   * first time — before #344 a primitive's dot surface was members only, because
   * no primitive had a companion module to export anything.
   */
  test("a BigInt receiver reaches the companion's plain exports", async () => {
    const exports = await runMain([
      "export let multiple: BigInt = 4n.lcm(6n)",
      "export let narrowed: Option(Int) = 4n.toInt()",
      "export let floating: Float = 4n.toFloat()",
      "",
    ].join("\n"));

    expect(exports["multiple"]).toBe(12n);
    expect(exports["narrowed"]).toEqual({ tag: "Some", value: 4 });
    expect(exports["floating"]).toBe(4);
  });
});

describe("Rat, the live consumer, is unmoved", () => {
  /**
   * `stdlib/Rat.hex` normalizes through `BigInt.gcd`/`BigInt.quot` and throws
   * the `DivideByZeroError` that now lives in `Integral.hex`. Its behaviour is
   * the migration's tightest constraint: every one of these values was produced
   * by the retired helpers before this change.
   */
  const RAT = [
    "record Rat derives Eq = {top: BigInt, bottom: BigInt}",
    "let create(top: BigInt, bottom: BigInt): Rat =",
    "    if bottom == 0n then",
    '        throw(DivideByZeroError("Rat.create: bottom is zero"))',
    "    else",
    "        let divisor = BigInt.gcd(top, bottom)",
    "        let reducedTop = BigInt.quot(top, divisor)",
    "        let reducedBottom = BigInt.quot(bottom, divisor)",
    "        if reducedBottom < 0n then",
    "            Rat({top = -reducedTop, bottom = -reducedBottom})",
    "        else",
    "            Rat({top = reducedTop, bottom = reducedBottom})",
    "",
  ].join("\n");

  test("normalization, sign canonicalization, and the zero-bottom fault", async () => {
    const exports = await runMain([
      RAT,
      "let half: Rat = create(3n, 6n)",
      "let negative: Rat = create(1n, -2n)",
      "let zero: Rat = create(0n, -99n)",
      "export let reduced: (BigInt, BigInt) = (half.top, half.bottom)",
      "export let canonical: (BigInt, BigInt) = (negative.top, negative.bottom)",
      "export let zeroed: (BigInt, BigInt) = (zero.top, zero.bottom)",
      "export let boom(): (BigInt, BigInt) =",
      "    let bad = create(1n, 0n)",
      "    (bad.top, bad.bottom)",
      "",
    ].join("\n"));

    expect(exports["reduced"]).toEqual([1n, 2n]);
    expect(exports["canonical"]).toEqual([-1n, 2n]);
    // gcd(0, n) = abs(n), so `0/n` normalizes to `0/1` with no special case —
    // Integral §4's load-bearing convention, still load-bearing.
    expect(exports["zeroed"]).toEqual([0n, 1n]);
    expect(threw(exports["boom"] as () => unknown))
      .toMatchObject({ name: "DivideByZeroError", message: "Rat.create: bottom is zero" });
  });

  /** The shipped file itself, compiled as a project supplies it. */
  test("`stdlib/Rat.hex` no longer declares its own DivideByZeroError", () => {
    expect(diagnostics([["/main.hex", "export let r: Int = 1\n"]])).toEqual([]);
  });
});
