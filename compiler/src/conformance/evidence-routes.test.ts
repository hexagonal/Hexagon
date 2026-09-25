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

const MAP_HELPERS =
  "fun both(a: Bool, b: Bool): Bool = a and b\n" +
  "fun keyed(m: Map(k, Int), key: k): Bool = True\n";

function sibling(member: string, evidence: string, binder: string): string {
  return `\`u\` is declared on \`b\`, and this in \`${member}\` needs its \`${evidence}\` evidence, ` +
    `but \`${member}\`'s type does not mention it, and a knot member cannot name a sibling's ` +
    `variable; declare it on the block's head, \`fun<${binder}>\`, and write \`u\` in ` +
    `\`${member}\`'s signature too`;
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

  test("a dot call settled at a knot's generalization is attributed to where it was written", () => {
    // The goal settles when the knot generalizes, with no binding open; its
    // demand is still `a`'s. Before, it went unrecorded and emission crashed.
    expect(diagnostics(
      MAP_HELPERS +
      "fun<u: Hash>\n" +
      "    b(x: u, go: Bool): Int = if go then a(False) else 1\n" +
      "    a(flag: Bool): Int = Vector.length([(x: u, z) => both(z.containsKey(x), keyed(z, x))])\n" +
      "export let r: Int = a(True)\n",
    )).toEqual([unmentioned("u", "Hash", "a")]);
  });

  test("one report per declaration and constraint, at its first demand", () => {
    expect(diagnostics(
      "fun<u: Frac>\n" +
      "    b(x: u, go: Bool): Int = if go then a(False) else 1\n" +
      "    a(flag: Bool): Int =\n" +
      "        let f = (x: u) => x / x\n" +
      "        let g = (x: u) => x / x\n" +
      "        if flag then 1 else 0\n" +
      "export let r: Int = a(True)\n",
    )).toEqual([unmentioned("u", "Frac", "a")]);
  });

  test("a demand another rule has already refused is not reported again", () => {
    // §4.2's head contract refusal speaks for the `Frac` demand the head lacks.
    const messages = diagnostics(
      "fun<u: Num>\n" +
      "    b(x: u, go: Bool): Int = if go then a(False) else 1\n" +
      "    a(flag: Bool): Int =\n" +
      "        let f = (x: u) => x / x\n" +
      "        if flag then 1 else 0\n" +
      "export let r: Int = a(True)\n",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("`u` is declared to honor `Num` on the block head");
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
    )).toEqual([sibling("a", "FromBigInt", "u: FromBigInt")]);
  });

  test("a sibling reached from a local inside a member names the member, not the local", () => {
    for (const local of [
      "        fun inner(k: Int): Int = if flag then b(n, False) else k\n        inner(0)\n",
      "        let g = (k: Int) => if flag then b(n, False) else k\n        g(0)\n",
    ]) {
      expect(diagnostics(
        "fun\n" +
        "    b(x: u, go: Bool): Int =\n" +
        "        let y = FromBigInt.fromBigInt(5n) + x\n" +
        "        if go then a(3n, False) else 1\n" +
        "    a(n: BigInt, flag: Bool): Int =\n" + local +
        "export let r: Int = a(3n, True)\n",
      )).toEqual([sibling("a", "FromBigInt", "u: FromBigInt")]);
    }
  });

  test("each refusal's advice, followed, compiles and runs (the Rewrite Rule)", async () => {
    const followed = [
      // The sibling advice: the head, spelled whole, and `u` in `a`'s signature.
      "fun<u: FromBigInt>\n" +
        "    b(x: u, go: Bool): Int =\n" +
        "        let y = FromBigInt.fromBigInt(5n) + x\n" +
        "        if go then a(3n, False, None) else 1\n" +
        "    a(n: BigInt, flag: Bool, w: Option(u)): Int = if flag then b(n, False) else 0\n" +
        "export let r: Int = a(3n, True, (None : Option(BigInt)))\n",
      // The unmentioned-head advice: `u` in `a`'s parameter types.
      "fun<u: Frac>\n" +
        "    b(x: u, go: Bool): Int =\n" +
        "        let y = x / x\n" +
        "        if go then a(False, x) else 1\n" +
        "    a(flag: Bool, w: u): Int =\n" +
        "        let f = (x: u) => x / x\n" +
        "        if flag then 1 else 0\n" +
        "export let r: Int = a(True, 2.0)\n",
    ];
    for (const source of followed) {
      expect(diagnostics(source)).toEqual([]);
      expect((await runProject([["/main.hex", "module Main\n\n" + source]]))["r"]).toBe(1);
    }
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
      // A requirement's components are minted when its type becomes concrete,
      // after the binding that made it has closed: they are that binding's too.
      "a nested self-recursive function comparing its own recursive result",
      "fun outer(n: Int): Bool =\n" +
        "    fun inner<t: Eq>(x: t, go: Bool): Vector(t) =\n" +
        "        if go and inner(x, False) == inner(x, False) then [x, x] else [x]\n" +
        "    Vector.length(inner(n, True)) == 2\n" +
        "export let r: Bool = outer(1)\n",
      true,
    ],
    [
      "a nested self-recursive function interpolating its own recursive result",
      "fun outer(n: Int): String =\n" +
        "    fun render<t: Show>(x: t, depth: Int): Vector(t) =\n" +
        "        if depth > 0 then\n" +
        "            let rest = render(x, depth - 1)\n" +
        "            let text = \"${rest}\"\n" +
        "            [x]\n" +
        "        else [x]\n" +
        "    \"${render(n, 2)}\"\n" +
        "export let r: String = outer(7)\n",
      "[7]",
    ],
    [
      // A dot call whose receiver settles at the deadline demands where written.
      "a dot-call goal settled at a nested function's generalization",
      MAP_HELPERS +
        "fun outer(n: Int): Bool =\n" +
        "    fun inner<t: Hash>(x: t, z): Bool = both(z.containsKey(x), keyed(z, x))\n" +
        "    inner(n, Map.empty)\n" +
        "export let r: Bool = outer(5)\n",
      false,
    ],
    [
      "the same through a nested `let`",
      MAP_HELPERS +
        "fun outer(n: Int): Bool =\n" +
        "    let inner<t: Hash>(x: t, z): Bool = both(z.containsKey(x), keyed(z, x))\n" +
        "    inner(n, Map.empty)\n" +
        "export let r: Bool = outer(5)\n",
      false,
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
