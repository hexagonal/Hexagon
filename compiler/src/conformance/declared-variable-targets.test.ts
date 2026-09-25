import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics, runProject } from "../support/test-project.js";

// Numeric Literals §4 and §5.1 on a caller's declared type variable (#1042,
// #1035): the binder establishes it — defaulting never proposes `Int` for it at
// a function binding, and a `Nat` or `Int` widens into it at every seat.

function verdict(source: string): readonly string[] {
  return projectDiagnostics("module Main\n\n" + source);
}

const GENERIC =
  "fun zero<t: Num>(): t = 0\n" +
  "fun widen<t: Num>(value: Nat): t = value\n" +
  "fun viaMember<t: Num>(n: Nat): t = Num.fromNat(n)\n" +
  "fun bound<t: Num>(value: Nat): t =\n" +
  "    let y: t = value\n" +
  "    y\n" +
  "fun ascribed<t: Num>(value: Nat): t = (value: t)\n" +
  "fun passed<t: Num>(value: Nat): t =\n" +
  "    let accept(item: t): t = item\n" +
  "    accept(value)\n" +
  "fun passedInt<t: Signed>(value: Int): t =\n" +
  "    let accept(item: t): t = item\n" +
  "    accept(value)\n" +
  "fun both<t: Signed>(h: (t, t) -> t, n: Nat, i: Int): t = h(n, i)\n" +
  "fun through<t: Num>(value: Nat, f: (t) -> t): t = f(value)\n";

const CALLS = [
  "zero()", "widen(natural)", "viaMember(natural)", "bound(natural)",
  "ascribed(natural)", "passed(natural)", "passedInt(integer)",
  "both((left, right) => left + right, natural, integer)",
  "through(natural, (x) => x * 2)",
];

describe("a declared type variable occurring only in a function's result (#1042)", () => {
  test("is quantified, not defaulted, and each caller chooses it", async () => {
    const source = "module Main\n\n" + GENERIC +
      "let natural: Nat = 3\n" +
      "let integer: Int = -4\n" +
      `export let floats: Vector(Float) = [${CALLS.join(", ")}]\n` +
      `export let bigs: Vector(BigInt) = [${CALLS.join(", ")}]\n`;
    const project = compileMain(source);
    expect(project.diagnostics).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    for (const name of ["zero", "widen", "viaMember", "bound", "ascribed", "passed"]) {
      const scheme = main.typed.symbols.find((symbol) => symbol.name === name)?.scheme;
      expect(scheme?.constraints.map(({ name: constraint }) => constraint)).toEqual(["Num"]);
    }
    const exports = await runProject([["/main.hex", source]]);
    expect([...(exports["floats"] as Iterable<unknown>)])
      .toEqual([0, 3, 3, 3, 3, 3, -4, -1, 6]);
    expect([...(exports["bigs"] as Iterable<unknown>)])
      .toEqual([0n, 3n, 3n, 3n, 3n, 3n, -4n, -1n, 6n]);
  });

  test("a use that supplies no type defaults at its own binding, as a literal does", () => {
    const project = compileMain("module Main\n\n" +
      "fun zero<t: Num>(): t = 0\n" +
      "fun widen<t: Num>(value: Nat): t = value\n" +
      "let natural: Nat = 3\n" +
      "let fromZero = zero()\n" +
      "let fromWiden = widen(natural)\n");
    expect(project.diagnostics).toEqual([]);
    const main = project.modules.find(({ source }) => source.path === "/main.hex")!;
    for (const name of ["fromZero", "fromWiden"]) {
      expect(main.typed.symbols.find((symbol) => symbol.name === name)?.scheme.type)
        .toMatchObject({ kind: "Primitive", name: "Int" });
    }
  });

  test("an ascription-declared variable at a function binding generalizes too (Ascription §6.2)", async () => {
    const source = "module Main\n\n" +
      "let z = ((() => 0) : () -> a)\n" +
      "export let asFloat: Float = z()\n" +
      "export let asBig: BigInt = z()\n";
    expect(compileMain(source).diagnostics).toEqual([]);
    const exports = await runProject([["/main.hex", source]]);
    expect([exports["asFloat"], exports["asBig"]]).toEqual([0, 0n]);
  });

  test("with no literal involved, and in the plain-annotation spellings", async () => {
    const source = "module Main\n\n" +
      "fun empty<t: Show>(): Vector(t) = []\n" +
      "fun emptyEq<t: Eq>(): Vector(t) = []\n" +
      "let f: () -> a = () => 0\n" +
      "let g(): a = 0\n" +
      "export let sizes: Vector(Int) = [empty().length(), emptyEq().length()]\n" +
      "export let annotated: BigInt = f()\n" +
      "export let returned: BigInt = g()\n";
    expect(compileMain(source).diagnostics).toEqual([]);
    const exports = await runProject([["/main.hex", source]]);
    expect([...(exports["sizes"] as Iterable<unknown>)]).toEqual([0, 0]);
    expect([exports["annotated"], exports["returned"]]).toEqual([0n, 0n]);
  });

  test("an exported result-only function publishes an edition per numeric home", async () => {
    const source = "module Main\n\n" +
      "export fun zero<t: Num>(): t = 0\n" +
      "export fun widen<t: Num>(value: Nat): t = value\n";
    const project = compileMain(source);
    expect(project.diagnostics).toEqual([]);
    const declarations = project.modules
      .find(({ source }) => source.path === "/main.hex")!.declarations.text;
    expect(declarations).toContain("export declare function zeroFloat(): number;");
    expect(declarations).toContain("export declare function zeroBigInt(): bigint;");
    expect(declarations).toContain("export declare function widenBigInt(value: number): bigint;");
    expect(declarations).not.toContain("unknown");
    const exports = await runProject([["/main.hex", source]]);
    expect((exports["widenBigInt"] as (value: number) => unknown)(7)).toBe(7n);
  });

  test("the seat is read at the evaluated value, never a destructured component", () => {
    // The component `g` is function-typed; the tuple is not. Keyed on the
    // component, the declared `a` would skip defaulting and meet the
    // evidence-seat decline instead of the ascription's own refusal.
    expect(verdict("let (g, k) = (((() => 0) : () -> a), 1)\n")).toEqual([
      "`a` is a declared type variable, but `0` can be only a `Num` type; ascribe the " +
        "concrete type you mean — `(0 : Int)` — or remove the ascription to let the " +
        "literal default to `Int`",
    ]);
  });

  test("at a non-function value binding there is no seat, and rigidity still refuses", () => {
    expect(verdict("let x: a = 42\n")).toEqual([
      "`a` is a declared type variable, but the body requires `Int`; change the " +
        "annotation to `Int`, or remove it to let the type be inferred",
    ]);
  });

  test("a body that demands a concrete type is still refused", () => {
    const messages = verdict("fun forced<t: Num>(): t = Int.add(1, 2)\n");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("`t` is a declared type variable, but the body requires `Int`");
  });
});

describe("a Nat or Int argument widens into a caller's declared type variable (#1035)", () => {
  test("the argument seat elaborates the dictionary conversion, as BigInt's does", () => {
    const project = compileMain("module Main\n\n" + GENERIC +
      "fun passedBig<t: FromBigInt>(value: BigInt): t =\n" +
      "    let accept(item: t): t = item\n" +
      "    accept(value)\n");
    expect(project.diagnostics).toEqual([]);
    const text = project.modules.find(({ source }) => source.path === "/main.hex")!
      .javascript.text;
    expect(text).toContain("accept(__Num_a.fromNat(value))");
    expect(text).toContain("accept(__Signed_a.fromInt(value))");
    expect(text).toContain("accept(__FromBigInt_a.fromBigInt(value))");
    expect(text).toContain("h(__Signed_a.Num.fromNat(n), __Signed_a.fromInt(i))");
    expect(text).toContain("f(__Num_a.fromNat(value))");
  });

  test("a knot sibling's declared variable is not the caller's, and stays refused", () => {
    // Members of a `fun` knot share one not-yet-general type (Functions §7.4),
    // so `a`'s call reaches `b`'s own `u` — whose evidence `a` does not carry.
    // Each row's `u` carries the constraint its source's widening needs, so the
    // old rigid-only test would have accepted it and emission found no evidence:
    // `Frac` gives `Num` and `Signed`, and `FromBigInt` has to be demanded itself.
    const rows = [
      ["n: Nat", "3", "let y = x / x"],
      ["n: Int", "3", "let y = x / x"],
      ["n: BigInt", "3n", "let y = FromBigInt.fromBigInt(5n) + x"],
    ];
    for (const [source, width, demand] of rows) {
      const messages = verdict(
        "fun\n" +
        "    b(x: u, go: Bool): Int =\n" +
        `        ${demand}\n` +
        `        if go then a(${width}, False) else 1\n` +
        `    a(${source}, flag: Bool): Int = if flag then b(n, False) else 0\n` +
        "export let r: Int = a(3, True)\n",
      );
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("`u` is a declared type variable, but the body requires");
      expect(messages[0]).not.toContain("internal compiler error");
    }
  });

  test("a block head's variable is every member's, and widens in the sibling call", async () => {
    const source = "module Main\n\n" +
      "fun<u: Num>\n" +
      "    b(x: u, go: Bool): u = if go then a(x, 1, False) else x\n" +
      "    a(x: u, n: Nat, go: Bool): u = if go then b(n, False) else x\n" +
      "export let r: Float = a(1.5, 3, True)\n";
    expect(compileMain(source).diagnostics).toEqual([]);
    expect((await runProject([["/main.hex", source]]))["r"]).toBe(3);
  });

  test("a head variable the calling member's signature does not mention is not its own", () => {
    // `u` is in `a`'s scope, but its evidence reaches a member only through the
    // member's own scheme, and `a`'s signature does not mention it.
    const messages = verdict(
      "fun<u: Frac>\n" +
      "    b(x: u, go: Bool): Int = if go then a(3, False) else 1\n" +
      "    a(n: Nat, flag: Bool): Int = if flag then b(n, False) else 0\n" +
      "export let r: Int = a(3, True)\n",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("`u` is a declared type variable, but the body requires `Nat`");
  });

  test("a shadowed outer variable is not one the inner body can name, and stays refused", () => {
    // The outer `t`'s evidence does reach `inner`, but `inner` can no longer name
    // it: the target must be a variable the body can name (§5.1).
    const messages = verdict(
      "fun outer<t: Num>(n: Nat): t =\n" +
      "    let accept(item: t): t = item\n" +
      "    let inner<t: Num>(m: Nat): t =\n" +
      "        let ignored = accept(m)\n" +
      "        m\n" +
      "    accept(n)\n",
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("`t` is a declared type variable, but the body requires `Nat`");
  });

  test("the conversion the declared constraints do not supply is still refused", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["fun noNum<t>(value: Nat): t =\n    let accept(item: t): t = item\n    accept(value)\n",
        "Nat"],
      ["fun numOnly<t: Num>(value: Int): t =\n    let accept(item: t): t = item\n    accept(value)\n",
        "Int"],
      ["fun bothNum<t: Num>(h: (t, t) -> t, n: Nat, i: Int): t = h(n, i)\n", "Int"],
    ];
    for (const [source, required] of cases) {
      const messages = verdict(source);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(
        `\`t\` is a declared type variable, but the body requires \`${required}\``,
      );
    }
  });
});
