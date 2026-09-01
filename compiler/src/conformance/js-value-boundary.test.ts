import { describe, expect, test } from "vitest";

import { compileFiles, projectDiagnostics, runMain } from "../support/test-project.js";
import { typeScriptErrors } from "../support/typescript-check.js";

/**
 * Conformance for **the `JsValue` type itself** — FFI Part 11 §2, §8 and
 * §13.3 (issue #511's core, minus `toArray`).
 *
 * Four things are pinned here, and each is a sentence of the spec rather than a
 * property of this implementation.
 *
 * - **The type** (§2): any JavaScript value, held by identity, unifying with
 *   itself and nothing else, with **no instances** — not iterable, not
 *   comparable, not showable — and legal in every direct position Part 1 §5.3
 *   admits: parameters, results, record fields, collection elements, callbacks.
 * - **The face** (§2): `unknown`, and *never* `any`. The distinction is the
 *   whole point of the row, so it is checked by running the real TypeScript
 *   compiler over the emitted declarations rather than by matching a substring:
 *   `unknown` forces the foreign consumer through the same narrowing discipline
 *   Hexagon imposes on itself, and `any` would silently discard it.
 * - **Nullish absorption** (§8, §13.3, propagated to Part 2 §2.1):
 *   `Nullable(JsValue) ≡ JsValue` and `Nullable(Nullable(a)) ≡ Nullable(a)` are
 *   one idempotency principle over a designated set that is **explicit and
 *   closed**. The negative half matters as much as the positive: there is no
 *   general structural "contains nullish" analysis, so an opaque extern type
 *   that admits `undefined` does *not* collapse.
 * - **`JsValue.from`** (§2): the total identity injection, **erased in
 *   emission**. The pin is the emitted text — `JsValue.from(x)` compiles to `x`,
 *   with no wrapper and no call.
 *
 * `kind` and the decoders are `js-value-decoding.test.ts`'s; `JsKind`'s
 * qualified-only constructors are `js-kind-qualification.test.ts`'s.
 */

/** The emitted `.d.ts` text of a one-module program at `/main.hex`. */
function declarations(source: string): string {
  const compiled = compileFiles([["/main.hex", source]]);
  expect(compiled.diagnostics).toEqual([]);
  return compiled.modules.find(({ source: file }) => file.path === "/main.hex")!
    .declarations.text;
}

/** The emitted JavaScript of a one-module program at `/main.hex`. */
function javascript(source: string): string {
  const compiled = compileFiles([["/main.hex", source]]);
  expect(compiled.diagnostics).toEqual([]);
  return compiled.modules.find(({ source: file }) => file.path === "/main.hex")!
    .javascript.text;
}

describe("the type (§2)", () => {
  /**
   * §2's "legal wherever Part 1 §5.3 admits a direct type", written out: the
   * five positions the section names, in one module that compiles clean.
   * Uncertainty nests honestly — `Vector(JsValue)` and a record field are as
   * ordinary as a parameter.
   */
  test("it is legal in every direct position", () => {
    expect(projectDiagnostics(
      "export record Envelope = { payload: JsValue, tag: String }\n" +
        "export let wrap(v: JsValue): Envelope = Envelope({ payload = v, tag = \"x\" })\n" +
        "export let many(v: JsValue): Vector(JsValue) = [v, v]\n" +
        "export let through(v: JsValue, f: JsValue -> JsValue): JsValue = f(v)\n" +
        "export let nested(v: Vector(Vector(JsValue))): Vector(Vector(JsValue)) = v\n",
    )).toEqual([]);
  });

  /** §2: it unifies with itself and with nothing else. */
  test("it unifies with itself and nothing else", () => {
    expect(projectDiagnostics("export let same(v: JsValue): JsValue = v\n")).toEqual([]);
    expect(projectDiagnostics("export let no(v: JsValue): Int = v\n"))
      .toEqual(["type mismatch: expected Int, found JsValue"]);
    expect(projectDiagnostics("export let no(n: Int): JsValue = n\n"))
      .toEqual(["type mismatch: expected JsValue, found Int"]);
  });

  /**
   * §2: "`JsValue` is not iterable, not comparable, not showable — it has no
   * instances." A value about which Hexagon asserts *nothing* cannot support an
   * operation that asserts something, so each of the three refuses.
   */
  test("it has no instances — not showable, not comparable, not iterable", () => {
    expect(projectDiagnostics("export let s(v: JsValue): String = show(v)\n"))
      .toEqual(["type `JsValue` has no `Show` instance"]);
    expect(projectDiagnostics("export let e(v: JsValue, w: JsValue): Bool = v == w\n"))
      .toEqual(["type `JsValue` has no `Eq` instance"]);
    expect(projectDiagnostics(
      "export let count(v: JsValue): Int =\n" +
        "    var n = 0\n" +
        "    for x in v\n" +
        "        n = n + 1\n" +
        "    n\n",
    )[0]).toBe("type `JsValue` has no `Iterable` instance");
  });

  /** §2: no type parameters. An applied spelling gets the boundary family's arity refusal. */
  test("it takes no type arguments", () => {
    expect(projectDiagnostics("export let f(v: JsValue(Int)): Int = 1\n"))
      .toEqual(["type `JsValue` expects 0 arguments, but 1 were provided"]);
  });

  /**
   * Modules §5.1 rule 2 and §5.5: the compiler-owned boundary types answer
   * **last**, so a user's own declaration of the spelling wins outright and the
   * compiler holds no resolution claim that outranks it.
   */
  test("a user's own `JsValue` declaration occludes the boundary type", () => {
    expect(declarations(
      "export record JsValue = { n: Int }\n" +
        "export let make(n: Int): JsValue = JsValue({ n = n })\n",
    )).toContain("export type JsValue = { n: number };");
  });
});

describe("the `.d.ts` face is `unknown`, never `any` (§2)", () => {
  const FACES = 'extern from "./raw.js"\n' +
    "    fun raw(): JsValue\n" +
    "\n" +
    "export let loose: JsValue = raw!()\n" +
    "export let echo(v: JsValue): JsValue = v\n" +
    "export let many(v: JsValue): Vector(JsValue) = [v]\n" +
    "export record Envelope = { payload: JsValue }\n";

  test("every position renders `unknown`", () => {
    const text = declarations(FACES);
    expect(text).toContain("export declare const loose: unknown;");
    expect(text).toContain("export declare const echo: (v: unknown) => unknown;");
    expect(text).toContain("export type Envelope = { payload: unknown };");
    expect(text).toContain("Hex.Vector<unknown>");
  });

  /** The prohibition is half the row, and it is the half a slip would take. */
  test("`any` appears nowhere in the declarations", () => {
    expect(declarations(FACES)).not.toMatch(/\bany\b/u);
  });

  /**
   * What the row is *for*, by `tsc` rather than by substring: `unknown` refuses
   * every use until the consumer narrows, which is exactly the discipline §2
   * says the face exists to impose. Under `any` all three of these would
   * compile silently.
   */
  test("`tsc` makes the consumer narrow before using the value", async () => {
    // Vector-free, so the file names no `Hex` vocabulary and stands alone: what
    // is under test is the `unknown` row, not the runtime collection faces.
    const files = {
      "main.d.ts": declarations(
        'extern from "./raw.js"\n' +
          "    fun raw(): JsValue\n" +
          "\n" +
          "export let loose: JsValue = raw!()\n",
      ),
    };
    expect(await typeScriptErrors(files)).toEqual([]);
    const errors = await typeScriptErrors({
      ...files,
      "consumer.ts": 'import { loose } from "./main.js";\n' +
        "export const bad: number = loose;\n" +
        "export const alsoBad = loose.field;\n" +
        "export const narrowed: number = typeof loose === \"number\" ? loose : 0;\n",
    });
    // Line 2 is the assignment, line 3 the property read, line 4 the narrowed
    // use — which is the only one `tsc` accepts.
    expect(errors).toEqual([
      "consumer.ts(2,14): error TS2322: Type 'unknown' is not assignable to type 'number'.",
      "consumer.ts(3,24): error TS18046: 'loose' is of type 'unknown'.",
    ]);
  });

  /**
   * §5.1: the error data are **ordinary** data, so their faces are Part 7 §3's
   * structural record and §4's tagged-POJO union — nothing error-flavoured, no
   * brand, no stack. Checked on the companion's own declaration file.
   */
  test("the conversion-error data face as ordinary record and union", async () => {
    const compiled = compileFiles([["/main.hex",
      "export let e(x: JsConversionError): JsConversionError = x\n"]]);
    expect(compiled.diagnostics).toEqual([]);
    const companion = compiled.modules.find(({ source }) => source.path === "/JsValue.hex")!;
    const text = companion.declarations.text;
    expect(text).toContain(
      "export type JsConversionError = { reason: JsConversionReason; path: Hex.Vector<JsPathSegment> };",
    );
    expect(text).toContain('{ tag: "Shape" }');
    expect(text).toContain('{ tag: "Range" }');
    expect(text).toContain('{ tag: "Cycle"; firstSeen: Hex.Vector<JsPathSegment> }');
    expect(text).toContain('{ tag: "Field"; name: string }');
    expect(text).toContain('{ tag: "Index"; index: number }');
    expect(text).not.toContain("Error &");
    expect(text).not.toContain("$hex");
  });
});

describe("nullish absorption (§8, §13.3)", () => {
  /**
   * §13.3 option (a): `Nullable(JsValue)` is not a *wrapper around* `JsValue`,
   * it **is** `JsValue`. The collapse is definitional, so the two spellings
   * denote one type — a value of one is a value of the other with no
   * conversion, and the face is the face of `JsValue`.
   */
  test("`Nullable(JsValue) ≡ JsValue`", () => {
    expect(projectDiagnostics(
      "export let down(v: Nullable(JsValue)): JsValue = v\n" +
        "export let up(v: JsValue): Nullable(JsValue) = v\n",
    )).toEqual([]);
    expect(declarations("export let down(v: Nullable(JsValue)): JsValue = v\n"))
      .toContain("export declare const down: (v: unknown) => unknown;");
  });

  /** Part 2 §2.1's first instance of the same principle. */
  test("`Nullable(Nullable(a)) ≡ Nullable(a)`", () => {
    expect(projectDiagnostics(
      "export let flat(v: Nullable(Nullable(Int))): Nullable(Int) = v\n",
    )).toEqual([]);
    expect(declarations("export let flat(v: Nullable(Nullable(Int))): Nullable(Int) = v\n"))
      .toContain("(v: number | null | undefined) => number | null | undefined");
  });

  /**
   * Part 2 §2.1: "applies through type aliases and generic substitution". The
   * alias route puts the designated type under the `Nullable` only after the
   * resolver expands the body; the substitution route puts it there only after
   * the checker binds a variable. Both are pinned, because a collapse written at
   * the constructors alone would answer the first and not the second.
   */
  test("it applies through an alias and through generic substitution", () => {
    expect(projectDiagnostics(
      "type Maybe(a) = Nullable(a)\n" +
        "export let viaAlias(v: Maybe(JsValue)): JsValue = v\n" +
        "export let alsoFlat(v: Maybe(Nullable(Int))): Nullable(Int) = v\n",
    )).toEqual([]);
    // `second`'s annotation is `Nullable(a)` with `a` bound to `JsValue` by the
    // *first* argument, so the collapse has to happen after that binding or not
    // at all — a rewrite of the written spelling alone cannot reach it.
    expect(declarations(
      "let second(witness: a, value: Nullable(a)): Nullable(a) = value\n" +
        "export let viaSubstitution(v: JsValue): JsValue = second(v, v)\n",
    )).toContain("export declare const viaSubstitution: (v: unknown) => unknown;");
  });

  /**
   * §8's closed designation, and the half that keeps it honest: **no general
   * structural "contains nullish" analysis exists**. An opaque extern type whose
   * values plainly include `undefined` is not on the list, so `Nullable` stacks
   * on it exactly as on anything else — its face keeps the `| null | undefined`
   * that `JsValue`'s does not.
   */
  test("designation is by rule — an extern type admitting undefined does not collapse", () => {
    const text = declarations(
      'extern from "./handle.js"\n' +
        "    export type Handle\n" +
        "    fun find(): Nullable(Handle)\n" +
        "\n" +
        "export let maybe: Nullable(Handle) = find!()\n",
    );
    expect(text).toContain("export declare const maybe: Handle | null | undefined;");
    // And the type is genuinely still wrapped: the unwrapped spelling does not
    // typecheck, which is what `JsValue`'s does.
    expect(projectDiagnostics(
      'extern from "./handle.js"\n' +
        "    export type Handle\n" +
        "    fun find(): Nullable(Handle)\n" +
        "\n" +
        "export let bare: Handle = find!()\n",
    )).toEqual(["type mismatch: expected Handle, found Nullable(Handle)"]);
  });
});

describe("`JsValue.from` is the erased injection (§2)", () => {
  /**
   * The pin, and it is an *emitted-text* pin because that is what "erased in
   * emission" means: the call is gone, not cheap. Three shapes — a bare name, a
   * compound argument inside a collection literal, and a nested call — because
   * an erasure that forgets precedence produces working code with wrong
   * parentheses, and one that forgets to recurse produces a call.
   */
  test("a call emits as its argument, with no wrapper and no call", () => {
    const text = javascript(
      "export let one(n: Int): JsValue = JsValue.from(n)\n" +
        "export let sum(n: Int): JsValue = JsValue.from(n + 1)\n" +
        "export let both(n: Int): Vector(JsValue) = [JsValue.from(n), JsValue.from(n + 2)]\n" +
        "export let twice(n: Int): JsValue = JsValue.from(JsValue.from(n))\n",
    );
    expect(text).toContain("const one = n => n;");
    expect(text).toContain("const sum = n => n + 1;");
    expect(text).toContain("const both = n => __vectorOf([n, n + 2]);");
    expect(text).toContain("const twice = n => n;");
    // Nothing of the injection survives: no import of it, no application of it.
    expect(text).not.toContain("from(");
    expect(text).not.toContain('import { from }');
  });

  /**
   * The erased call inherits its **argument's** precedence, not a call's. In
   * value position `ignore(e)` emits `void e` (Statements §3.3, #313), and
   * `void` binds tighter than `+`: without the brackets the emitted expression
   * would be `void n + 1`, which is `(void n) + 1` — `NaN` where `Unit`'s
   * representation `undefined` belongs.
   */
  test("an erased call is bracketed by what it emits as, not by what it was", () => {
    expect(javascript("export let u(n: Int): Unit = ignore(JsValue.from(n + 1))\n"))
      .toContain("const u = n => void (n + 1);");
  });

  /** §2: total. Every Hexagon value already is a JS value, so nothing is refused. */
  test("it accepts every type, and the bare spelling is the same binding", () => {
    expect(projectDiagnostics(
      "export let a(n: Int): JsValue = JsValue.from(n)\n" +
        "export let b(s: String): JsValue = JsValue.from(s)\n" +
        "export let c(v: Vector(Int)): JsValue = JsValue.from(v)\n" +
        "export let d(f: Int -> Int): JsValue = JsValue.from(f)\n" +
        "export let e(u: Unit): JsValue = JsValue.from(u)\n",
    )).toEqual([]);
    expect(javascript("export let bare(n: Int): JsValue = from(n)\n"))
      .toContain("const bare = n => n;");
  });

  /**
   * The erasure keys on the **resolved binding**, never the spelling (Modules
   * §5.4). A module that declares its own `from` gets an ordinary call, because
   * erasing one would drop a user's function body on the floor.
   */
  test("an occluding module's own `from` is not erased", () => {
    const text = javascript(
      "export let from(n: Int): Int = n + 100\n" +
        "export let use(n: Int): Int = from(n)\n",
    );
    expect(text).toContain("const use = n => from(n);");
  });

  /** And the erased program runs, answering the injected value by identity. */
  test("the erased call answers the very value it was given", async () => {
    const main = await runMain(
      "export let wrap(n: Int): JsValue = JsValue.from(n)\n" +
        "export let wrapText(s: String): JsValue = JsValue.from(s)\n",
    );
    expect((main["wrap"] as (n: number) => unknown)(7)).toBe(7);
    expect((main["wrapText"] as (s: string) => unknown)("hi")).toBe("hi");
  });
});
