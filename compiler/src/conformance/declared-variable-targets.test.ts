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
    const project = compileMain("module Main\n\n" + GENERIC +
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
