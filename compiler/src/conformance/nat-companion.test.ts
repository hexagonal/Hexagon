import { describe, expect, test } from "vitest";

import { compileFiles, compileMain, projectDiagnostics, runMain } from "../support/test-project.js";

/**
 * PR δ2 of #344, second half: **`Nat` is a source companion.** `stdlib/Nat.hex`
 * is the primitive's home module (Constraints §5.3), its seven instances are
 * ordinary `honor` blocks, `Nat.fromInt` is its one plain export, and the
 * compiler's wired `Nat` row retired in the same change.
 *
 * `Nat` is where the template's *absences* live, so most of this file is about
 * what is deliberately not there. There is no `Signed<Nat>` — subtraction and
 * negation do not accept a `Nat`. `Pow<Nat>` carries no negative-exponent guard,
 * because a `Nat` exponent cannot be negative and a guard dead by typing is not
 * written. `Num<Nat>`'s `fromNat` takes no door key, being the self-identity.
 * And `Integral<Nat>`'s Euclidean pair is value-for-value its truncated pair,
 * yet each member still carries its **own** zero-divisor guard — delegating to a
 * sibling would report the wrong member's name, which is the one thing the
 * per-member messages exist to prevent. Before this change every `Nat` guard
 * said `Int`, because one wired helper family served both.
 *
 * Everything that can run, runs, and every program is byte-distinct from its
 * neighbours: two conformance modules with identical emitted JavaScript share
 * one instance through the ESM data-URL cache.
 */

/** `/main.hex`'s emitted JavaScript, which must have compiled cleanly. */
function emitted(source: string): string {
  const project = compileMain(source);
  expect(project.diagnostics).toEqual([]);
  return project.modules.find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
}

/** `stdlib/Nat.hex`'s emitted JavaScript, as the prelude compiled it. */
function companion(source: string): string {
  const project = compileMain(source);
  expect(project.diagnostics).toEqual([]);
  return project.modules
    .find(({ source: file }) => file.path.endsWith("/Nat.hex"))!.javascript.text;
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
    expect(projectDiagnostics("export let r: Nat = countt(1)\n"))
      .toEqual(["unknown name `countt`"]);
  });
});

describe("the four spellings are one implementation", () => {
  test("`rem` agrees qualified, after a dot, and under a bound", async () => {
    const exports = await runMain([
      "export let qualified: Nat = Nat.rem(17, 5)",
      "let seventeen: Nat = 17",
      "let five: Nat = 5",
      "export let dotted: Nat = seventeen.rem(five)",
      // The bare spelling is gone since the last landing: `stdlib/Float.hex`
      // exports a `rem` of its own, so `rem` has two visible exporters and
      // Modules §5.5 refuses the bare name (Division & Remainder §5). The dot
      // call is type-directed and never reads the bare layer, so it is the
      // generic route now — and it is still one implementation with the two
      // spellings above.
      "export let bound<a: Integral>(left: a, right: a): a = left.rem(right)",
      "export let generic: Nat = bound(seventeen, five)",
      "",
    ].join("\n"));

    expect(exports["qualified"]).toBe(2);
    expect(exports["dotted"]).toBe(2);
    expect(exports["generic"]).toBe(2);
  });
});

describe("Division & Remainder §2 at a type with no negatives", () => {
  /**
   * At `Nat` the Euclidean pair and the truncated pair coincide value for value,
   * because the only thing that ever separated them was a sign. That is why
   * `mod`'s body after its guard is the truncated remainder and `div`'s is the
   * truncated quotient — the *sameness* is the claim, so it is measured rather
   * than assumed.
   */
  test("`div` is `quot` and `mod` is `rem`, everywhere they are defined", async () => {
    const exports = await runMain([
      "let agree(left: Nat, right: Nat): Bool =",
      "    Nat.div(left, right) == Nat.quot(left, right)",
      "    and Nat.mod(left, right) == Nat.rem(left, right)",
      "export let agreements: Vector(Bool) = [",
      "    agree(7, 2), agree(0, 5), agree(5, 5), agree(1, 9), agree(100, 7)]",
      "export let quotients: Vector(Nat) = [",
      "    Nat.div(7, 2), Nat.div(0, 5), Nat.div(5, 5), Nat.div(1, 9), Nat.div(100, 7)]",
      "export let remainders: Vector(Nat) = [",
      "    Nat.mod(7, 2), Nat.mod(0, 5), Nat.mod(5, 5), Nat.mod(1, 9), Nat.mod(100, 7)]",
      "",
    ].join("\n"));

    expect([...(exports["agreements"] as Iterable<unknown>)])
      .toEqual([true, true, true, true, true]);
    expect([...(exports["quotients"] as Iterable<unknown>)]).toEqual([3, 0, 1, 0, 14]);
    expect([...(exports["remainders"] as Iterable<unknown>)]).toEqual([1, 0, 0, 1, 2]);
  });

  /** §2's identity holds here too, trivially but checkably. */
  test("`div(l, r) * r + mod(l, r) == l`", async () => {
    const exports = await runMain([
      "let holds(left: Nat, right: Nat): Bool =",
      "    Nat.div(left, right) * right + Nat.mod(left, right) == left",
      "export let identities: Vector(Bool) = [holds(9, 4), holds(0, 3), holds(8, 8)]",
      "",
    ].join("\n"));

    expect([...(exports["identities"] as Iterable<unknown>)]).toEqual([true, true, true]);
  });
});

describe("the guards name `Nat`, which they never did before", () => {
  /**
   * The deliberate fix riding in with the migration. One wired helper family
   * served `Int` and `Nat` alike and built its message from the string `"Int"`,
   * so a zero-divisor at `Nat` reported an operation on a type the program never
   * mentioned. Each member now carries its own guard in its own name — which is
   * also why `mod` does not delegate to `rem` and `div` does not delegate to
   * `quot`, even though after the guard their bodies are identical.
   */
  test("each member throws `DivideByZeroError` naming `Nat` and itself", async () => {
    const exports = await runMain([
      "export let byDiv(): Nat = Nat.div(1, 0)",
      "export let byMod(): Nat = Nat.mod(2, 0)",
      "export let byQuot(): Nat = Nat.quot(3, 0)",
      "export let byRem(): Nat = Nat.rem(4, 0)",
      "",
    ].join("\n"));

    const messages = ["Div", "Mod", "Quot", "Rem"].map((member) => {
      const error = threw(exports[`by${member}`] as () => unknown) as Error;
      expect(error.name).toBe("DivideByZeroError");
      expect((error as Error & { $hex?: boolean }).$hex).toBe(true);
      return error.message;
    });

    expect(messages).toEqual([
      "Nat.div: divisor is zero",
      "Nat.mod: divisor is zero",
      "Nat.quot: divisor is zero",
      "Nat.rem: divisor is zero",
    ]);
  });

  /** And `Int`'s messages still say `Int`, so the two are not one message again. */
  test("the same operations at `Int` still name `Int`", async () => {
    const exports = await runMain([
      "export let natSide(): Nat = Nat.mod(7, 0)",
      "export let intSide(): Int = Int.mod(7, 0)",
      "",
    ].join("\n"));

    expect((threw(exports["natSide"] as () => unknown) as Error).message)
      .toBe("Nat.mod: divisor is zero");
    expect((threw(exports["intSide"] as () => unknown) as Error).message)
      .toBe("Int.mod: divisor is zero");
  });
});

describe("`gcd` needs no absolute value here", () => {
  test("`gcd` absorbs zero and finds the divisor", async () => {
    const exports = await runMain([
      "export let divisors: Vector(Nat) = [",
      "    Nat.gcd(0, 0), Nat.gcd(12, 0), Nat.gcd(0, 12),",
      "    Nat.gcd(12, 18), Nat.gcd(17, 5), Nat.gcd(48, 18)]",
      "",
    ].join("\n"));

    expect([...(exports["divisors"] as Iterable<unknown>)]).toEqual([0, 12, 12, 6, 1, 6]);
  });
});

describe("`Pow<Nat>` is the raw native, guard and all absent", () => {
  /**
   * Operators §6.3's amended row: the negative-exponent guard `Int` and `BigInt`
   * carry is dead by typing at `Nat`, so it is not written. That makes `**` at
   * `Nat` the one integer exponentiation that still *inlines* — the raw operator
   * really is the slot, so rendering it is not a second implementation.
   */
  test("`**` at `Nat` computes, and emits as the operator", async () => {
    const source = [
      "export let eight: Nat = 2 ** 3",
      "export let one: Nat = 7 ** 0",
      "export let big: Nat = 3 ** 5",
      "",
    ].join("\n");
    const exports = await runMain(source);
    const text = emitted(source);

    expect(exports["eight"]).toBe(8);
    expect(exports["one"]).toBe(1);
    expect(exports["big"]).toBe(243);
    expect(text).toContain("const eight = 2 ** 3;");
    expect(text).toContain("const big = 3 ** 5;");
    expect(text).not.toContain("__hex_checkedPower");
    expect(text).not.toContain("Pow_Nat");
  });

  /** Contrast, in one program: the same operator at `Int` takes its guard. */
  test("`Int` and `Nat` part ways at `pow`, in the same module", () => {
    const text = emitted([
      "export let guarded: Int = 4 ** 2",
      "export let bare: Nat = 5 ** 2",
      "",
    ].join("\n"));

    expect(text).toContain("__hex_instance_Pow_Int.pow(4, 2)");
    expect(text).toContain("const bare = 5 ** 2;");
  });
});

describe("`Nat` honors no `Signed`", () => {
  /**
   * Primitive Types §1: generic addition and multiplication accept `Nat`;
   * subtraction and negation do not, and permanently. The refusal is what makes
   * the type worth having, so it is pinned rather than left to the absence of a
   * passing test.
   */
  test("subtraction and negation at `Nat` are refused", () => {
    expect(diagnostics([
      ["/main.hex", "export let gap(a: Nat, b: Nat): Nat = a - b\n"],
    ])).toContain("type `Nat` has no `Signed` instance");
    expect(diagnostics([
      ["/main.hex", "export let flipped(a: Nat): Nat = -a\n"],
    ])).toContain("type `Nat` has no `Signed` instance");
  });

  /** But `Num`, `Ord`, `Eq`, `Show`, `Hash`, `Pow`, and `Integral` all answer. */
  test("everything `Nat` does honor still works", async () => {
    const exports = await runMain([
      "let a: Nat = 30",
      "let b: Nat = 12",
      "export let sum: Nat = a + b",
      "export let product: Nat = a * b",
      "export let ordered: Bool = b < a",
      "export let same: Bool = a == a",
      "export let shown: String = show(a)",
      "export let interpolated: String = \"n=${b}\"",
      "export let divided: Nat = Nat.div(a, b)",
      "export let hashed: Bool = hash(a) == hash(a)",
      "",
    ].join("\n"));

    expect(exports["sum"]).toBe(42);
    expect(exports["product"]).toBe(360);
    expect(exports["ordered"]).toBe(true);
    expect(exports["same"]).toBe(true);
    expect(exports["shown"]).toBe("30");
    expect(exports["interpolated"]).toBe("n=12");
    expect(exports["divided"]).toBe(2);
    expect(exports["hashed"]).toBe(true);
  });
});

describe("Primitive Types §1's checked boundary conversion", () => {
  /**
   * `Nat.fromInt : Int -> Option(Nat)` is a sign check in Hexagon over the one
   * unchecked core the pair declares. The total direction is `Num.fromNat`,
   * which widens an established `Nat` into any numeric type — both are here, so
   * the pair reads as a pair.
   */
  test("`fromInt` answers `Some` for the non-negative and `None` below zero", async () => {
    const exports = await runMain([
      "let described(value: Int): String =",
      "    match Nat.fromInt(value)",
      "        Some(count) => \"count ${count}\"",
      "        None => \"negative\"",
      "export let readings: Vector(String) = [",
      "    described(5), described(0), described(-1), described(-9007199254740991)]",
      "",
    ].join("\n"));

    expect([...(exports["readings"] as Iterable<unknown>)])
      .toEqual(["count 5", "count 0", "negative", "negative"]);
  });

  /** The result is genuinely an `Option(Nat)`, and its payload a genuine `Nat`. */
  test("the answer's payload is a `Nat` a `Nat`-typed binding accepts", async () => {
    const exports = await runMain([
      "let orZero(result: Option(Nat)): Nat =",
      "    match result",
      "        Some(count) => count",
      "        None => 0",
      "export let recovered: Nat = orZero(Nat.fromInt(41)) + 1",
      "export let floored: Nat = orZero(Nat.fromInt(-3))",
      "",
    ].join("\n"));

    expect(exports["recovered"]).toBe(42);
    expect(exports["floored"]).toBe(0);
  });

  /**
   * The conversion is representationally nothing — `Nat` and `Int` share one
   * `number` — so the sign check is the whole of it and the emitted core is the
   * identity. Pinned at the companion, where a stray `Math` call or wrapper
   * would show.
   */
  test("the unchecked core is the identity, in the companion's own output", () => {
    const text = companion("export let n: Option(Nat) = Nat.fromInt(3)\n");

    expect(text).toContain("__hex_a => __hex_a");
    expect(text).toContain("(__hex_a, __hex_b) => __hex_a ** __hex_b");
    expect(text).toContain('"Nat.mod: divisor is zero"');
    // No guard above `pow`, which is the absence this type is about.
    expect(text).not.toContain("NegativeExponentError");
    // The self-identity is the plain binding, with no host call behind it.
    expect(text).toContain("fromNat: value => value");
  });
});

describe("`Nat` widens, and its literals erase", () => {
  /**
   * `Nat` -> `Int` is the identity over one shared representation and
   * `Nat` -> `BigInt` is one host call. Both go through `Num.fromNat` at the
   * *target's* instance, which is a source instance at every one of these types
   * now — so the shapes are pinned as well as executed.
   */
  test("a `Nat` reaches `Int` and `BigInt` with nothing and one call", async () => {
    const source = [
      "export let toInt(count: Nat): Int = count + 0",
      "export let toBig(count: Nat): BigInt = count + 0n",
      "export let asInt: Int = toInt(8)",
      "export let asBig: BigInt = toBig(8)",
      "",
    ].join("\n");
    const exports = await runMain(source);
    const text = emitted(source);

    expect(exports["asInt"]).toBe(8);
    expect(exports["asBig"]).toBe(8n);
    expect(text).toContain("const toInt = count => count + 0;");
    expect(text).toContain("const toBig = count => BigInt(count) + 0n;");
  });

  /**
   * And a `Nat`-typed literal is the bare JavaScript number: the `fromNat` slot
   * never materializes for one, so the self-identity's body is a fact about the
   * dictionary rather than a cost at every literal.
   */
  test("a `Nat`-typed literal erases to a bare number", () => {
    const text = emitted([
      "export let count: Nat = 27",
      "export let separated: Nat = 2_048",
      "export let zero: Nat = 0",
      "",
    ].join("\n"));

    expect(text).toContain("const count = 27;");
    expect(text).toContain("const separated = 2048;");
    expect(text).toContain("const zero = 0;");
    expect(text).not.toContain("fromNat");
  });
});

describe("the wired `Nat` row is gone, not dormant", () => {
  test("a `Nat`-heavy program carries no retired helper", () => {
    const text = emitted([
      "export let q: Nat = Nat.quot(19, 4)",
      "export let g: Nat = Nat.gcd(24, 36)",
      "export let p: Nat = 2 ** 6",
      "",
    ].join("\n"));

    expect(text).not.toContain("__hex_int");
    expect(text).not.toContain("__hex_nat");
    expect(text).not.toContain("__hex_checkedPower");
    expect(text).toContain('from "./Nat.js"');
  });

  /**
   * The `Hash` carve-out reaches `Nat` too: a record deriving over a `Nat` field
   * finds the companion's hand-written instance, and the law it owes `Eq` holds.
   */
  test("a record deriving over a `Nat` field hashes lawfully", async () => {
    const exports = await runMain([
      "export record Page derives (Eq, Hash) = {number: Nat, size: Nat}",
      "let first = Page({number = 1, size = 50})",
      "let alsoFirst = Page({number = 1, size = 50})",
      "let second = Page({number = 2, size = 50})",
      "export let same: Bool = first == alsoFirst",
      "export let agree: Bool = hash(first) == hash(alsoFirst)",
      "let seen: Set(Page) = Set.add(Set.add(Set.add(Set.empty(), first), alsoFirst), second)",
      "export let collapsed: Int = Set.size(seen)",
      "",
    ].join("\n"));

    expect(exports["same"]).toBe(true);
    expect(exports["agree"]).toBe(true);
    expect(exports["collapsed"]).toBe(2);
  });

  /**
   * The carve-out is the companion's alone; user source keeps the refusal.
   *
   * The body is the parameter rather than a literal because a *literal* inside
   * a refused `honor` block crashes the checker — at `BigInt` and `String` as
   * much as at `Nat`, so it is a general defect in what a refused instance
   * leaves half-built, not this arc's.
   */
  test("a hand-written `honor Hash<Nat>` in user source is still refused", () => {
    expect(diagnostics([
      ["/main.hex", "honor Hash<Nat> =\n    hash(value) = value\n"],
    ])).toContain(
      "`Hash` instances cannot be hand-written; use `derives Hash` on the " +
        "declaration of the subject type",
    );
  });
});
