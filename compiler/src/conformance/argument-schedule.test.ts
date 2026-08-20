/**
 * Conformance for Functions §4.3's **normative elaboration schedule** — #517's
 * B′ migration.
 *
 * > term bindings top-down, an application's callee first *unless the callee is
 * > a lambda literal*, then non-lambda arguments in source order, then
 * > lambda-literal arguments in source order, then a lambda-literal callee;
 * > operands left to right.
 *
 * **The schedule is the semantics.** Elaboration order is observable through
 * the judgments that read the substitution mid-schedule — Numeric Literals
 * §5.1's contextual widening, and Pattern Matching §6.1's abstract-scrutinee
 * refusal — so every pin below is a program whose *verdict or scheme* the order
 * decides. Two properties are what the migration bought, and each is pinned
 * from both directions:
 *
 * - A lambda literal's position **relative to its non-lambda siblings** is
 *   never observable. The deferred class elaborates after the first pass from
 *   any position, so the pair and its mirror behave identically.
 * - Within each pass, **source order is semantics**. The residue is the same in
 *   both passes, and both sibling pairs below pin it.
 *
 * A note on the fixtures. §4.3 names `useFloat : (Float) -> Float`, and the
 * scheme pins here use it: it settles a *variable* at `Float` when it meets one.
 * It cannot make a rejection pin, though — an already-`Int` argument reaches a
 * `Float` parameter by §5.1's ordinary value widening, so the program is
 * accepted whichever order produced the `Int`. `useNat : (Nat) -> Nat` is the
 * discriminating half: `Int -> Nat` is the unsafe direction §5.1 refuses, so a
 * schedule that types the shared variable at `Int` first is *rejected*, and one
 * that reaches the lambda first is accepted at `Nat`. Every pin below is
 * therefore written twice — once for the scheme, once for the verdict.
 */

import { describe, expect, test } from "vitest";

import { compileMain, projectDiagnostics } from "../support/test-project.js";

/** §4.3's fixtures, plus the discriminating `useNat`. */
const fixtures = "let one: Int = 1\n" +
  "let half: Float = 0.5\n" +
  "let useFloat(value: Float): Float = value\n" +
  "let useNat(value: Nat): Nat = value\n" +
  "let render(value: Int): String = \"x\"\n";

const mismatch = "type mismatch: expected Nat, found Int";

function verdict(source: string): readonly string[] {
  return projectDiagnostics(fixtures + source);
}

function parameterOf(source: string, name: string): unknown {
  const project = compileMain(fixtures + source);
  const main = project.modules.find(({ source: file }) => file.path === "/main.hex")!;
  const found = main.typed.symbols.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`expected symbol ${name}`);
  return (found.scheme.type as { readonly parameters?: readonly unknown[] }).parameters?.[0];
}

const INT = { kind: "Primitive", name: "Int" };
const FLOAT = { kind: "Primitive", name: "Float" };
const NAT = { kind: "Primitive", name: "Nat" };

// Proves the harness can see a failure: a fixture block that stopped compiling
// would make every `toEqual([])` below vacuous.
test("the harness reports a broken fixture block rather than passing it", () => {
  expect(verdict("export let broken: Int = missing(1)\n")).not.toEqual([]);
});

describe("the deferred-lambda pair: a lambda's position among non-lambdas", () => {
  // At a **generic** callee no expectation lands, so the schedule alone
  // decides. `p + one` is the non-lambda sibling and elaborates in pass 1
  // whichever side it is written on; the lambda follows in pass 2 and reads `p`
  // as the first pass left it.
  const callbackFirst = "let f(cb: (a) -> b, other: c): String = \"x\"\n" +
    "fun outer(p) = f(x => useNat(p), p + one)\n";
  const callbackLast = "let f(other: c, cb: (a) -> b): String = \"x\"\n" +
    "fun outer(p) = f(p + one, x => useNat(p))\n";

  test("both orders reject identically", () => {
    expect(verdict(callbackFirst)).toEqual([mismatch]);
    expect(verdict(callbackLast)).toEqual(verdict(callbackFirst));
  });

  test("both orders infer the same scheme", () => {
    expect(parameterOf(callbackFirst, "outer")).toMatchObject(INT);
    expect(parameterOf(callbackLast, "outer")).toMatchObject(INT);
  });

  test("§4.3's own fixture agrees, accepting from either side", () => {
    // `useFloat` accepts the `Int` the first pass produced, by §5.1's ordinary
    // widening — so this pair is identical in the other direction too.
    const floatFirst = "let f(cb: (a) -> b, other: c): String = \"x\"\n" +
      "fun outer(p) = f(x => useFloat(p), p + one)\n";
    const floatLast = "let f(other: c, cb: (a) -> b): String = \"x\"\n" +
      "fun outer(p) = f(p + one, x => useFloat(p))\n";
    expect(verdict(floatFirst)).toEqual([]);
    expect(verdict(floatLast)).toEqual([]);
    expect(parameterOf(floatFirst, "outer")).toMatchObject(INT);
    expect(parameterOf(floatLast, "outer")).toMatchObject(INT);
  });
});

describe("the non-lambda sibling pair: pass 1's residue", () => {
  // Source order within the first pass **is** semantics, by design: two
  // programs differing only in the order of siblings sharing an undetermined
  // variable may type differently.
  const floatFirst = "let g(a1: a, b1: b): String = \"x\"\n" +
    "fun outer(p) = g(p + half, p + one)\n";
  const intFirst = "let g(a1: a, b1: b): String = \"x\"\n" +
    "fun outer(p) = g(p + one, p + half)\n";

  test("`half` first types the shared variable at `Float`; `one` first at `Int`", () => {
    expect(verdict(floatFirst)).toEqual([]);
    expect(parameterOf(floatFirst, "outer")).toMatchObject(FLOAT);
    expect(verdict(intFirst)).toEqual([]);
    expect(parameterOf(intFirst, "outer")).toMatchObject(INT);
  });

  test("the same order decides a verdict where the widening is the unsafe one", () => {
    const natFirst = "let g(a1: a, b1: b): String = \"x\"\n" +
      "fun outer(p) = g(useNat(p), p + one)\n";
    const natLast = "let g(a1: a, b1: b): String = \"x\"\n" +
      "fun outer(p) = g(p + one, useNat(p))\n";
    expect(verdict(natFirst)).toEqual([]);
    expect(parameterOf(natFirst, "outer")).toMatchObject(NAT);
    expect(verdict(natLast)).toEqual([mismatch]);
  });
});

describe("the lambda sibling pair: pass 2's residue is the same as pass 1's", () => {
  const natFirst = "let f(c1: (a) -> b, c2: (c) -> d): String = \"x\"\n" +
    "fun outer(p) = f(x => useNat(p), y => p + one)\n";
  const natLast = "let f(c1: (a) -> b, c2: (c) -> d): String = \"x\"\n" +
    "fun outer(p) = f(y => p + one, x => useNat(p))\n";

  test("source order among lambda literals decides, both directions", () => {
    expect(verdict(natFirst)).toEqual([]);
    expect(parameterOf(natFirst, "outer")).toMatchObject(NAT);
    expect(verdict(natLast)).toEqual([mismatch]);
  });

  test("§4.3's own fixture pins the scheme half of the same pair", () => {
    const floatFirst = "let f(c1: (a) -> b, c2: (c) -> d): String = \"x\"\n" +
      "fun outer(p) = f(x => useFloat(p), y => p + one)\n";
    const floatLast = "let f(c1: (a) -> b, c2: (c) -> d): String = \"x\"\n" +
      "fun outer(p) = f(y => p + one, x => useFloat(p))\n";
    expect(verdict(floatFirst)).toEqual([]);
    expect(parameterOf(floatFirst, "outer")).toMatchObject(FLOAT);
    expect(verdict(floatLast)).toEqual([]);
    expect(parameterOf(floatLast, "outer")).toMatchObject(INT);
  });
});

describe("the callee-position flavours: arguments first", () => {
  // One schedule serves both positions. A lambda-literal callee is the deferred
  // class in callee position, so these two reject exactly as the argument-side
  // pair does — the argument's arithmetic settles `p` before the callee's body
  // reads it.
  const plain = "fun flavour(p) = (p + one) |> (x => useNat(p))\n";
  const matched = "fun flavour(p) = (render(p + one)) |> match\n" +
    "    \"0\" => useNat(p)\n" +
    "    _ => 0\n";

  test("both flavours reject identically", () => {
    expect(verdict(plain)).toEqual([mismatch]);
    expect(verdict(matched)).toEqual(verdict(plain));
  });

  test("§4.3's own fixture pins the scheme: `(Int) -> …`, not `(Float) -> …`", () => {
    const floatPlain = "fun flavour(p) = (p + one) |> (x => useFloat(p))\n";
    expect(verdict(floatPlain)).toEqual([]);
    expect(parameterOf(floatPlain, "flavour")).toMatchObject(INT);
  });

  test("an application whose callee is anything else still elaborates callee first", () => {
    // A *name* bound to a lambda is not a lambda literal, so this call keeps the
    // callee-first order — and the callee's own elaboration decides nothing
    // here, which is the point: only the syntactic class defers.
    expect(verdict(
      "let apply(cb: (Int) -> Nat): Nat = cb(0)\n" +
        "export let a: Nat = apply(x => useNat(3))\n",
    )).toEqual([]);
  });
});

describe("the pipe seat supplies (§4.3, Operators §8)", () => {
  test("a guard-only match function reads its parameter type off the piped value", () => {
    expect(verdict(
      "export fun classify(total: Int): String = total |> match\n" +
        "    n when n < 0 => \"negative\"\n" +
        "    _ => \"other\"\n",
    )).toEqual([]);
  });

  test("the bare-lambda stage is served alike", () => {
    expect(verdict(
      "export fun classify(total: Int): String = total |> (v =>\n" +
        "    match v\n" +
        "        n when n < 0 => \"negative\"\n" +
        "        _ => \"other\")\n",
    )).toEqual([]);
  });

  test("a piped value whose own type is undetermined declines, with §6.1's rider", () => {
    expect(verdict(
      "fun classify(v) = v |> match\n" +
        "    n when n < 0 => \"negative\"\n" +
        "    _ => \"other\"\n",
    )).toEqual([
      "cannot match on a value of abstract type; the parameter's type is not " +
      "determined here; give the parameter a type — bind the function with its " +
      "own annotated `let`, or use it where its parameter type is known",
    ]);
  });

  test("a literal-heavy pipe match keeps compiling, at the same types", () => {
    // The patterns fixed the type before the seat existed and fix it still: the
    // argument-first schedule adds an expectation the patterns agree with.
    const source = "export fun classify(value: Int): String = value |> match\n" +
      "    0 => \"zero\"\n" +
      "    _ => \"other\"\n";
    expect(verdict(source)).toEqual([]);
    expect(parameterOf(source, "classify")).toMatchObject(INT);
  });

  test("an arity mismatch at a lambda-literal callee declines silently", () => {
    // The landing rules govern in callee position too: a two-parameter lambda
    // cannot take the one-argument function type the seat builds, so nothing
    // lands and the seat's ordinary diagnostics stand. No diagnostic names
    // propagation.
    const diagnostics = verdict("export let a: Int = 3 |> ((x, y) => x)\n");
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const message of diagnostics) {
      expect(message).not.toMatch(/expected type|propagat/iu);
    }
  });
});

describe("the deferred class is syntactic", () => {
  const guardOnly = "    n when n < 0 => \"negative\"\n    _ => \"other\"\n";

  test("grouping parentheses are read through", () => {
    // `(x => e)` defers as `x => e` does — the callback-first shape only
    // compiles because the parenthesized match function reached pass 2.
    expect(verdict(
      "let apply(transform: (a) -> b, values: Vector(a)): Vector(b) =\n" +
        "    [transform(values[0])]\n" +
        "let xs: Vector(Int) = [1]\n" +
        "export let ys: Vector(String) = apply((match\n" +
        guardOnly +
        "), xs)\n",
    )).toEqual([]);
  });

  test("an ascribed lambda does not defer — its own face supplies it", () => {
    // The ascription is a seat; deferral would buy it nothing, and the arms
    // read `Int` from the written face at their turn in pass 1.
    expect(verdict(
      "let apply(transform: (Int) -> String, values: Vector(Int)): Vector(String) =\n" +
        "    [transform(values[0])]\n" +
        "let xs: Vector(Int) = [1]\n" +
        "export let ys: Vector(String) = apply((match\n" +
        guardOnly +
        ": (Int) -> String), xs)\n",
    )).toEqual([]);
  });

  test("a name bound to a lambda elaborates in the first pass", () => {
    const source = "let g(a1: a, b1: b): String = \"x\"\n" +
      "let sign: (Int) -> String = match\n" +
      guardOnly +
      "fun outer(p) = g(sign, useNat(p))\n";
    expect(verdict(source)).toEqual([]);
    expect(parameterOf(source, "outer")).toMatchObject(NAT);
  });
});

describe("the schedule reorders no runtime effect", () => {
  test("evaluation order is the rewritten form's source order", () => {
    // §4.3: the schedule is a *checking* order. The deferred lambda is written
    // last and its argument first, and the emitted call evaluates them in the
    // order they were written.
    const source = fixtures +
      "let apply(value: Int, cb: (Int) -> Int): Int = cb(value)\n" +
      "export let out: Int = apply(1, x => x)\n";
    const project = compileMain(source);
    expect(project.diagnostics.map(({ message }) => message)).toEqual([]);
    const javascript = project.modules
      .find(({ source: file }) => file.path === "/main.hex")!.javascript.text;
    expect(javascript).toMatch(/apply\(\s*1\s*,/u);
  });
});
