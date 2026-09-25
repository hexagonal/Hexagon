import { describe, expect, test } from "vitest";

import { compileMain, runProject } from "../support/test-project.js";

// #1048: a demand on a function's declared variable is met only where some
// enclosing declaration quantifies the variable, since only there does a
// dictionary exist (closure doc §13.6: a module the checker accepts never
// reaches emission needing evidence it cannot find). Every row below was
// accepted by the checker and then crashed at emission before this check.

function diagnostics(source: string): readonly string[] {
  return compileMain("module Main\n\n" + source).diagnostics.map(({ message }) => message);
}

function unmentioned(variable: string, evidence: string, member: string): string {
  return `\`${variable}\` is a declared type variable, and this needs its \`${evidence}\` ` +
    `evidence, but \`${member}\`'s type does not mention \`${variable}\`, so no call of ` +
    `\`${member}\` can supply it; use \`${variable}\` in \`${member}\`'s parameter or result types`;
}

describe("a demand whose evidence no enclosing declaration carries is refused, not emitted", () => {
  test("a member's body demanding its block head's variable that its signature omits", () => {
    expect(diagnostics(
      "fun<u: Frac>\n" +
      "    b(x: u, go: Bool): Int =\n" +
      "        let y = x / x\n" +
      "        if go then a(False) else 1\n" +
      "    a(flag: Bool): Int =\n" +
      "        let f = (x: u) => x / x\n" +
      "        if flag then 1 else 0\n" +
      "export let r: Int = a(True)\n",
    )).toEqual([unmentioned("u", "Frac", "a")]);
  });

  test("a `fun` nested in such a member, even when its own signature mentions the variable", () => {
    // `inner` does not quantify `u` (it belongs to the head, not to `inner`), and
    // `a`, the member that encloses it, carries no dictionary for it.
    expect(diagnostics(
      "fun<u: Frac>\n" +
      "    b(x: u, go: Bool): Int = if go then a(3, False) else 1\n" +
      "    a(n: Nat, flag: Bool): Int =\n" +
      "        fun inner(x: u, k: Nat): Int =\n" +
      "            let z = x / x\n" +
      "            0\n" +
      "        0\n" +
      "export let r: Int = a(3, True)\n",
    )).toEqual([unmentioned("u", "Frac", "a")]);
  });

  test("a knot sibling's own variable, reached through the shared type (#1046's shape)", () => {
    // One report, at the demand that reached across. `b`'s own `x + …` demand is
    // its casualty (the sibling's reach is what stopped `b` generalizing over
    // `u`), and is not reported separately.
    expect(diagnostics(
      "fun\n" +
      "    b(x: u, go: Bool): Int =\n" +
      "        let y = FromBigInt.fromBigInt(5n) + x\n" +
      "        if go then a(3n, False) else 1\n" +
      "    a(n: BigInt, flag: Bool): Int = if flag then b(n, False) else 0\n" +
      "export let r: Int = a(3n, True)\n",
    )).toEqual([
      "`u` is declared on `b`, and this in `a` needs its `FromBigInt` evidence, but a " +
        "recursive knot's members share types, not evidence; declare `u` on the `fun` " +
        "block's head and write it in `a`'s signature too",
    ]);
  });
});

describe("wherever a declaration does carry the evidence, nothing changes", () => {
  const cases: readonly (readonly [string, string, unknown])[] = [
    [
      "members sharing a head both mention",
      "fun<u: Num>\n" +
        "    b(x: u, go: Bool): u = if go then a(x, False) else x + x\n" +
        "    a(x: u, go: Bool): u = if go then b(x, False) else x\n" +
        "export let r: Float = a(1.5, True)\n",
      3,
    ],
    [
      "a `fun` nested in a member that mentions the head's variable",
      "fun<u: Num>\n" +
        "    b(x: u, go: Bool): u =\n" +
        "        let acc(i: u): u = i + i\n" +
        "        fun inner(k: u): u = acc(k)\n" +
        "        if go then a(inner(x), False) else x\n" +
        "    a(x: u, go: Bool): u = if go then b(x, False) else x\n" +
        "export let r: Float = a(1.5, True)\n",
      1.5,
    ],
    [
      // The head's own `<u: Num>` is its declaration, not a demand: declared while
      // `outer`'s right-hand side is open, it would otherwise look unrouted.
      "a headed block nested inside a function",
      "fun outer(n: Int): Float =\n" +
        "    fun<u: Num>\n" +
        "        b(x: u, go: Bool): u = if go then a(x, False) else x + x\n" +
        "        a(x: u, go: Bool): u = if go then b(x, False) else x\n" +
        "    a(2.5, True)\n" +
        "export let r: Float = outer(1)\n",
      5,
    ],
    [
      "local functions inside a generic function",
      "fun outer<t: Num>(x: t): t =\n" +
        "    let twice(y: t): t = y + y\n" +
        "    fun inner(z: t): t = twice(z) * z\n" +
        "    inner(x)\n" +
        "export let r: Float = outer(2.0)\n",
      8,
    ],
    [
      "a sibling reached through inference, which puts the variable in its type",
      "fun\n" +
        "    b(x: u, go: Bool): Int =\n" +
        "        let y = x / x\n" +
        "        if go then a(x, False) else 1\n" +
        "    a(y, flag: Bool): Int =\n" +
        "        let z = y / y\n" +
        "        if flag then b(y, False) else 0\n" +
        "export let r: Int = b(1.5, True)\n",
      0,
    ],
  ];
  test.each(cases)("%s", async (_what, source, value) => {
    expect(diagnostics(source)).toEqual([]);
    expect((await runProject([["/main.hex", "module Main\n\n" + source]]))["r"]).toBe(value);
  });
});
